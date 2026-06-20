import { Activity, Bot, Clipboard, FileText, PauseCircle, RefreshCw, Rocket } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import Placeholder from '../../components/layout/Placeholder';
import { useModelAPIs } from '../../hooks/useModelAPIs';
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

const endpointBadgeClass: Record<ModelEndpointStatus, string> = {
  healthy: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  deploying: 'bg-blue-50 text-blue-700 border-blue-200',
  unhealthy: 'bg-red-50 text-red-700 border-red-200',
  deploy_failed: 'bg-red-50 text-red-700 border-red-200',
  stopped: 'bg-gray-50 text-gray-700 border-gray-200',
  not_deployed: 'bg-gray-50 text-gray-600 border-gray-200',
};

function statusLabel(status?: string) {
  return (status || 'not_deployed').replace(/_/g, ' ');
}

export default function APIManagementPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading } = useModelAPIs();
  const models = data?.models ?? [];
  const [logsModel, setLogsModel] = useState<ModelAPI | null>(null);
  const [endpointLogs, setEndpointLogs] = useState('');

  const invalidateModels = () => queryClient.invalidateQueries({ queryKey: queryKeys.modelApis });

  const checkHealthMutation = useMutation({
    mutationFn: checkModelEndpointHealth,
    onSuccess: async (model) => {
      await invalidateModels();
      toast[model.endpoint_status === 'healthy' ? 'success' : 'warning'](
        model.endpoint_status === 'healthy' ? 'Endpoint is healthy.' : 'Endpoint is unhealthy.',
      );
    },
    onError: (error) => toast.error(getApiErrorMessage(error, 'Unable to check endpoint health.')),
  });

  const redeployMutation = useMutation({
    mutationFn: redeployModelAPI,
    onSuccess: async () => {
      await invalidateModels();
      toast.success('Redeploy started.');
    },
    onError: (error) => toast.error(getApiErrorMessage(error, 'Unable to redeploy endpoint.')),
  });

  const stopMutation = useMutation({
    mutationFn: stopModelEndpoint,
    onSuccess: async () => {
      await invalidateModels();
      toast.success('Endpoint stopped.');
    },
    onError: (error) => toast.error(getApiErrorMessage(error, 'Unable to stop endpoint.')),
  });

  const logsMutation = useMutation({
    mutationFn: getModelEndpointLogs,
    onSuccess: (payload) => setEndpointLogs(payload.logs || 'No endpoint logs available.'),
    onError: (error) => toast.error(getApiErrorMessage(error, 'Unable to read endpoint logs.')),
  });

  const cleanupMutation = useMutation({
    mutationFn: (modelId: number) => cleanupModelResources(modelId, false),
    onSuccess: async () => {
      await invalidateModels();
      toast.success('Local endpoint resources cleaned up.');
    },
    onError: (error) => toast.error(getApiErrorMessage(error, 'Unable to cleanup local resources.')),
  });

  const copyEndpoint = async (model: ModelAPI) => {
    if (!model.endpoint_url) return;
    await navigator.clipboard.writeText(model.endpoint_url);
    toast.success('Copied endpoint URL.');
  };

  const openLogs = (model: ModelAPI) => {
    setLogsModel(model);
    setEndpointLogs('Loading endpoint logs...');
    logsMutation.mutate(model.id);
  };

  return (
    <section className="flex w-full flex-1 flex-col space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-300 pb-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">API Management</h1>
          <p className="mt-1 text-sm text-gray-500">Manage builds, endpoint health, and local deployment lifecycle.</p>
        </div>
        <Button size="md" onClick={() => navigate('/dashboard/api-management/upload')} className="px-4">
          Upload model
        </Button>
      </div>

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
          {models.map((model) => {
            const endpointStatus = model.endpoint_status || 'not_deployed';
            return (
              <article key={model.id} className="rounded-lg border border-gray-300 bg-white p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${endpointBadgeClass[endpointStatus]}`}>
                        {statusLabel(endpointStatus)}
                      </span>
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
                      <p>Build: <span className="font-semibold text-gray-800">{model.build_status}</span></p>
                      <p>Status: <span className="font-semibold text-gray-800">{model.status}</span></p>
                      <p>Container: <span className="font-mono">{model.endpoint_container_name || '-'}</span></p>
                      <p>Image: <span className="font-mono">{model.endpoint_image_name || '-'}</span></p>
                    </div>
                    {model.endpoint_url && (
                      <code className="mt-4 block truncate rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500" title={model.endpoint_url}>
                        {model.endpoint_url}
                      </code>
                    )}
                    {(model.endpoint_error || model.build_error) && (
                      <p className="mt-2 text-sm font-medium text-red-600">{model.endpoint_error || model.build_error}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 lg:max-w-xs lg:justify-end">
                    <Button variant="secondary" icon={<Activity className="h-4 w-4" />} loading={checkHealthMutation.isPending} onClick={() => checkHealthMutation.mutate(model.id)}>
                      Check health
                    </Button>
                    <Button icon={<Rocket className="h-4 w-4" />} loading={redeployMutation.isPending} disabled={model.build_status !== 'ready'} onClick={() => redeployMutation.mutate(model.id)}>
                      Redeploy
                    </Button>
                    <Button variant="secondary" icon={<PauseCircle className="h-4 w-4" />} loading={stopMutation.isPending} onClick={() => {
                      if (window.confirm('Stop this endpoint container?')) stopMutation.mutate(model.id);
                    }}>
                      Stop
                    </Button>
                    <Button variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => openLogs(model)}>
                      Logs
                    </Button>
                    <Button variant="secondary" icon={<Clipboard className="h-4 w-4" />} onClick={() => void copyEndpoint(model)}>
                      Copy URL
                    </Button>
                    <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={cleanupMutation.isPending} onClick={() => {
                      if (window.confirm('Cleanup local Docker resources for this model? S3 artifacts and registry data are kept.')) cleanupMutation.mutate(model.id);
                    }}>
                      Cleanup
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {logsModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">Endpoint logs</p>
                <p className="text-xs text-gray-500">{logsModel.endpoint_container_name || `mlops_paas_model_endpoint_${logsModel.id}`}</p>
              </div>
              <Button variant="secondary" onClick={() => setLogsModel(null)}>Close</Button>
            </div>
            <pre className="max-h-[480px] overflow-auto rounded-lg bg-black p-4 text-xs text-green-100">
              {endpointLogs}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
