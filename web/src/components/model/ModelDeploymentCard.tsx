import {
  Activity,
  Box,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  FileArchive,
  Globe,
  Loader2,
  PauseCircle,
  RefreshCw,
  Rocket,
  Settings,
  TerminalSquare,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { BuildLogsPanel } from './BuildLogsPanel';
import { useModelRealtime } from '../../hooks/useModelRealtime';
import type { WsStatus } from '../../hooks/useModelRealtime';
import { toast } from '../../lib/toast';
import type { ModelAPI } from '../../types/modelApi';

// ── Helpers ────────────────────────────────────────────────────────────────

function isActiveModel(model: ModelAPI) {
  return (
    model.build_status === 'building' ||
    model.endpoint_status === 'deploying' ||
    model.endpoint_status === 'unhealthy'
  );
}

function LiveBadge({ wsStatus }: { wsStatus: WsStatus }) {
  if (wsStatus === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-inset ring-emerald-500/20">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        Live
      </span>
    );
  }
  if (wsStatus === 'connecting' || wsStatus === 'disconnected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-500/20">
        <span className="h-1.5 w-1.5 animate-ping rounded-full bg-amber-400" />
        Reconnecting
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 ring-1 ring-inset ring-gray-500/20">
      <WifiOff className="h-3 w-3" />
      Polling
    </span>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export interface ModelDeploymentCardProps {
  model: ModelAPI;
  variant?: 'full' | 'compact';
  onCheckHealth?: (model: ModelAPI) => void;
  isCheckingHealth?: boolean;
  onRedeploy?: (model: ModelAPI) => void;
  isRedeploying?: boolean;
  onStop?: (model: ModelAPI) => void;
  isStopping?: boolean;
  onCleanup?: (model: ModelAPI) => void;
  isCleaningUp?: boolean;
  onOpenLogs?: (model: ModelAPI) => void;
  onTestPrediction?: (model: ModelAPI) => void;
  onOpenApiManagement?: (model: ModelAPI) => void;
  onDeploy?: (model: ModelAPI) => void;
  isDeploying?: boolean;
  onBuild?: (model: ModelAPI) => void;
  isBuilding?: boolean;
}

export function ModelDeploymentCard({
  model,
  variant = 'full',
  onCheckHealth,
  isCheckingHealth,
  onRedeploy,
  isRedeploying,
  onStop,
  isStopping,
  onCleanup,
  isCleaningUp,
  onOpenLogs,
  onTestPrediction,
  onOpenApiManagement,
  onDeploy,
  isDeploying,
  onBuild,
  isBuilding,
}: ModelDeploymentCardProps) {
  const navigate = useNavigate();
  const { wsStatus } = useModelRealtime(isActiveModel(model) ? model.id : null);
  const [copied, setCopied] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const [showCleanupModal, setShowCleanupModal] = useState(false);

  const endpointStatus = model.endpoint_status || 'not_deployed';
  const readyToDeploy = model.build_status === 'ready';
  const isHealthy = endpointStatus === 'healthy';
  const isDeployingState = endpointStatus === 'deploying';
  const isBuildingState = model.build_status === 'building';
  const isStopped = endpointStatus === 'stopped';

  // Actions
  const canRedeploy = readyToDeploy && !isDeployingState;
  const canStop = endpointStatus !== 'not_deployed' && !isStopped && !isDeployingState;

  const copyEndpoint = async () => {
    if (!model.endpoint_url) return;
    await navigator.clipboard.writeText(model.endpoint_url);
    setCopied(true);
    toast.success('Endpoint URL copied');
    setTimeout(() => setCopied(false), 2000);
  };

  // Top Accent Logic
  let accentClass = 'border-t-gray-200';
  let badgeClass = 'bg-gray-100 text-gray-700 border-gray-200';
  let statusText = 'Not Deployed';

  if (isHealthy) {
    accentClass = 'border-t-emerald-500';
    badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    statusText = 'Healthy';
  } else if (endpointStatus === 'unhealthy' || endpointStatus === 'deploy_failed' || model.build_status === 'error') {
    accentClass = 'border-t-red-500';
    badgeClass = 'bg-red-50 text-red-700 border-red-200';
    statusText = model.build_status === 'error' ? 'Build Failed' : 'Unhealthy';
  } else if (isDeployingState || isBuildingState) {
    accentClass = 'border-t-blue-500';
    badgeClass = 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse';
    statusText = isBuildingState ? 'Building...' : 'Deploying...';
  } else if (isStopped) {
    accentClass = 'border-t-gray-400';
    badgeClass = 'bg-gray-100 text-gray-600 border-gray-300';
    statusText = 'Stopped';
  } else if (readyToDeploy) {
    accentClass = 'border-t-blue-300';
    badgeClass = 'bg-blue-50 text-blue-700 border-blue-200';
    statusText = 'Build Ready';
  }

  // Lifecycle Tracker State
  const stage0 = 'completed' as const;
  let stage1: 'pending' | 'active' | 'completed' | 'failed' = 'pending';
  let stage2: 'pending' | 'active' | 'completed' | 'failed' | 'neutral' = 'pending';
  let stage3: 'pending' | 'active' | 'completed' | 'failed' = 'pending';

  if (isBuildingState) stage1 = 'active';
  else if (model.build_status === 'error') stage1 = 'failed';
  else if (model.build_status === 'ready') stage1 = 'completed';

  if (stage1 === 'completed') {
    if (isDeployingState) stage2 = 'active';
    else if (endpointStatus === 'deploy_failed') stage2 = 'failed';
    else if (isStopped) stage2 = 'neutral';
    else if (endpointStatus !== 'not_deployed') stage2 = 'completed';
  }

  if (stage2 === 'completed') {
    if (isHealthy) stage3 = 'completed';
    else if (endpointStatus === 'unhealthy') stage3 = 'failed';
    else stage3 = 'active'; // checking
  }

  return (
    <article
      className={`relative flex flex-col rounded-2xl border bg-white shadow-sm transition-all hover:shadow-md border-t-4 border-x-gray-200 border-b-gray-200 ${accentClass} ${
        variant === 'compact' ? 'p-5' : 'p-6 lg:p-8'
      }`}
    >
      {/* ── Header Area ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="hidden sm:flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-50 border border-gray-100 text-gray-500 shadow-inner">
            <Box className="h-6 w-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="text-lg font-extrabold tracking-tight text-gray-900 hover:text-blue-600 transition-colors focus:outline-none"
                onClick={() => {
                  if (onOpenApiManagement) onOpenApiManagement(model);
                  else navigate(`/dashboard/api-management/${model.id}`);
                }}
              >
                {model.name}
              </button>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600 border border-gray-200">
                {model.version || 'v1'}
              </span>
              <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
                {statusText}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500 font-medium">
              {model.source_type === 'training_job'
                ? `Registered from training job #${model.source_training_job ?? '-'}`
                : 'Manually uploaded model package'}
            </p>
          </div>
        </div>
        
        {isActiveModel(model) && (
          <div className="flex shrink-0">
            <LiveBadge wsStatus={wsStatus} />
          </div>
        )}
      </div>

      {variant === 'full' && model.description && (
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-gray-600">
          {model.description}
        </p>
      )}

      {/* ── Lifecycle Tracker ── */}
      <div className="mt-8 flex items-center w-full max-w-2xl overflow-x-auto pb-2 scrollbar-none">
        <TrackerStep label="Registered" state={stage0} />
        <TrackerLine state={stage1 === 'completed' || stage1 === 'active' ? 'completed' : 'pending'} />
        <TrackerStep label="Build Ready" state={stage1} />
        <TrackerLine state={stage2 === 'completed' || stage2 === 'active' || stage2 === 'neutral' ? 'completed' : 'pending'} />
        <TrackerStep label="Deployed" state={stage2} />
        <TrackerLine state={stage3 === 'completed' || stage3 === 'active' || stage3 === 'failed' ? 'completed' : 'pending'} />
        <TrackerStep label="Healthy" state={stage3} />
      </div>

      {/* ── Metadata & Endpoint ── */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Endpoint URL Block */}
        <div className="lg:col-span-7 flex flex-col justify-end">
          <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Endpoint URL
          </label>
          {model.endpoint_url ? (
            <div className="group flex items-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 shadow-sm transition-colors hover:border-gray-300">
              <div className="flex items-center justify-center bg-gray-100 px-3 py-2 border-r border-gray-200 text-gray-400">
                <Globe className="h-4 w-4" />
              </div>
              <code className="flex-1 truncate px-3 py-2 text-xs font-mono text-gray-700 bg-transparent selection:bg-blue-100" title={model.endpoint_url}>
                {model.endpoint_url}
              </code>
              <button
                onClick={copyEndpoint}
                className="flex items-center justify-center px-3 py-2 text-gray-400 hover:bg-white hover:text-gray-900 border-l border-transparent hover:border-gray-200 transition-all focus:outline-none"
                title="Copy URL"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          ) : (
            <div className="flex h-9 items-center rounded-lg border border-gray-200 border-dashed bg-gray-50/50 px-3 py-2">
              <p className="text-xs font-mono text-gray-400">Endpoint not yet deployed</p>
            </div>
          )}
        </div>

        {/* Diagnostics Grid */}
        <div className="lg:col-span-5 grid grid-cols-2 gap-4">
          <div className="flex flex-col justify-end">
            <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">Container</span>
            <span className="truncate text-xs font-mono text-gray-800 bg-gray-50 rounded px-2 py-1 border border-gray-100 w-fit max-w-full" title={model.endpoint_container_name || ''}>
              {model.endpoint_container_name || 'N/A'}
            </span>
          </div>
          <div className="flex flex-col justify-end">
            <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">Last Checked</span>
            <span className="truncate text-xs text-gray-800 bg-gray-50 rounded px-2 py-1 border border-gray-100 w-fit max-w-full">
              {model.endpoint_last_checked_at ? new Date(model.endpoint_last_checked_at).toLocaleString() : 'N/A'}
            </span>
          </div>
        </div>
      </div>

      {/* Errors / Logs */}
      {(model.build_error || model.endpoint_error) && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <p className="text-sm font-bold text-red-800 flex items-center gap-2">
            <XCircle className="h-4 w-4" />
            Deployment Error
          </p>
          <p className="mt-1 text-sm text-red-600 font-medium">
            {model.build_error || model.endpoint_error}
          </p>
        </div>
      )}

      {isBuildingState && (
        <div className="mt-6">
          <BuildLogsPanel modelId={model.id} />
        </div>
      )}

      {/* ── Action Toolbar ── */}
      <div className="mt-8 flex flex-col sm:flex-row flex-wrap items-center justify-between gap-4 border-t border-gray-100 pt-5">
        
        {/* Primary / Operational Group */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto flex-1">
          {/* Primary Action */}
          {(!readyToDeploy && onBuild) ? (
            <Button
              size="md"
              variant="primary"
              icon={<FileArchive className="h-4 w-4" />}
              loading={isBuilding}
              disabled={isBuildingState}
              onClick={() => onBuild(model)}
            >
              Build Package
            </Button>
          ) : (endpointStatus === 'not_deployed' && onDeploy) ? (
            <Button
              size="md"
              variant="primary"
              icon={<Rocket className="h-4 w-4" />}
              loading={isDeploying}
              disabled={isDeployingState}
              onClick={() => onDeploy(model)}
            >
              Deploy Endpoint
            </Button>
          ) : (onRedeploy && readyToDeploy) ? (
            <Button
              size="md"
              variant={isHealthy ? 'secondary' : 'primary'}
              icon={<RefreshCw className="h-4 w-4" />}
              loading={isRedeploying}
              disabled={!canRedeploy}
              onClick={() => onRedeploy(model)}
            >
              Redeploy
            </Button>
          ) : null}

          {/* Operational Actions */}
          {model.endpoint_url && onCheckHealth && (
            <Button size="md" variant="secondary" icon={<Activity className="h-4 w-4" />} loading={isCheckingHealth} onClick={() => onCheckHealth(model)}>
              Check Health
            </Button>
          )}

          {onOpenLogs && model.endpoint_container_name && (
            <Button size="md" variant="secondary" icon={<TerminalSquare className="h-4 w-4" />} onClick={() => onOpenLogs(model)}>
              Logs
            </Button>
          )}

          {onTestPrediction && (
            <Button size="md" variant="secondary" icon={<ExternalLink className="h-4 w-4" />} onClick={() => onTestPrediction(model)} disabled={!isHealthy}>
              Test Prediction
            </Button>
          )}

          {onOpenApiManagement && variant === 'compact' && (
            <Button size="md" variant="secondary" icon={<Settings className="h-4 w-4" />} onClick={() => onOpenApiManagement(model)}>
              Manage
            </Button>
          )}
        </div>

        {/* Danger / Maintenance Group */}
        {(onStop || onCleanup) && (
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:border-l sm:border-gray-200 sm:pl-4">
            {onStop && endpointStatus !== 'not_deployed' && (
              <Button
                size="md"
                variant="danger-outline"
                icon={<PauseCircle className="h-4 w-4" />}
                loading={isStopping}
                disabled={!canStop}
                onClick={() => setShowStopModal(true)}
              >
                Stop Endpoint
              </Button>
            )}

            {onCleanup && (
              <Button
                size="md"
                variant="ghost"
                icon={<FileArchive className="h-4 w-4" />}
                loading={isCleaningUp}
                onClick={() => setShowCleanupModal(true)}
                className="border border-gray-200 text-gray-600 hover:text-amber-700 hover:border-amber-200 hover:bg-amber-50"
              >
                Cleanup
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Confirmation Modals ── */}
      {onStop && (
        <ConfirmModal
          open={showStopModal}
          title="Stop endpoint?"
          description="This will stop the running endpoint container. The model package and registry record will remain available, and you can deploy it again later."
          confirmText="Stop endpoint"
          cancelText="Cancel"
          tone="danger"
          loading={isStopping}
          onConfirm={() => {
            onStop(model);
            setShowStopModal(false);
          }}
          onCancel={() => setShowStopModal(false)}
        />
      )}

      {onCleanup && (
        <ConfirmModal
          open={showCleanupModal}
          title="Cleanup resources?"
          description="This will remove local Docker containers and images associated with this endpoint. Your S3 model artifacts and registry records will be preserved."
          confirmText="Cleanup resources"
          cancelText="Cancel"
          tone="default"
          loading={isCleaningUp}
          onConfirm={() => {
            onCleanup(model);
            setShowCleanupModal(false);
          }}
          onCancel={() => setShowCleanupModal(false)}
        />
      )}
    </article>
  );
}

// ── Lifecycle Tracker Components ──────────────────────────────────────────

function TrackerStep({ label, state }: { label: string; state: string }) {
  const isCompleted = state === 'completed';
  const isActive = state === 'active';
  const isFailed = state === 'failed';
  const isNeutral = state === 'neutral';

  let icon = <Circle className="h-2.5 w-2.5 fill-current" />;
  if (isCompleted) icon = <CheckCircle2 className="h-4 w-4" />;
  else if (isFailed) icon = <XCircle className="h-4 w-4" />;
  else if (isActive) icon = <Loader2 className="h-4 w-4 animate-spin" />;
  else if (isNeutral) icon = <PauseCircle className="h-4 w-4" />;

  let colorClass = 'text-gray-300';
  if (isCompleted) colorClass = 'text-emerald-500';
  else if (isActive) colorClass = 'text-blue-500';
  else if (isFailed) colorClass = 'text-red-500';
  else if (isNeutral) colorClass = 'text-gray-400';

  let textClass = 'text-gray-400 font-medium';
  if (isCompleted) textClass = 'text-gray-900 font-bold';
  else if (isActive) textClass = 'text-blue-700 font-bold';
  else if (isFailed) textClass = 'text-red-700 font-bold';
  else if (isNeutral) textClass = 'text-gray-600 font-bold';

  return (
    <div className="flex flex-col items-center gap-2 w-20 shrink-0">
      <div className={`flex h-6 w-6 items-center justify-center rounded-full bg-white ring-4 ring-white ${colorClass}`}>
        {icon}
      </div>
      <span className={`text-[10px] uppercase tracking-wider text-center ${textClass}`}>
        {label}
      </span>
    </div>
  );
}

function TrackerLine({ state }: { state: 'completed' | 'pending' }) {
  return (
    <div className="flex-1 shrink-0 px-2 -mt-6">
      <div className={`h-[2px] w-full rounded-full ${state === 'completed' ? 'bg-emerald-400' : 'bg-gray-100'}`} />
    </div>
  );
}
