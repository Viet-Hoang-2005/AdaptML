import { Activity, Bot, Box, CheckCircle, XCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import Placeholder from '../../components/layout/Placeholder';
import { useModelAPIs } from '../../hooks/useModelAPIs';
import { useModelRealtime } from '../../hooks/useModelRealtime';
import {
  checkModelEndpointHealth,
  cleanupModelResources,
  redeployModelAPI,
  stopModelEndpoint,
} from '../../lib/api';
import { getApiErrorMessage } from '../../lib/apiError';
import { queryKeys } from '../../lib/queryKeys';
import { toast } from '../../lib/toast';
import type { ModelAPI } from '../../types/modelApi';
import { ModelDeploymentCard } from '../../components/model/ModelDeploymentCard';
import { EndpointLogsModal } from '../../components/model/EndpointLogsModal';

// ── Helpers ────────────────────────────────────────────────────────────────

function isActiveModel(model: ModelAPI) {
  return model.build_status === 'building' || model.endpoint_status === 'deploying' || model.endpoint_status === 'unhealthy';
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function APIManagementPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading } = useModelAPIs();
  const models = data?.models ?? [];
  const [logsModel, setLogsModel] = useState<ModelAPI | null>(null);

  // Loading states scoped by model ID
  const [checkingHealthId, setCheckingHealthId] = useState<string | null>(null);
  const [redeployingId, setRedeployingId] = useState<string | null>(null);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [cleaningUpId, setCleaningUpId] = useState<string | null>(null);

  // Aggregate wsStatus for page-level badge (only for active models)
  const activeModels = models.filter(isActiveModel);
  // Connect page-level WS for first active model to show global badge; individual cards handle their own
  const { wsStatus: pageWsStatus } = useModelRealtime(activeModels[0]?.id ?? null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.modelApis });

  const checkHealthMutation = useMutation({
    mutationFn: checkModelEndpointHealth,
    onMutate: (id) => setCheckingHealthId(id),
    onSettled: () => setCheckingHealthId(null),
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
    onMutate: (id) => setRedeployingId(id),
    onSettled: () => setRedeployingId(null),
    onSuccess: async () => {
      await invalidate();
      toast.success('Deploy started.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to deploy endpoint.')),
  });

  const stopMutation = useMutation({
    mutationFn: stopModelEndpoint,
    onMutate: (id) => setStoppingId(id),
    onSettled: () => setStoppingId(null),
    onSuccess: async () => {
      await invalidate();
      toast.warning('Endpoint stopped.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to stop endpoint.')),
  });

  const cleanupMutation = useMutation({
    mutationFn: (modelId: string) => cleanupModelResources(modelId, false),
    onMutate: (id) => setCleaningUpId(id),
    onSettled: () => setCleaningUpId(null),
    onSuccess: async () => {
      await invalidate();
      toast.success('Local endpoint resources cleaned up.');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Unable to cleanup local resources.')),
  });

  // Summary counts
  const healthyCount = models.filter((m) => m.endpoint_status === 'healthy').length;
  const unhealthyCount = models.filter((m) => m.endpoint_status === 'unhealthy' || m.endpoint_status === 'deploy_failed').length;
  const buildReadyCount = models.filter((m) => m.build_status === 'ready' && !['healthy', 'unhealthy', 'deploy_failed'].includes(m.endpoint_status || 'not_deployed')).length;

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-gray-200 pb-6 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">API Management</h1>
            {activeModels.length > 0 && (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                pageWsStatus === 'connected' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-500/20' :
                pageWsStatus === 'fallback' ? 'bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-500/20' :
                'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-500/20'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${pageWsStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : pageWsStatus === 'fallback' ? 'bg-gray-400' : 'bg-amber-400 animate-ping'}`} />
                {pageWsStatus === 'connected' ? 'Live Sync Active' : pageWsStatus === 'fallback' ? 'Polling' : 'Reconnecting'}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-gray-500 max-w-2xl">
            Build model packages, manage endpoint deployments, and monitor API health across all registered models.
          </p>
        </div>
        <Button size="md" onClick={() => navigate('/dashboard/api-management/upload')} className="px-5 shadow-sm">
          <Plus className="h-4 w-4" /> Upload Model
        </Button>
      </div>

      {/* Summary Cards */}
      {!isLoading && models.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-gray-500">
              <Box className="h-4 w-4" /> Total Models
            </div>
            <p className="mt-2 text-2xl font-extrabold text-gray-900">{models.length}</p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-700">
              <CheckCircle className="h-4 w-4" /> Healthy
            </div>
            <p className="mt-2 text-2xl font-extrabold text-emerald-900">{healthyCount}</p>
          </div>
          <div className="rounded-2xl border border-red-100 bg-red-50/50 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-red-700">
              <XCircle className="h-4 w-4" /> Unhealthy/Failed
            </div>
            <p className="mt-2 text-2xl font-extrabold text-red-900">{unhealthyCount}</p>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-blue-700">
              <Activity className="h-4 w-4" /> Build Ready
            </div>
            <p className="mt-2 text-2xl font-extrabold text-blue-900">{buildReadyCount}</p>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex-1 rounded-xl border border-gray-200 bg-gray-50/50 min-h-100 flex items-center justify-center animate-pulse">
          <Activity className="h-8 w-8 text-gray-300 animate-spin" />
        </div>
      ) : models.length === 0 ? (
        <Placeholder
          title="No model APIs"
          description="Upload your first MLflow model package or register one from a completed training job to create a prediction endpoint."
          icon={<Bot className="h-8 w-8" />}
          showModelName={false}
          action={<Button size="md" onClick={() => navigate('/dashboard/api-management/upload')}>Upload Model</Button>}
        />
      ) : (
        <div className="space-y-6">
          {models.map((model) => (
            <ModelDeploymentCard
              key={model.id}
              model={model}
              variant="full"
              onCheckHealth={(m) => checkHealthMutation.mutate(m.id)}
              isCheckingHealth={checkingHealthId === model.id}
              onRedeploy={(m) => redeployMutation.mutate(m.id)}
              isRedeploying={redeployingId === model.id}
              onStop={(m) => stopMutation.mutate(m.id)}
              isStopping={stoppingId === model.id}
              onCleanup={(m) => cleanupMutation.mutate(m.id)}
              isCleaningUp={cleaningUpId === model.id}
              onOpenLogs={setLogsModel}
              onTestPrediction={() => navigate('/dashboard/home/model-testing')}
            />
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
