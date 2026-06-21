import {
  Activity,
  Bot,
  ChevronDown,
  ChevronUp,
  Clipboard,
  FileText,
  PauseCircle,
  Radio,
  RefreshCw,
  Rocket,
  TerminalSquare,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import Placeholder from '../../components/layout/Placeholder';
import { useModelAPIs } from '../../hooks/useModelAPIs';
import { useModelRealtime } from '../../hooks/useModelRealtime';
import type { WsStatus } from '../../hooks/useModelRealtime';
import {
  checkModelEndpointHealth,
  cleanupModelResources,
  getModelEndpointLogs,
  redeployModelAPI,
  stopModelEndpoint,
} from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { queryKeys } from '../../lib/queryKeys';
import { toast } from '../../lib/toast';
import type { ModelAPI, ModelEndpointStatus } from '../../types/modelApi';

// ── Helpers ────────────────────────────────────────────────────────────────

const endpointBadgeClass: Record<ModelEndpointStatus, string> = {
  healthy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  deploying: 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse',
  unhealthy: 'bg-red-50 text-red-700 border-red-200',
  deploy_failed: 'bg-red-50 text-red-700 border-red-200',
  stopped: 'bg-gray-50 text-gray-700 border-gray-200',
  not_deployed: 'bg-gray-50 text-gray-600 border-gray-200',
};

const buildBadgeClass: Record<string, string> = {
  building: 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse',
  ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  not_started: 'bg-gray-50 text-gray-600 border-gray-200',
};

function statusLabel(s?: string) {
  return (s || 'not_deployed').replace(/_/g, ' ');
}

function isActiveModel(model: ModelAPI) {
  return model.build_status === 'building' || model.endpoint_status === 'deploying' || model.endpoint_status === 'unhealthy';
}

// ── Live Status Badge ──────────────────────────────────────────────────────

function LiveBadge({ wsStatus }: { wsStatus: WsStatus }) {
  if (wsStatus === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
        <Radio className="h-3 w-3" />
        Live
      </span>
    );
  }
  if (wsStatus === 'connecting' || wsStatus === 'disconnected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
        <Wifi className="h-3 w-3 animate-pulse" />
        Reconnecting
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
      <WifiOff className="h-3 w-3" />
      Polling
    </span>
  );
}

// ── Build Logs Panel ───────────────────────────────────────────────────────

function BuildLogsPanel({ modelId }: { modelId: number }) {
  const logsRef = useRef<HTMLPreElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const { data } = useQuery<{ logs: string[]; updated_at: string }>({
    queryKey: queryKeys.modelBuildLogs(modelId),
    enabled: false, // populated via WS
  });

  const logs = data?.logs ?? [];
  const text = logs.join('\n');

  useEffect(() => {
    const el = logsRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
      setShowScrollBtn(false);
    } else {
      setShowScrollBtn(true);
    }
  }, [text]);

  if (!logs.length) return null;

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-black">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-green-400">
          <TerminalSquare className="h-3.5 w-3.5" />
          Build logs
        </span>
        <button onClick={() => setExpanded((v) => !v)} className="text-gray-500 hover:text-gray-300">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {expanded && (
        <div className="relative">
          <pre
            ref={logsRef}
            className="max-h-60 overflow-auto px-3 pb-3 text-xs text-green-200 whitespace-pre-wrap"
          >
            {text || 'Waiting for build logs...'}
          </pre>
          {showScrollBtn && (
            <button
              onClick={() => {
                if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
                setShowScrollBtn(false);
              }}
              className="absolute bottom-2 right-3 rounded-full bg-gray-700 px-2 py-0.5 text-xs text-white hover:bg-gray-600"
            >
              New logs ↓
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Endpoint Logs Modal ────────────────────────────────────────────────────

function EndpointLogsModal({
  model,
  onClose,
}: {
  model: ModelAPI;
  onClose: () => void;
}) {
  const logsRef = useRef<HTMLPreElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Live endpoint logs from WS cache
  const { data: wsLogs } = useQuery<{ logs: string; updated_at: string }>({
    queryKey: queryKeys.modelEndpointLogs(model.id),
    enabled: false,
  });
  // REST fallback
  const { data: restLogs, isLoading } = useQuery({
    queryKey: ['endpoint-logs-modal', model.id],
    queryFn: () => getModelEndpointLogs(model.id),
    refetchInterval: 5000,
  });

  const text = wsLogs?.logs || restLogs?.logs || (isLoading ? 'Loading endpoint logs...' : 'No endpoint logs available.');

  useEffect(() => {
    const el = logsRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
      setShowScrollBtn(false);
    } else {
      setShowScrollBtn(true);
    }
  }, [text]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-4xl rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
              <TerminalSquare className="h-4 w-4 text-gray-500" />
              Endpoint logs
            </p>
            <p className="text-xs text-gray-500">
              {model.endpoint_container_name || `mlops_paas_model_endpoint_${model.id}`}
            </p>
          </div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="relative">
          <pre
            ref={logsRef}
            className="max-h-[480px] overflow-auto rounded-lg bg-black p-4 text-xs text-green-100"
          >
            {text}
          </pre>
          {showScrollBtn && (
            <button
              onClick={() => {
                if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
                setShowScrollBtn(false);
              }}
              className="absolute bottom-4 right-4 rounded-full bg-gray-700 px-2 py-0.5 text-xs text-white hover:bg-gray-600"
            >
              New logs ↓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Model Card ─────────────────────────────────────────────────────────────

function ModelCard({
  model,
  onOpenLogs,
}: {
  model: ModelAPI;
  onOpenLogs: (m: ModelAPI) => void;
}) {
  const queryClient = useQueryClient();
  const { wsStatus } = useModelRealtime(isActiveModel(model) ? model.id : null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.modelApis });

  const checkHealthMutation = useMutation({
    mutationFn: checkModelEndpointHealth,
    onSuccess: async (updated) => {
      await invalidate();
      toast[updated.endpoint_status === 'healthy' ? 'success' : 'warning'](
        updated.endpoint_status === 'healthy' ? 'Endpoint is healthy.' : 'Endpoint is unhealthy.',
      );
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to check endpoint health.')),
  });

  const redeployMutation = useMutation({
    mutationFn: redeployModelAPI,
    onSuccess: async () => {
      await invalidate();
      toast.success('Redeploy started.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to redeploy endpoint.')),
  });

  const stopMutation = useMutation({
    mutationFn: stopModelEndpoint,
    onSuccess: async () => {
      await invalidate();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to stop endpoint.')),
  });

  const cleanupMutation = useMutation({
    mutationFn: (modelId: number) => cleanupModelResources(modelId, false),
    onSuccess: async () => {
      await invalidate();
      toast.success('Local endpoint resources cleaned up.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to cleanup local resources.')),
  });

  const copyEndpoint = async () => {
    if (!model.endpoint_url) return;
    await navigator.clipboard.writeText(model.endpoint_url);
    toast.success('Copied endpoint URL.');
  };

  const navigate = useNavigate();
  const endpointStatus = model.endpoint_status || 'not_deployed';
  const canRedeploy = model.build_status === 'ready' && endpointStatus !== 'deploying';
  const canStop = endpointStatus !== 'not_deployed' && endpointStatus !== 'stopped' && endpointStatus !== 'deploying';

  return (
    <article className="rounded-lg border border-gray-300 bg-white p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        {/* ── Left info ── */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase text-gray-400">Model API</p>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-600">
              {model.version || 'v1'}
            </span>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-600">
              {model.source_type === 'training_job'
                ? `Training job #${model.source_training_job ?? '-'}`
                : 'Manual upload'}
            </span>
            {/* Build badge */}
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${buildBadgeClass[model.build_status] ?? buildBadgeClass.not_started}`}>
              Build: {statusLabel(model.build_status)}
            </span>
            {/* Endpoint badge */}
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${endpointBadgeClass[endpointStatus]}`}>
              {statusLabel(endpointStatus)}
            </span>
            {/* Live indicator — only when active */}
            {isActiveModel(model) && <LiveBadge wsStatus={wsStatus} />}
          </div>

          <button
            className="mt-2 text-left text-lg font-bold text-gray-900 hover:underline"
            onClick={() => navigate(`/dashboard/api-management/${model.id}`)}
          >
            {model.name}
          </button>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-gray-500">
            {model.description || 'No description provided.'}
          </p>

          <div className="mt-3 grid gap-2 text-xs text-gray-500 md:grid-cols-2">
            <p>Container: <span className="font-mono">{model.endpoint_container_name || '-'}</span></p>
            <p>Image: <span className="font-mono">{model.endpoint_image_name || '-'}</span></p>
            {model.endpoint_last_checked_at && (
              <p className="col-span-2 text-gray-400">
                Last checked: {new Date(model.endpoint_last_checked_at).toLocaleString()}
              </p>
            )}
          </div>

          {model.endpoint_url && (
            <code className="mt-4 block truncate rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500" title={model.endpoint_url}>
              {model.endpoint_url}
            </code>
          )}
          {(model.endpoint_error || model.build_error) && (
            <p className="mt-2 text-sm font-medium text-red-600">
              {model.endpoint_error || model.build_error}
            </p>
          )}

          {/* Build logs panel — visible while building or after build completes */}
          {model.build_status === 'building' && <BuildLogsPanel modelId={model.id} />}
        </div>

        {/* ── Action buttons ── */}
        <div className="flex flex-wrap gap-2 lg:max-w-xs lg:justify-end">
          <Button
            variant="secondary"
            icon={<Activity className="h-4 w-4" />}
            loading={checkHealthMutation.isPending}
            onClick={() => checkHealthMutation.mutate(model.id)}
          >
            Check health
          </Button>
          <Button
            icon={<Rocket className="h-4 w-4" />}
            loading={redeployMutation.isPending}
            disabled={!canRedeploy}
            onClick={() => redeployMutation.mutate(model.id)}
          >
            Redeploy
          </Button>
          <Button
            variant="secondary"
            icon={<PauseCircle className="h-4 w-4" />}
            loading={stopMutation.isPending}
            disabled={!canStop}
            onClick={() => {
              if (window.confirm('Stop this endpoint container?')) stopMutation.mutate(model.id);
            }}
          >
            Stop
          </Button>
          <Button
            variant="secondary"
            icon={<FileText className="h-4 w-4" />}
            onClick={() => onOpenLogs(model)}
          >
            Logs
          </Button>
          <Button
            variant="secondary"
            icon={<Clipboard className="h-4 w-4" />}
            onClick={() => void copyEndpoint()}
          >
            Copy URL
          </Button>
          <Button
            variant="secondary"
            icon={<RefreshCw className="h-4 w-4" />}
            loading={cleanupMutation.isPending}
            onClick={() => {
              if (window.confirm('Cleanup local Docker resources for this model? S3 artifacts and registry data are kept.')) {
                cleanupMutation.mutate(model.id);
              }
            }}
          >
            Cleanup
          </Button>
        </div>
      </div>
    </article>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function APIManagementPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useModelAPIs();
  const models = data?.models ?? [];
  const [logsModel, setLogsModel] = useState<ModelAPI | null>(null);

  // Aggregate wsStatus for page-level badge (only for active models)
  const activeModels = models.filter(isActiveModel);
  // Connect page-level WS for first active model to show global badge; individual cards handle their own
  const { wsStatus: pageWsStatus } = useModelRealtime(activeModels[0]?.id ?? null);

  return (
    <section className="flex w-full flex-1 flex-col space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-gray-300 pb-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-gray-900">API Management</h1>
            {activeModels.length > 0 && <LiveBadge wsStatus={pageWsStatus} />}
          </div>
          <p className="mt-1 text-sm text-gray-500">Manage builds, endpoint health, and local deployment lifecycle.</p>
        </div>
        <Button size="md" onClick={() => navigate('/dashboard/api-management/upload')} className="px-4">
          Upload model
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex-1 rounded-lg border border-gray-300 bg-white" />
      ) : models.length === 0 ? (
        <Placeholder
          title="No model APIs"
          description="Upload your first MLflow model package to create a prediction endpoint."
          icon={<Bot className="h-6 w-6" />}
          showModelName={false}
          action={<Button size="md" onClick={() => navigate('/dashboard/api-management/upload')}>Upload model</Button>}
        />
      ) : (
        <div className="space-y-4">
          {models.map((model) => (
            <ModelCard key={model.id} model={model} onOpenLogs={setLogsModel} />
          ))}
        </div>
      )}

      {/* Endpoint Logs Modal */}
      {logsModel && (
        <EndpointLogsModal model={logsModel} onClose={() => setLogsModel(null)} />
      )}
    </section>
  );
}
