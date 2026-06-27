import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DriftSummary, RegistryFamily, RegistryModelInsightItem, RegistryVersion } from '../../types/modelApi';
import { Copy, Terminal, ExternalLink, ArrowUpCircle, RotateCcw, GitCompare, Check, FileText, Gauge, SlidersHorizontal, ShieldCheck, Package, Rocket, HeartPulse, Play, BarChart3, Activity } from 'lucide-react';
import { formatVersion } from '../../lib/formatters';
import { Button } from '../../components/ui/Button';
import { toast } from '../../lib/toast';
import { buildRegistryVersionPackage, checkRegistryVersionHealth, deployRegistryVersion, smokeTestRegistryVersion } from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';

import { ModelMetricsPanel } from './ModelMetricsPanel';
import { ModelHistoryTimeline } from './ModelHistoryTimeline';
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
  return JSON.stringify(value);
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
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'track_only':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'invalid':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200';
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
interface DriftSummaryCardProps {
  driftSummary?: DriftSummary;
  modelApiHashid?: string;
}

function driftStatusBadge(status?: string) {
  switch (status) {
    case 'drift_detected':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'healthy':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'report_unavailable':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'not_configured':
      return 'bg-gray-100 text-gray-500 border-gray-200';
    default:
      return 'bg-gray-100 text-gray-500 border-gray-200';
  }
}

function driftStatusLabel(status?: string) {
  switch (status) {
    case 'drift_detected': return 'Drift detected';
    case 'healthy': return 'No drift detected';
    case 'report_unavailable': return 'Report unavailable';
    case 'not_configured': return 'Not configured';
    case 'unknown': return 'Unknown';
    default: return 'Not configured';
  }
}

function DriftSummaryCard({ driftSummary, modelApiHashid }: DriftSummaryCardProps) {
  const navigate = useNavigate();
  const ds = driftSummary;
  const fallbackUrl = modelApiHashid
    ? `/dashboard/drift-monitoring/${modelApiHashid}`
    : '/dashboard/drift-monitoring';
  const reportPageUrl = ds?.report_page_url || ds?.reportPageUrl || fallbackUrl;
  const driftPercent = ds?.drift_percent ?? ds?.driftPercent ?? null;
  const lastCheckedAt = ds?.last_checked_at || ds?.lastCheckedAt;
  const status = ds?.status || 'not_configured';

  return (
    <div className="flex flex-col gap-3 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
      <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center justify-between border-b border-gray-100 pb-2">
        <span className="inline-flex items-center gap-2">
          <Activity className="h-4 w-4 text-violet-500" />
          Drift Summary
        </span>
        <span className={classNames(
          'text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border',
          driftStatusBadge(status),
        )}>
          {driftStatusLabel(status)}
        </span>
      </h4>

      {(!ds || status === 'not_configured') && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">No drift report is available for this version yet.</p>
          <button
            className="self-start inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 hover:text-violet-900 bg-violet-50 hover:bg-violet-100 border border-violet-200 px-3 py-1.5 rounded-lg transition-colors"
            onClick={() => navigate(reportPageUrl)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Drift Monitoring
          </button>
        </div>
      )}

      {ds && status !== 'not_configured' && (
        <div className="flex flex-col gap-3">
          {driftPercent !== null && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Latest Drift</p>
              <p className={classNames(
                'text-2xl font-extrabold',
                status === 'drift_detected' ? 'text-red-600' : 'text-emerald-600',
              )}>
                {driftPercent}%
              </p>
              {(ds.drifted_features_count !== null && ds.total_features) && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {ds.drifted_features_count} / {ds.total_features} features drifted
                </p>
              )}
            </div>
          )}

          {lastCheckedAt && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Last Checked</p>
              <p className="text-sm text-gray-700">{new Date(lastCheckedAt).toLocaleString()}</p>
            </div>
          )}

          {ds.message && (
            <p className="text-xs text-gray-500 leading-relaxed">{ds.message}</p>
          )}

          {status === 'report_unavailable' && (
            <p className="text-xs text-amber-600 font-medium">Report link unavailable</p>
          )}

          {status !== 'report_unavailable' && (
            <button
              className="self-start inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 hover:text-violet-900 bg-violet-50 hover:bg-violet-100 border border-violet-200 px-3 py-1.5 rounded-lg transition-colors"
              onClick={() => navigate(reportPageUrl)}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View drift report
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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

  const copyEndpoint = async () => {
    if (!version.endpoint_url) return;
    await navigator.clipboard.writeText(version.endpoint_url);
    toast.success('Endpoint URL copied to clipboard.');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
    <div className="flex flex-col border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
      
      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200 bg-gray-50 px-4 pt-3">
        {(['details', 'insights', 'metrics', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-semibold capitalize border-b-2 transition-colors ${
              activeTab === tab 
                ? 'border-blue-600 text-blue-600' 
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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
                <h3 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
                  Version {formatVersion(version.version)}
                  {isProd && (
                    <span className="bg-emerald-500 text-white text-xs px-2.5 py-0.5 rounded uppercase tracking-wider font-bold shadow-sm">
                      PRODUCTION ACTIVE
                    </span>
                  )}
                  {!isProd && (
                    <span className="bg-gray-100 text-gray-600 text-xs px-2.5 py-0.5 rounded uppercase tracking-wider font-bold">
                      {version.stage}
                    </span>
                  )}
                </h3>
                <p className="text-sm text-gray-500 mt-2 font-medium">
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
                  <div className="flex items-center px-4 py-2 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
                    Registry production active
                  </div>
                ) : (
                  <Button 
                    size="md" 
                    variant="primary"
                    icon={<ArrowUpCircle className="h-4 w-4" />} 
                    onClick={() => setIsPromoteModalOpen(true)}
                  >
                    Promote to Production
                  </Button>
                )}
              </div>
            </div>

            {/* C. Production Semantics Callout */}
            {isProd && (
              <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-4 flex flex-col gap-1 text-emerald-800">
                <div className="text-sm">
                  <strong>Registry production marker is active.</strong> Live traffic routing is not enabled yet.
                </div>
                <div className="text-xs text-emerald-700/80">
                  Versioned endpoints remain unchanged until Phase 11.
                </div>
              </div>
            )}

            <div className="grid lg:grid-cols-2 gap-6">
              <div className="flex flex-col gap-4 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center justify-between border-b border-gray-100 pb-2">
                  <span className="inline-flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-blue-500" />
                    Tracking Status
                  </span>
                  <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                    {version.tracking_status || 'not synced'}
                  </span>
                </h4>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Experiment tracking is captured automatically from training artifacts when available.
                </p>
                {version.tracking_ingested_at && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Ingested At</p>
                    <p className="text-sm text-gray-800 font-medium">{new Date(version.tracking_ingested_at).toLocaleString()}</p>
                  </div>
                )}
                {version.tracking_error && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    {version.tracking_error}
                  </div>
                )}
                {version.mlflow_run_id && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Internal Lineage Run</p>
                    <code className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-2 py-1 rounded break-all block select-all">
                      {version.mlflow_run_id}
                    </code>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center justify-between border-b border-gray-100 pb-2">
                  Deployability
                  <span className={classNames(
                    "text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border",
                    deployabilityBadge(version.deployability_status)
                  )}>
                    {version.deployability_status || 'unknown'}
                  </span>
                </h4>
                <p className="text-sm text-gray-600 leading-relaxed">
                  {version.deployability_reason || 'Deployability has not been computed for this version yet.'}
                </p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Artifacts</p>
                    <p className="text-xl font-bold text-gray-900">{artifactEntries.length}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Metrics</p>
                    <p className="text-xl font-bold text-gray-900">{metricEntries.length}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-5 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 border-b border-gray-100 pb-4">
                <div>
                  <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
                    <Rocket className="h-4 w-4 text-blue-500" />
                    Deployment Actions
                  </h4>
                  <p className="mt-2 text-sm text-gray-600 max-w-3xl">
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
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    {!version.can_build
                      ? (version.build_disabled_reason || version.deployability_reason || 'Build is disabled for this version.')
                      : (version.deploy_disabled_reason || 'Build package before deploying this version.')}
                  </div>
                )}

                <div className="grid gap-3 text-sm md:grid-cols-3">
                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Build Status</p>
                    <p className="font-semibold text-gray-900">{version.build_status || '-'}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Endpoint Status</p>
                    <p className="font-semibold text-gray-900">{version.endpoint_status || version.deployment_status || '-'}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Deployability</p>
                    <p className="font-semibold text-gray-900">{version.deployability_status || 'unknown'}</p>
                  </div>
                </div>

                {(version.build_error || version.endpoint_error || actionResult) && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 break-words">
                    <p>{actionResult || version.endpoint_error || version.build_error}</p>
                    {technicalDetail && (
                      <details className="mt-3 rounded border border-gray-200 bg-white p-2 text-xs text-gray-500">
                        <summary className="cursor-pointer font-semibold text-gray-600">Technical detail</summary>
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">
                          {technicalDetail}
                        </pre>
                      </details>
                    )}
                  </div>
                )}

                <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                  <div className="mb-3">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Smoke Test</p>
                    <p className="text-xs text-gray-500 mt-1">Uses the existing predict schema.</p>
                  </div>
                  <div className="grid gap-4 2xl:grid-cols-2">
                    <textarea
                      value={smokePayload}
                      onChange={(event) => setSmokePayload(event.target.value)}
                      className="min-h-40 w-full rounded-lg border border-gray-200 bg-[#111827] p-3 font-mono text-xs text-emerald-100 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                      spellCheck={false}
                    />
                    <div className="min-h-40 rounded-lg border border-gray-200 bg-white p-3">
                      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Response</p>
                      {smokeResult !== null ? (
                        <pre className="max-h-72 overflow-auto rounded-lg border border-gray-800 bg-[#111827] p-3 text-xs text-gray-100">
                          {JSON.stringify(withoutTechnicalDetail(smokeResult), null, 2)}
                        </pre>
                      ) : (
                        <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
                          Run a smoke test to see the endpoint response.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid xl:grid-cols-3 gap-6">
              <div className="flex flex-col gap-3 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2 border-b border-gray-100 pb-2">
                  <Gauge className="h-4 w-4 text-emerald-500" />
                  Metrics
                </h4>
                {metricEntries.length > 0 ? (
                  <div className="grid gap-2">
                    {metricEntries.map(([name, value]) => (
                      <div key={name} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                        <span className="text-sm font-medium text-gray-600 truncate" title={name}>{name}</span>
                        <span className="text-sm font-mono font-semibold text-gray-900">{formatValue(value)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    No metrics captured. Training scripts can write SM_OUTPUT_DIR/metrics.json or print METRIC_JSON lines.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2 border-b border-gray-100 pb-2">
                  <SlidersHorizontal className="h-4 w-4 text-purple-500" />
                  Params
                </h4>
                {paramEntries.length > 0 ? (
                  <div className="grid gap-2">
                    {paramEntries.map(([name, value]) => (
                      <div key={name} className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2">
                        <span className="text-sm font-medium text-gray-600 break-all">{name}</span>
                        <span className="text-sm font-mono text-gray-900 text-right break-all">{formatValue(value)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    No params captured. Training scripts can write SM_OUTPUT_DIR/params.json.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2 border-b border-gray-100 pb-2">
                  <FileText className="h-4 w-4 text-slate-500" />
                  Source Training Job
                </h4>
                {version.source_training_job_id ? (
                  <div className="grid gap-3 text-sm">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Job</p>
                      <a
                        href={`/dashboard/model-training/${version.source_training_job_id}`}
                        className="font-semibold text-blue-600 hover:text-blue-800"
                      >
                        #{version.source_training_job_id} {version.source_training_job_name || ''}
                      </a>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Status</p>
                        <p className="font-medium text-gray-800">{version.source_training_job_status || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Backend</p>
                        <p className="font-medium text-gray-800">{version.source_training_job_backend || '-'}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">This version was not registered from a training job.</p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
              <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider border-b border-gray-100 pb-2">
                Artifacts / Weights
              </h4>
              {artifactEntries.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-100 text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Path</th>
                        <th className="px-3 py-2 text-left font-semibold">Kind</th>
                        <th className="px-3 py-2 text-right font-semibold">Size</th>
                        <th className="px-3 py-2 text-left font-semibold">SHA256</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {artifactEntries.map((item, index) => (
                        <tr key={`${item.path}-${index}`}>
                          <td className="px-3 py-2 font-mono text-xs text-gray-800 break-all">{item.path}</td>
                          <td className="px-3 py-2">
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
                              {item.kind || 'other'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-gray-600">{formatBytes(item.size_bytes)}</td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-500">{item.sha256 ? `${item.sha256.slice(0, 12)}...` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-500">No artifact manifest available yet.</p>
              )}
            </div>

            {/* F. Drift Summary Card */}
            <DriftSummaryCard driftSummary={version.drift_summary || version.driftSummary} modelApiHashid={typeof version.model_api === 'string' ? version.model_api : undefined} />

            <div className="grid md:grid-cols-2 gap-6 mt-2">
              {/* D. Deployment Info */}
              <div className="flex flex-col gap-4 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center justify-between border-b border-gray-100 pb-2">
                  Deployment Info
                  {version.endpoint_url ? (
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Ready</span>
                  ) : (
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">No Endpoint</span>
                  )}
                </h4>
                
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Image Name</p>
                  <p className="text-sm font-mono text-gray-800 break-all">{version.image_name || 'N/A'}</p>
                </div>
                
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase flex items-center gap-2 mb-1">
                    <Terminal className="h-3 w-3" /> Endpoint URL
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-gray-800 bg-gray-50 border border-gray-200 px-3 py-2 rounded flex-1 truncate select-all">
                      {version.endpoint_url || 'N/A'}
                    </code>
                    {version.endpoint_url && (
                      <Button size="sm" variant="secondary" onClick={copyEndpoint} className="shrink-0 flex items-center gap-1.5 px-3 py-2 border border-gray-300">
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-gray-500" />}
                        <span className={copied ? "text-emerald-700" : "text-gray-700"}>{copied ? 'Copied' : 'Copy'}</span>
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* E. Artifact Info */}
              <div className="flex flex-col gap-4 bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider border-b border-gray-100 pb-2">Artifact Info</h4>
                
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Artifact URI</p>
                  <p className="text-sm font-mono text-gray-800 break-all">{version.artifact_uri || 'N/A'}</p>
                </div>

                {/* Phase 10E.1: MLflow Run Lineage */}
                <div className="border-t border-gray-100 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">MLflow Run</p>
                    {version.mlflow_run_url ? (
                      <a
                        href={version.mlflow_run_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1 rounded-full transition-colors"
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
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-0.5">Run ID</p>
                        <code className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-2 py-1 rounded break-all block select-all">
                          {version.mlflow_run_id}
                        </code>
                      </div>
                      {version.mlflow_model_uri && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase mb-0.5">Model URI</p>
                          <code className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 px-2 py-1 rounded break-all block">
                            {version.mlflow_model_uri}
                          </code>
                        </div>
                      )}
                      <p className="text-[11px] text-gray-400 leading-relaxed mt-1">
                        MLflow is used for experiment lineage and artifact deep dives.
                        The Native Registry remains the source of truth for deployment and promotion.{' '}
                        <span className="font-medium text-amber-600">MLflow UI is internal/admin only.</span>
                      </p>
                    </div>
                  ) : (
                    <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg p-3 flex flex-col gap-1">
                      <p className="text-xs font-semibold text-gray-500">No MLflow run linked</p>
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        Experiment tracking is captured automatically when training artifacts are ingested.
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Created</p>
                    <p className="text-sm text-gray-800 font-medium">{new Date(version.created_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Updated</p>
                    <p className="text-sm text-gray-800 font-medium">{new Date(version.updated_at).toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}


        {activeTab === 'insights' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h3 className="text-2xl font-extrabold text-gray-900 flex items-center gap-3">
                <BarChart3 className="h-6 w-6 text-blue-500" />
                Model Insights
              </h3>
              <p className="text-sm text-gray-600 max-w-3xl">
                Feature importance, coefficients, and lightweight model summaries are captured from optional training artifacts and visualized inside Model Evolution.
              </p>
            </div>

            {insightItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                <BarChart3 className="mx-auto h-10 w-10 text-gray-300" />
                <h4 className="mt-3 text-base font-bold text-gray-800">No model insights were logged for this version.</h4>
                <p className="mt-2 text-sm text-gray-500">
                  Log feature importance or coefficient data as model_insights.json to visualize it here.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Kind</p>
                    <p className="mt-1 text-sm font-bold capitalize text-gray-900">{insightKind.replace('_', ' ')}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Items</p>
                    <p className="mt-1 text-sm font-bold text-gray-900">{insightItemCount}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Top Feature</p>
                    <p className="mt-1 truncate text-sm font-bold text-gray-900" title={topInsightItem?.name}>{topInsightItem?.name || '-'}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Source</p>
                    <p className="mt-1 truncate text-sm font-bold text-gray-900">{modelInsights.source || 'training_artifact'}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-3">
                    <div>
                      <h4 className="text-sm font-bold uppercase tracking-wider text-gray-900">
                        {insightKind === 'coefficients' ? 'Top Coefficients' : 'Top Feature Importance'}
                      </h4>
                      <p className="mt-1 text-xs text-gray-500">
                        Showing top {topInsightItems.length} of {modelInsights.feature_count || insightItems.length} captured items.
                      </p>
                    </div>
                    <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-700">
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
                            <p className="truncate text-sm font-semibold text-gray-700" title={item.name}>{item.name}</p>
                            {item.class_name && <p className="truncate text-[11px] text-gray-400">{item.class_name}</p>}
                          </div>
                          <div className="h-6 overflow-hidden rounded-md bg-gray-100 ring-1 ring-gray-100">
                            <div
                              className={classNames(
                                "h-6 rounded-md shadow-sm",
                                negative ? "bg-rose-500" : "bg-blue-600"
                              )}
                              style={{ width: `${width}%` }}
                            />
                          </div>
                          <p className="text-right font-mono text-sm font-semibold text-gray-800">
                            {formatInsightValue(item.value)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                  <h4 className="border-b border-gray-100 pb-3 text-sm font-bold uppercase tracking-wider text-gray-900">
                    Insight Table
                  </h4>
                  <div className="mt-4 max-h-[560px] overflow-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="sticky top-0 z-10 bg-gray-50 text-xs uppercase text-gray-500">
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
                      <tbody className="divide-y divide-gray-100">
                        {insightItems.slice(0, 500).map((item, index) => (
                          <tr key={`${item.name}-${item.class_name || ''}-${index}`} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-right font-mono text-xs text-gray-500">{item.rank || index + 1}</td>
                            <td className="px-3 py-2 font-medium text-gray-800">{item.name}</td>
                            {insightKind === 'coefficients' && <td className="px-3 py-2 text-gray-600">{item.class_name || '-'}</td>}
                            <td className="px-3 py-2 text-right font-mono text-xs text-gray-800">{formatInsightValue(item.value)}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs text-gray-500">{formatInsightValue(item.abs_value ?? Math.abs(item.value))}</td>
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
              <h3 className="text-2xl font-extrabold text-gray-900 flex items-center gap-3">
                <Gauge className="h-6 w-6 text-emerald-500" />
                Metrics
              </h3>
              <p className="text-sm text-gray-600 max-w-3xl">
                Captured metrics from the training artifact summary. Metric history appears below when structured time-series records are available.
              </p>
            </div>

            {metricEntries.length > 0 ? (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {metricEntries.slice(0, 8).map(([name, value]) => (
                    <div key={`summary-${name}`} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                      <p className="truncate text-xs font-bold uppercase tracking-wider text-gray-500" title={name}>
                        {name.replace(/_/g, ' ')}
                      </p>
                      <p className="mt-2 break-all font-mono text-2xl font-extrabold text-gray-900">{formatValue(value)}</p>
                    </div>
                  ))}
                </div>

                {numericMetricEntries.length > 0 && (
                  <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                    <h4 className="border-b border-gray-100 pb-3 text-sm font-bold uppercase tracking-wider text-gray-900">
                      Metric Overview
                    </h4>
                    <div className="mt-5 flex flex-col gap-3">
                      {numericMetricEntries.map((entry) => {
                        const magnitude = Math.abs(entry.numericValue);
                        const width = maxMetricAbs > 0 ? Math.max(3, (magnitude / maxMetricAbs) * 100) : 0;
                        const negative = entry.numericValue < 0;
                        return (
                          <div key={`metric-bar-${entry.name}`} className="grid items-center gap-3 md:grid-cols-[minmax(160px,260px)_1fr_96px]">
                            <p className="truncate text-sm font-semibold text-gray-700" title={entry.name}>
                              {entry.name.replace(/_/g, ' ')}
                            </p>
                            <div className="h-5 overflow-hidden rounded-md bg-gray-100 ring-1 ring-gray-100">
                              <div
                                className={classNames(
                                  "h-5 rounded-md shadow-sm",
                                  negative ? "bg-rose-500" : "bg-emerald-500"
                                )}
                                style={{ width: `${width}%` }}
                              />
                            </div>
                            <p className="text-right font-mono text-sm font-semibold text-gray-800">
                              {formatValue(entry.value)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                  <h4 className="border-b border-gray-100 pb-3 text-sm font-bold uppercase tracking-wider text-gray-900">
                    Metric Table
                  </h4>
                  <div className="mt-4 overflow-auto">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Metric</th>
                          <th className="px-3 py-2 text-right font-semibold">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {metricEntries.map(([name, value]) => (
                          <tr key={`metric-row-${name}`} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium text-gray-800">{name}</td>
                            <td className="px-3 py-2 text-right font-mono text-xs text-gray-800">{formatValue(value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                <Gauge className="mx-auto h-10 w-10 text-gray-300" />
                <h4 className="mt-3 text-base font-bold text-gray-800">No metrics captured for this version.</h4>
                <p className="mt-2 text-sm text-gray-500">
                  Training scripts can write SM_OUTPUT_DIR/metrics.json or print METRIC_JSON lines.
                </p>
              </div>
            )}

            <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h4 className="text-sm font-bold uppercase tracking-wider text-gray-900">Metric History</h4>
                <p className="mt-1 text-xs text-gray-500">Optional structured metric records across training steps.</p>
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
