import { useState } from 'react';
import type { RegistryFamily, RegistryModelInsightItem, RegistryVersion } from '@/features/registry/types';
import { Copy, Terminal, ExternalLink, ArrowUpCircle, RotateCcw, GitCompare, Check, FileText, Gauge, SlidersHorizontal, ShieldCheck, Package, Rocket, HeartPulse, Play, BarChart3 } from 'lucide-react';
import { formatVersion } from '@/shared/lib/formatters';
import { Button } from '@/shared/ui/Button';
import { toast } from '@/shared/ui/toastStore';
import { buildRegistryVersionPackage, checkRegistryVersionHealth, deployRegistryVersion, smokeTestRegistryVersion } from '@/features/registry/api/registryApi';
import { getApiErrorMessage } from '@/shared/api/errors';

import { ModelMetricsPanel } from './ModelMetricsPanel';
import { ModelHistoryTimeline } from './ModelHistoryTimeline';
import { DriftSummaryCard } from './DriftSummaryCard';
import { PromoteVersionModal } from './PromoteVersionModal';
import { RollbackVersionModal } from './RollbackVersionModal';
import { VersionComparisonModal } from './VersionComparisonModal';

interface Props {
  family: RegistryFamily;
  version: RegistryVersion;
  allVersions: RegistryVersion[];
  onActionSuccess: () => void;
}

type NormalizedInsightItem = RegistryModelInsightItem & {
  value: number;
  abs_value: number;
};

const classNames = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(' ');

function formatValue(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toString() : value.toFixed(4);
  }
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '-';
  return JSON.stringify(value, null, 2);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shortValue(value: unknown, maxLength = 96): string {
  const formatted = formatValue(value).replace(/\s+/g, ' ').trim();
  return formatted.length > maxLength ? `${formatted.slice(0, maxLength - 1)}…` : formatted;
}

function formatBytes(size?: number): string {
  if (!size && size !== 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatInsightValue(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  const abs = Math.abs(value);
  if (abs !== 0 && abs < 0.0001) return value.toExponential(3);
  if (abs >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function numericInsightValue(value: unknown): number | null {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function numericMetricValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function deployabilityBadge(status?: string) {
  switch (status) {
    case 'deployable':
      return 'bg-success-subtle text-success border-success/20';
    case 'track_only':
      return 'bg-warning-subtle text-warning border-warning/20';
    case 'invalid':
      return 'bg-danger-subtle text-danger border-danger/20';
    default:
      return 'bg-muted text-foreground border-border';
  }
}

function trackingBadge(status?: string) {
  switch (status) {
    case 'completed':
      return 'bg-success-subtle text-success border-success/20';
    case 'skipped':
      return 'bg-primary-subtle text-primary border-primary/20';
    case 'failed':
      return 'bg-warning-subtle text-warning border-warning/20';
    case 'ingesting':
      return 'bg-primary-subtle text-primary border-primary/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function trackingLabel(status?: string) {
  switch (status) {
    case 'completed':
      return 'MLflow Logged';
    case 'skipped':
      return 'Native Registry Ingested';
    case 'failed':
      return 'MLflow Logging Failed';
    case 'ingesting':
      return 'Ingesting';
    default:
      return 'Not Synced';
  }
}

function trackingDescription(status?: string) {
  switch (status) {
    case 'completed':
      return 'Training metadata was ingested into Model Evolution and logged to internal MLflow.';
    case 'skipped':
      return 'Training metadata was ingested into the Native Registry. MLflow logging is disabled for this environment.';
    case 'failed':
      return 'Training metadata was retained in Model Evolution, but MLflow logging failed. Register, build, and deploy can still continue when the artifact is deployable.';
    case 'ingesting':
      return 'Training metadata is being extracted from the completed training artifact.';
    default:
      return 'Training metadata has not been ingested for this version yet.';
  }
}

function endpointFriendlyHint(reasonCode?: string): string {
  if (!reasonCode) return '';
  if ([
    'ENDPOINT_CONTAINER_NOT_FOUND',
    'ENDPOINT_NOT_REACHABLE',
    'ENDPOINT_TIMEOUT',
    'LOCAL_RUNTIME_NOT_STARTED',
  ].includes(reasonCode)) {
    return 'The endpoint record exists, but the local model-server container is not running or not reachable.';
  }
  return '';
}

function endpointActionMessage(result: {
  message?: string;
  reason_code?: string;
  endpoint_error?: string;
  error?: string;
  success?: boolean;
}): string {
  return result.message
    || endpointFriendlyHint(result.reason_code)
    || result.endpoint_error
    || result.error
    || (result.success === false ? 'Endpoint action failed.' : 'Endpoint action completed.');
}

function withoutTechnicalDetail(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const rest = { ...(value as Record<string, unknown>) };
  delete rest.technical_detail;
  return rest;
}

// ---------------------------------------------------------------------------
// DriftSummaryCard — lightweight drift indicator for Model Evolution detail
// ---------------------------------------------------------------------------
export function ModelVersionDetail({ family, version, allVersions, onActionSuccess }: Props) {

  const [activeTab, setActiveTab] = useState<'details' | 'insights' | 'metrics' | 'history'>('details');
  const [isPromoteModalOpen, setIsPromoteModalOpen] = useState(false);
  const [isRollbackModalOpen, setIsRollbackModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<'build' | 'deploy' | 'health' | 'smoke' | null>(null);
  const [smokePayload, setSmokePayload] = useState('{\n  "features": {}\n}');
  const [actionResult, setActionResult] = useState<string>('');
  const [smokeResult, setSmokeResult] = useState<unknown>(null);
  const [technicalDetail, setTechnicalDetail] = useState<string>('');

  const isProd = version.stage === 'production';

  const [copied, setCopied] = useState(false);
  const metricsSummary = version.metrics_summary || version.metricsSummary || {};
  const paramsSummary = version.params_summary || version.paramsSummary || {};
  const metricEntries = Object.entries(metricsSummary);
  const scalarMetricEntries = metricEntries.filter(([, value]) => !isPlainRecord(value) && !Array.isArray(value));
  const objectMetricEntries = metricEntries.filter(([, value]) => isPlainRecord(value) || Array.isArray(value));
  const numericMetricEntries = metricEntries
    .map(([name, value]) => ({ name, value, numericValue: numericMetricValue(value) }))
    .filter((entry): entry is { name: string; value: unknown; numericValue: number } => entry.numericValue !== null);
  const maxMetricAbs = Math.max(...numericMetricEntries.map(entry => Math.abs(entry.numericValue)), 0);
  const paramEntries = Object.entries(paramsSummary);
  const artifactEntries = version.artifact_manifest || version.artifactManifest || [];
  const modelInsights = version.model_insights_summary || version.modelInsightsSummary || {};
  const insightItems = (modelInsights.items || [])
    .reduce<NormalizedInsightItem[]>((items, item) => {
      const value = numericInsightValue(item?.value);
      if (!item || typeof item.name !== 'string' || value === null) return items;
      const absValue = numericInsightValue(item.abs_value) ?? Math.abs(value);
      items.push({
        ...item,
        value,
        abs_value: absValue,
      });
      return items;
    }, [])
    .sort((left, right) => (right.abs_value ?? Math.abs(right.value)) - (left.abs_value ?? Math.abs(left.value)));
  const topInsightItems = insightItems.slice(0, 20);
  const maxInsightAbs = Math.max(...topInsightItems.map(item => item.abs_value ?? Math.abs(item.value)), 0);
  const insightKind = modelInsights.kind || 'unknown';
  const topInsightItem = insightItems[0];
  const insightItemCount = version.model_insights_item_count || version.modelInsightsItemCount || insightItems.length;
  const routingAliases = version.routing_aliases || version.routingAliases || [];
  const canPromote = version.can_promote ?? version.canPromote ?? false;

  const copyEndpoint = async () => {
    if (!version.endpoint_url) return;
    await navigator.clipboard.writeText(version.endpoint_url);
    toast.success('Endpoint URL copied to clipboard.');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyText = async (text: string, message: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  };

  const handleSuccess = () => {
    onActionSuccess();
    // Keep user on details tab to see updated state
    setActiveTab('details');
  };

  const runAction = async (action: 'build' | 'deploy' | 'health') => {
    setActionLoading(action);
    setActionResult('');
    setTechnicalDetail('');
    try {
      if (action === 'build') {
        await buildRegistryVersionPackage(version.id);
        setActionResult('Build package request accepted.');
        toast.success('Build package started.');
      } else if (action === 'deploy') {
        await deployRegistryVersion(version.id);
        setActionResult('Deploy request accepted. Endpoint health will update after startup.');
        toast.success('Deploy started.');
      } else {
        const result = await checkRegistryVersionHealth(version.id);
        const health = result.health as { message?: string; reason_code?: string; technical_detail?: string } | undefined;
        const message = result.endpoint_status === 'healthy'
          ? 'Endpoint is healthy.'
          : endpointActionMessage({
              message: result.message || health?.message,
              reason_code: result.reason_code || health?.reason_code,
              endpoint_error: result.endpoint_error,
              success: false,
            });
        setActionResult(message);
        setTechnicalDetail(String(result.technical_detail || health?.technical_detail || ''));
        toast[result.endpoint_status === 'healthy' ? 'success' : 'warning'](message);
      }
      handleSuccess();
    } catch (error) {
      const message = getApiErrorMessage(error, `Failed to ${action} version.`);
      setActionResult(message);
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const runSmokeTest = async () => {
    setActionLoading('smoke');
    setActionResult('');
    setSmokeResult(null);
    setTechnicalDetail('');
    try {
      const parsed = JSON.parse(smokePayload) as { features?: Record<string, unknown> };
      if (!parsed || typeof parsed !== 'object' || !parsed.features || typeof parsed.features !== 'object') {
        throw new Error('Smoke test payload must include a features object.');
      }
      const result = await smokeTestRegistryVersion(version.id, { features: parsed.features });
      setSmokeResult(result);
      if (result.success === false) {
        const message = endpointActionMessage(result);
        setActionResult(message);
        setTechnicalDetail(result.technical_detail || '');
        toast.warning(message);
      } else {
        toast.success('Smoke test completed.');
      }
    } catch (error) {
      const message = error instanceof SyntaxError
        ? 'Smoke test JSON is invalid.'
        : getApiErrorMessage(error, error instanceof Error ? error.message : 'Smoke test failed.');
      setActionResult(message);
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="flex flex-col border border-border rounded-xl bg-surface shadow-sm overflow-hidden">
      
      {/* Tab Navigation */}
      <div className="flex border-b border-border bg-muted px-4 pt-3">
        {(['details', 'insights', 'metrics', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-semibold capitalize border-b-2 transition-colors ${
              activeTab === tab 
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            {tab}
          </button>
        ))}
        <div className="flex-1"></div>
      </div>

      <div className="p-6">
        {activeTab === 'details' && (
          <div className="flex flex-col gap-6">
            
            {/* A. Version Control Header */}
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div>
                <h3 className="text-3xl font-extrabold text-foreground flex items-center gap-3">
                  Version {formatVersion(version.version)}
                  {isProd && (
                    <span className="bg-emerald-500 text-white text-xs px-2.5 py-0.5 rounded uppercase tracking-wider font-bold shadow-sm">
                      PRODUCTION ACTIVE
                    </span>
                  )}
                  {!isProd && (
                    <span className="bg-muted text-muted-foreground text-xs px-2.5 py-0.5 rounded uppercase tracking-wider font-bold">
                      {version.stage}
                    </span>
                  )}
                </h3>
                <p className="text-sm text-muted-foreground mt-2 font-medium">
                  Source: {version.source_type.replace('_', ' ')} {version.source_training_job_id ? `· Job ID: ${version.source_training_job_id}` : ''}
                </p>
              </div>

              {/* B. Action Row */}
              <div className="flex flex-wrap gap-2 md:gap-3">
                <Button 
                  size="md" 
                  variant="secondary"
                  icon={<GitCompare className="h-4 w-4" />} 
                  onClick={() => setIsCompareModalOpen(true)}
                >
                  Compare
                </Button>
                
                {version.endpoint_url && (
                  <Button 
                    size="md" 
                    variant="secondary" 
                    icon={<ExternalLink className="h-4 w-4" />}
                    onClick={() => window.open(`/dashboard/home/model-testing`, '_blank')}
                  >
                    Test Predictions
                  </Button>
                )}

                <Button 
                  size="md" 
                  variant="secondary"
                  icon={<RotateCcw className="h-4 w-4" />} 
                  disabled={isProd}
                  onClick={() => setIsRollbackModalOpen(true)}
                  title={isProd ? 'Cannot rollback the active production version' : 'Rollback to this version'}
                >
                  Rollback
                </Button>
                
                {isProd ? (
                  <div className="flex items-center px-4 py-2 text-sm font-bold text-success bg-success-subtle border border-success/20 rounded-lg">
                    Registry production active
                  </div>
                ) : (
                  <Button 
                    size="md" 
                    variant="primary"
                    icon={<ArrowUpCircle className="h-4 w-4" />} 
                    disabled={!canPromote}
                    onClick={() => setIsPromoteModalOpen(true)}
                    title={!canPromote ? 'Deploy this version before promoting it to an alias.' : 'Promote to a stable routing alias'}
                  >
                    Promote Alias
                  </Button>
                )}
              </div>
            </div>

            {/* C. Production Semantics Callout */}
            {isProd && (
              <div className="bg-success-subtle border border-success/20 rounded-lg p-4 flex flex-col gap-1 text-success">
                <div className="text-sm">
                  <strong>Registry production marker is active.</strong> Stable alias routing is available through the production alias endpoint when configured.
                </div>
                <div className="text-xs text-success/80">
                  Version-specific endpoints remain unchanged.
                </div>
              </div>
            )}

            <div className="grid lg:grid-cols-2 gap-6">
              <div className="flex flex-col gap-4 bg-surface border border-border rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center justify-between border-b border-border pb-2">
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-blue-500" />
                    Tracking Status
                  </span>
                  <span className={classNames(
                    'text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border',
                    trackingBadge(version.tracking_status),
                  )}>
                    {trackingLabel(version.tracking_status)}
                  </span>
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {trackingDescription(version.tracking_status)}
                </p>
                {version.tracking_status === 'completed' && (
                  <div className="rounded-lg border border-success/20 bg-success-subtle p-3 text-sm text-success">
                    Completed: metadata is available in Model Evolution and internal MLflow.
                  </div>
                )}
                {version.tracking_status === 'skipped' && (
                  <div className="rounded-lg border border-primary/20 bg-primary-subtle p-3 text-sm text-primary">
                    MLflow Disabled: Native Registry summaries are still available for metrics, params, insights, compare, and deploy review.
                  </div>
                )}
                {version.tracking_status === 'failed' && (
                  <div className="rounded-lg border border-warning/20 bg-warning-subtle p-3 text-sm text-warning">
                    Native Registry Ingested: MLflow logging failed, but captured metadata was retained.
                  </div>
                )}
                {version.tracking_ingested_at && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Ingested At</p>
                    <p className="text-sm text-foreground font-medium">{new Date(version.tracking_ingested_at).toLocaleString()}</p>
                  </div>
                )}
                {version.tracking_error && (
                  <div className="rounded-lg border border-warning/20 bg-warning-subtle p-3 text-sm text-warning">
                    {version.tracking_error}
                  </div>
                )}
                {version.mlflow_run_id && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Internal Lineage Run</p>
                    <code className="text-xs font-mono text-foreground bg-muted border border-border px-2 py-1 rounded break-all block select-all">
                      {version.mlflow_run_id}
                    </code>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 bg-surface border border-border rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center justify-between border-b border-border pb-2">
                  Deployability
                  <span className={classNames(
                    "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border",
                    deployabilityBadge(version.deployability_status)
                  )}>
                    {version.deployability_status || 'unknown'}
                  </span>
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {version.deployability_reason || 'Deployability has not been computed for this version yet.'}
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-muted border border-border p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Artifacts</p>
                    <p className="text-xl font-bold text-foreground">{artifactEntries.length}</p>
                  </div>
                  <div className="rounded-lg bg-muted border border-border p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Metrics</p>
                    <p className="text-xl font-bold text-foreground">{metricEntries.length}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-5 bg-surface border border-border rounded-xl p-5 shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 border-b border-border pb-4">
                <div>
                  <h4 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                    <Rocket className="h-4 w-4 text-blue-500" />
                    Deployment Actions
                  </h4>
                  <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
                    Deployment is available only for versions with a supported serving artifact. Track-only versions can still be reviewed and compared.
                  </p>
                </div>
                <span className={classNames(
                  "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border self-start",
                  deployabilityBadge(version.deployability_status)
                )}>
                  {version.deployability_status || 'unknown'}
                </span>
              </div>

              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    size="md"
                    variant="secondary"
                    icon={<Package className="h-4 w-4" />}
                    disabled={!version.can_build || actionLoading !== null}
                    onClick={() => void runAction('build')}
                    title={!version.can_build ? version.build_disabled_reason : 'Build deploy package'}
                  >
                    {actionLoading === 'build' ? 'Building...' : 'Build Package'}
                  </Button>
                  <Button
                    size="md"
                    variant="primary"
                    icon={<Rocket className="h-4 w-4" />}
                    disabled={!version.can_deploy || actionLoading !== null}
                    onClick={() => void runAction('deploy')}
                    title={!version.can_deploy ? version.deploy_disabled_reason : 'Deploy endpoint'}
                  >
                    {actionLoading === 'deploy' ? 'Deploying...' : 'Deploy'}
                  </Button>
                  <Button
                    size="md"
                    variant="secondary"
                    icon={<HeartPulse className="h-4 w-4" />}
                    disabled={!version.endpoint_url || actionLoading !== null}
                    onClick={() => void runAction('health')}
                    title={!version.endpoint_url ? 'Deploy this version before checking health.' : 'Check endpoint health'}
                  >
                    {actionLoading === 'health' ? 'Checking...' : 'Check Health'}
                  </Button>
                  <Button
                    size="md"
                    variant="secondary"
                    icon={<Play className="h-4 w-4" />}
                    disabled={!version.endpoint_url || actionLoading !== null}
                    onClick={() => void runSmokeTest()}
                    title={!version.endpoint_url ? 'Deploy this version before smoke testing.' : 'Run smoke test'}
                  >
                    {actionLoading === 'smoke' ? 'Running...' : 'Run Smoke Test'}
                  </Button>
                </div>

                {(!version.can_build || !version.can_deploy) && (
                  <div className="rounded-lg border border-warning/20 bg-warning-subtle p-3 text-sm text-warning">
                    {!version.can_build
                      ? (version.build_disabled_reason || version.deployability_reason || 'Build is disabled for this version.')
                      : (version.deploy_disabled_reason || 'Build package before deploying this version.')}
                  </div>
                )}

                <div className="grid gap-3 text-sm md:grid-cols-3">
                  <div className="rounded-lg bg-muted border border-border p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Build Status</p>
                    <p className="font-semibold text-foreground">{version.build_status || '-'}</p>
                  </div>
                  <div className="rounded-lg bg-muted border border-border p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Endpoint Status</p>
                    <p className="font-semibold text-foreground">{version.endpoint_status || version.deployment_status || '-'}</p>
                  </div>
                  <div className="rounded-lg bg-muted border border-border p-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Deployability</p>
                    <p className="font-semibold text-foreground">{version.deployability_status || 'unknown'}</p>
                  </div>
                </div>

                {(version.build_error || version.endpoint_error || actionResult) && (
                  <div className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground break-words">
                    <p>{actionResult || version.endpoint_error || version.build_error}</p>
                    {technicalDetail && (
                      <details className="mt-3 rounded border border-border bg-surface p-2 text-xs text-muted-foreground">
                        <summary className="cursor-pointer font-semibold text-muted-foreground">Technical detail</summary>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">
                          {technicalDetail}
                        </pre>
                      </details>
                    )}
                  </div>
                )}

                <div className="rounded-xl border border-border bg-muted/60 p-4">
                  <div className="mb-3">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Smoke Test</p>
                    <p className="text-xs text-muted-foreground mt-1">Uses the existing predict schema.</p>
                  </div>
                  <div className="grid gap-4 2xl:grid-cols-2">
                    <textarea
                      value={smokePayload}
                      onChange={(event) => setSmokePayload(event.target.value)}
                      className="min-h-40 w-full rounded-lg border border-border bg-[#111827] p-3 font-mono text-xs text-emerald-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                      spellCheck={false}
                    />
                    <div className="min-h-40 rounded-lg border border-border bg-surface p-3">
                      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Response</p>
                      {smokeResult !== null ? (
                        <pre className="max-h-72 overflow-auto rounded-lg border border-gray-800 bg-[#111827] p-3 text-xs text-gray-100">
                          {JSON.stringify(withoutTechnicalDetail(smokeResult), null, 2)}
                        </pre>
                      ) : (
                        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-border bg-muted text-sm text-muted-foreground">
                          Run a smoke test to see the endpoint response.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid xl:grid-cols-3 gap-6">
              <div className="flex flex-col gap-3 bg-surface border border-border rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2 border-b border-border pb-2">
                  <Gauge className="h-4 w-4 text-emerald-500" />
                  Metrics
                </h4>
                {metricEntries.length > 0 ? (
                  <div className="grid gap-2">
                    {metricEntries.map(([name, value]) => (
                      <div key={name} className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2">
                        <span className="text-sm font-medium text-muted-foreground truncate" title={name}>{name}</span>
                        <span className="text-sm font-mono font-semibold text-foreground">{formatValue(value)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No metrics captured. Training scripts can write SM_OUTPUT_DIR/metrics.json or print METRIC_JSON lines.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3 bg-surface border border-border rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2 border-b border-border pb-2">
                  <SlidersHorizontal className="h-4 w-4 text-purple-500" />
                  Params
                </h4>
                {paramEntries.length > 0 ? (
                  <div className="grid gap-2">
                    {paramEntries.map(([name, value]) => (
                      <div key={name} className="flex items-start justify-between gap-3 rounded-lg bg-muted px-3 py-2">
                        <span className="text-sm font-medium text-muted-foreground break-all">{name}</span>
                        <span className="text-sm font-mono text-foreground text-right break-all">{formatValue(value)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No params captured. Training scripts can write SM_OUTPUT_DIR/params.json.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3 bg-surface border border-border rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2 border-b border-border pb-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Source Training Job
                </h4>
                {version.source_training_job_id ? (
                  <div className="grid gap-3 text-sm">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Job</p>
                      <a
                        href={`/dashboard/model-training/${version.source_training_job_id}`}
                        className="font-semibold text-blue-600 hover:text-blue-800"
                      >
                        #{version.source_training_job_id} {version.source_training_job_name || ''}
                      </a>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Status</p>
                        <p className="font-medium text-foreground">{version.source_training_job_status || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Backend</p>
                        <p className="font-medium text-foreground">{version.source_training_job_backend || '-'}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">This version was not registered from a training job.</p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 bg-surface border border-border rounded-xl p-5 shadow-sm">
              <h4 className="text-sm font-bold text-foreground uppercase tracking-wider border-b border-border pb-2">
                Artifacts / Weights
              </h4>
              {artifactEntries.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="bg-muted text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Path</th>
                        <th className="px-3 py-2 text-left font-semibold">Kind</th>
                        <th className="px-3 py-2 text-right font-semibold">Size</th>
                        <th className="px-3 py-2 text-left font-semibold">SHA256</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {artifactEntries.map((item, index) => (
                        <tr key={`${item.path}-${index}`}>
                          <td className="px-3 py-2 font-mono text-xs text-foreground break-all">{item.path}</td>
                          <td className="px-3 py-2">
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">
                              {item.kind || 'other'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{formatBytes(item.size_bytes)}</td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.sha256 ? `${item.sha256.slice(0, 12)}...` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No artifact manifest available yet.</p>
              )}
            </div>

            {/* F. Drift Summary Card */}
            <DriftSummaryCard
              driftSummary={version.drift_summary || version.driftSummary}
              modelProjectId={version.project_id}
            />

            <div className="flex flex-col gap-3 bg-surface border border-border rounded-xl p-5 shadow-sm">
              <h4 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center justify-between border-b border-border pb-2">
                <span className="inline-flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-indigo-500" />
                  Routing Aliases
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border bg-indigo-50 text-indigo-700 border-indigo-200">
                  API Proxy
                </span>
              </h4>
              {routingAliases.length > 0 ? (
                <div className="grid gap-3">
                  {routingAliases.map((alias) => {
                    const aliasName = alias.alias_name || alias.aliasName || 'alias';
                    const endpointUrl = alias.endpoint_url || alias.endpointUrl || '';
                    const promotedAt = alias.promoted_at || alias.promotedAt;
                    return (
                      <div key={`${aliasName}-${endpointUrl}`} className="rounded-lg border border-border bg-muted p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-indigo-700">
                                {aliasName}
                              </span>
                              <span className="rounded-full bg-success-subtle px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-success">
                                {alias.status || 'active'}
                              </span>
                            </div>
                            <code className="mt-3 block break-all rounded border border-border bg-surface px-3 py-2 text-xs font-mono text-foreground">
                              {endpointUrl || 'Alias endpoint unavailable'}
                            </code>
                            {promotedAt && (
                              <p className="mt-2 text-xs text-muted-foreground">
                                Promoted at {new Date(promotedAt).toLocaleString()}
                              </p>
                            )}
                          </div>
                          {endpointUrl && (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<Copy className="h-3.5 w-3.5" />}
                              onClick={() => void copyText(endpointUrl, 'Alias endpoint copied.')}
                            >
                              Copy
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No alias points to this version yet. Promote this version to production, latest, or champion to create a stable alias endpoint.
                </p>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-6 mt-2">
              {/* D. Deployment Info */}
              <div className="flex flex-col gap-4 bg-surface border border-border rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center justify-between border-b border-border pb-2">
                  Deployment Info
                  {version.endpoint_url ? (
                    <span className="text-[10px] bg-primary-subtle text-primary px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Ready</span>
                  ) : (
                    <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">No Endpoint</span>
                  )}
                </h4>
                
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Image Name</p>
                  <p className="text-sm font-mono text-foreground break-all">{version.image_name || 'N/A'}</p>
                </div>
                
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-2 mb-1">
                    <Terminal className="h-3 w-3" /> Endpoint URL
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-foreground bg-muted border border-border px-3 py-2 rounded flex-1 truncate select-all">
                      {version.endpoint_url || 'N/A'}
                    </code>
                    {version.endpoint_url && (
                      <Button size="sm" variant="secondary" onClick={copyEndpoint} className="shrink-0 flex items-center gap-1.5 px-3 py-2 border border-border">
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                        <span className={copied ? "text-emerald-700" : "text-foreground"}>{copied ? 'Copied' : 'Copy'}</span>
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* E. Artifact Info */}
              <div className="flex flex-col gap-4 bg-surface border border-border rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-foreground uppercase tracking-wider border-b border-border pb-2">Artifact Info</h4>
                
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Artifact URI</p>
                  <p className="text-sm font-mono text-foreground break-all">{version.artifact_uri || 'N/A'}</p>
                </div>

                {/* Optional internal MLflow lineage. Native Registry remains the primary product flow. */}
                <div className="border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">MLflow Run</p>
                    {version.mlflow_run_url ? (
                      <a
                        href={version.mlflow_run_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary-hover bg-primary-subtle border border-primary/20 px-3 py-1 rounded-full transition-colors"
                        title="Open in MLflow (internal/admin tool)"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open in MLflow
                      </a>
                    ) : null}
                  </div>

                  {version.mlflow_run_id ? (
                    <div className="flex flex-col gap-2">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-0.5">Run ID</p>
                        <code className="text-xs font-mono text-foreground bg-muted border border-border px-2 py-1 rounded break-all block select-all">
                          {version.mlflow_run_id}
                        </code>
                      </div>
                      {version.mlflow_model_uri && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase mb-0.5">Model URI</p>
                          <code className="text-xs font-mono text-foreground bg-muted border border-border px-2 py-1 rounded break-all block">
                            {version.mlflow_model_uri}
                          </code>
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                        Model Evolution displays metrics, params, insights, and deployability from the Native Registry.
                        MLflow lineage is optional internal metadata for audit and artifact deep dives.{' '}
                        <span className="font-medium text-amber-600">Opening MLflow is not required for normal review or deployment.</span>
                      </p>
                    </div>
                  ) : (
                    <div className="bg-muted border border-dashed border-border rounded-lg p-3 flex flex-col gap-1">
                      <p className="text-xs font-semibold text-muted-foreground">No MLflow run linked</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Model Evolution still uses Native Registry summaries from the ingested training artifact.
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Created</p>
                    <p className="text-sm text-foreground font-medium">{new Date(version.created_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Updated</p>
                    <p className="text-sm text-foreground font-medium">{new Date(version.updated_at).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}


        {activeTab === 'insights' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h3 className="text-2xl font-extrabold text-foreground flex items-center gap-3">
                <BarChart3 className="h-6 w-6 text-blue-500" />
                Model Insights
              </h3>
              <p className="text-sm text-muted-foreground max-w-3xl">
                Feature importance, coefficients, and lightweight model summaries are captured from optional training artifacts and visualized inside Model Evolution.
              </p>
            </div>

            {insightItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted p-8 text-center">
                <BarChart3 className="mx-auto h-10 w-10 text-muted-foreground" />
                <h4 className="mt-3 text-base font-bold text-foreground">No model insights were logged for this version.</h4>
                <p className="mt-2 text-sm text-muted-foreground">
                  Log feature importance or coefficient data as model_insights.json to visualize it here.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kind</p>
                    <p className="mt-1 text-sm font-bold capitalize text-foreground">{insightKind.replace('_', ' ')}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Items</p>
                    <p className="mt-1 text-sm font-bold text-foreground">{insightItemCount}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top Feature</p>
                    <p className="mt-1 truncate text-sm font-bold text-foreground" title={topInsightItem?.name}>{topInsightItem?.name || '-'}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</p>
                    <p className="mt-1 truncate text-sm font-bold text-foreground">{modelInsights.source || 'training_artifact'}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
                    <div>
                      <h4 className="text-sm font-bold uppercase tracking-wider text-foreground">
                        {insightKind === 'coefficients' ? 'Top Coefficients' : 'Top Feature Importance'}
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Showing top {topInsightItems.length} of {modelInsights.feature_count || insightItems.length} captured items.
                      </p>
                    </div>
                    <span className="rounded-full border border-primary/20 bg-primary-subtle px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                      {insightKind.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="mt-5 flex flex-col gap-4">
                    {topInsightItems.map((item) => {
                      const magnitude = item.abs_value ?? Math.abs(item.value);
                      const width = maxInsightAbs > 0 ? Math.max(3, (magnitude / maxInsightAbs) * 100) : 0;
                      const negative = item.value < 0;
                      return (
                        <div key={`${item.rank || item.name}-${item.name}-${item.class_name || ''}`} className="grid items-center gap-3 md:grid-cols-[minmax(160px,260px)_1fr_96px]">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground" title={item.name}>{item.name}</p>
                            {item.class_name && <p className="truncate text-[11px] text-muted-foreground">{item.class_name}</p>}
                          </div>
                          <div className="h-6 overflow-hidden rounded-md bg-muted ring-1 ring-border">
                            <div
                              className={classNames(
                                "h-6 rounded-md shadow-sm",
                                negative ? "bg-rose-500" : "bg-blue-600"
                              )}
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <p className="text-right font-mono text-sm font-semibold text-foreground">
                            {formatInsightValue(item.value)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
                  <h4 className="border-b border-border pb-3 text-sm font-bold uppercase tracking-wider text-foreground">
                    Insight Table
                  </h4>
                  <div className="mt-4 max-h-[560px] overflow-auto">
                    <table className="min-w-full divide-y divide-border text-sm">
                      <thead className="sticky top-0 z-10 bg-muted text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-right font-semibold">Rank</th>
                          <th className="px-3 py-2 text-left font-semibold">Feature</th>
                          {insightKind === 'coefficients' && <th className="px-3 py-2 text-left font-semibold">Class</th>}
                          <th className="px-3 py-2 text-right font-semibold">
                            {insightKind === 'coefficients' ? 'Coefficient' : 'Importance'}
                          </th>
                          <th className="px-3 py-2 text-right font-semibold">Absolute</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {insightItems.slice(0, 500).map((item, index) => (
                          <tr key={`${item.name}-${item.class_name || ''}-${index}`} className="hover:bg-muted">
                            <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{item.rank || index + 1}</td>
                            <td className="px-3 py-2 font-medium text-foreground">{item.name}</td>
                            {insightKind === 'coefficients' && <td className="px-3 py-2 text-muted-foreground">{item.class_name || '-'}</td>}
                            <td className="px-3 py-2 text-right font-mono text-xs text-foreground">{formatInsightValue(item.value)}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{formatInsightValue(item.abs_value ?? Math.abs(item.value))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'metrics' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h3 className="text-2xl font-extrabold text-foreground flex items-center gap-3">
                <Gauge className="h-6 w-6 text-emerald-500" />
                Metrics
              </h3>
              <p className="text-sm text-muted-foreground max-w-3xl">
                Captured metrics from the training artifact summary. Metric history appears below when structured time-series records are available.
              </p>
            </div>

            {metricEntries.length > 0 ? (
              <>
                {scalarMetricEntries.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {scalarMetricEntries.slice(0, 8).map(([name, value]) => (
                      <div key={`summary-${name}`} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                        <p className="truncate text-xs font-bold uppercase tracking-wider text-muted-foreground" title={name}>
                          {name.replace(/_/g, ' ')}
                        </p>
                        <p
                          className="mt-2 truncate font-mono text-2xl font-extrabold text-foreground"
                          title={formatValue(value)}
                        >
                          {shortValue(value, 36)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {numericMetricEntries.length > 0 && (
                  <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
                    <h4 className="border-b border-border pb-3 text-sm font-bold uppercase tracking-wider text-foreground">
                      Metric Overview
                    </h4>
                    <div className="mt-5 flex flex-col gap-3">
                      {numericMetricEntries.map((entry) => {
                        const magnitude = Math.abs(entry.numericValue);
                        const width = maxMetricAbs > 0 ? Math.max(3, (magnitude / maxMetricAbs) * 100) : 0;
                        const negative = entry.numericValue < 0;
                        return (
                          <div key={`metric-bar-${entry.name}`} className="grid items-center gap-3 md:grid-cols-[minmax(160px,260px)_1fr_96px]">
                            <p className="truncate text-sm font-semibold text-foreground" title={entry.name}>
                              {entry.name.replace(/_/g, ' ')}
                            </p>
                            <div className="h-5 overflow-hidden rounded-md bg-muted ring-1 ring-border">
                              <div
                                className={classNames(
                                  "h-5 rounded-md shadow-sm",
                                  negative ? "bg-rose-500" : "bg-emerald-500"
                                )}
                                style={{ width: `${width}%` }}
                              />
                            </div>
                            <p className="text-right font-mono text-sm font-semibold text-foreground">
                              {formatValue(entry.value)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
                  <h4 className="border-b border-border pb-3 text-sm font-bold uppercase tracking-wider text-foreground">
                    Metric Table
                  </h4>
                  <div className="mt-4 overflow-auto">
                    <table className="min-w-full divide-y divide-border text-sm">
                      <thead className="bg-muted text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Metric</th>
                          <th className="px-3 py-2 text-right font-semibold">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {scalarMetricEntries.map(([name, value]) => (
                          <tr key={`metric-row-${name}`} className="hover:bg-muted">
                            <td className="px-3 py-2 font-medium text-foreground">{name}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs text-foreground" title={formatValue(value)}>
                              {shortValue(value, 120)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {objectMetricEntries.length > 0 && (
                  <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
                    <h4 className="border-b border-border pb-3 text-sm font-bold uppercase tracking-wider text-foreground">
                      Metric Metadata
                    </h4>
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      {objectMetricEntries.map(([name, value]) => (
                        <div key={`metric-object-${name}`} className="rounded-lg border border-border bg-muted p-4">
                          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{name.replace(/_/g, ' ')}</p>
                          {isPlainRecord(value) ? (
                            <dl className="grid gap-2">
                              {Object.entries(value).slice(0, 20).map(([key, item]) => (
                                <div key={key} className="grid grid-cols-[minmax(120px,220px)_1fr] gap-3 text-sm">
                                  <dt className="truncate font-medium text-muted-foreground" title={key}>{key}</dt>
                                  <dd className="truncate font-mono text-foreground" title={formatValue(item)}>{shortValue(item, 90)}</dd>
                                </div>
                              ))}
                            </dl>
                          ) : (
                            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface p-3 text-xs text-foreground">
                              {formatValue(value)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-muted p-8 text-center">
                <Gauge className="mx-auto h-10 w-10 text-muted-foreground" />
                <h4 className="mt-3 text-base font-bold text-foreground">No metrics captured for this version.</h4>
                <p className="mt-2 text-sm text-muted-foreground">
                  Training scripts can write SM_OUTPUT_DIR/metrics.json or print METRIC_JSON lines.
                </p>
              </div>
            )}

            <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
              <div className="mb-4">
                <h4 className="text-sm font-bold uppercase tracking-wider text-foreground">Metric History</h4>
                <p className="mt-1 text-xs text-muted-foreground">Optional structured metric records across training steps.</p>
              </div>
              <ModelMetricsPanel familyId={family.id} versionId={version.id} />
            </div>
          </div>
        )}
        
        {activeTab === 'history' && <ModelHistoryTimeline familyId={family.id} />}

      </div>

      {isPromoteModalOpen && (
        <PromoteVersionModal 
          family={family} 
          version={version} 
          onClose={() => setIsPromoteModalOpen(false)} 
          onSuccess={() => {
            setIsPromoteModalOpen(false);
            handleSuccess();
          }} 
        />
      )}

      {isRollbackModalOpen && (
        <RollbackVersionModal 
          family={family} 
          version={version} 
          onClose={() => setIsRollbackModalOpen(false)} 
          onSuccess={() => {
            setIsRollbackModalOpen(false);
            handleSuccess();
          }} 
        />
      )}

      {isCompareModalOpen && (
        <VersionComparisonModal 
          family={family} 
          versions={allVersions} 
          onClose={() => setIsCompareModalOpen(false)} 
        />
      )}
    </div>
  );
}
