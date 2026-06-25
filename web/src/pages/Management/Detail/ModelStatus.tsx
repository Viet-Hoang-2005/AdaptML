import { useQuery } from '@tanstack/react-query';
import { getModelEndpointLogs } from '../../../lib/api';
import { queryKeys } from '../../../lib/queryKeys';
import type { ModelAPI } from '../../../types/modelApi';
import { TerminalLogViewer } from '../../../components/ui/TerminalLogViewer';
import { CheckCircle2, Circle, Loader2, PauseCircle, XCircle } from 'lucide-react';

function isActiveModel(model: ModelAPI) {
  return (
    model.build_status === 'building' ||
    model.endpoint_status === 'deploying' ||
    model.endpoint_status === 'unhealthy'
  );
}

function TrackerStep({ label, state }: { label: string; state: string }) {
  const isCompleted = state === 'completed';
  const isActive = state === 'active';
  const isFailed = state === 'failed';
  const isNeutral = state === 'neutral';

  let icon = <Circle className="h-2.5 w-2.5 fill-current" />;
  if (isCompleted) icon = <CheckCircle2 className="h-6 w-6" />;
  else if (isFailed) icon = <XCircle className="h-6 w-6" />;
  else if (isActive) icon = <Loader2 className="h-6 w-6 animate-spin" />;
  else if (isNeutral) icon = <PauseCircle className="h-6 w-6" />;

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
    <div className="flex w-24 shrink-0 flex-col items-center gap-2">
      <div className={`flex h-6 w-6 items-center justify-center rounded-full bg-white ring-4 ring-white ${colorClass}`}>
        {icon}
      </div>
      <span className={`text-center text-[10px] uppercase tracking-wider ${textClass}`}>
        {label}
      </span>
    </div>
  );
}

function TrackerLine({ state }: { state: 'completed' | 'pending' }) {
  return (
    <div className="-mt-6 flex-1 shrink-0 px-2">
      <div className={`h-0.5 w-full rounded-full ${state === 'completed' ? 'bg-emerald-400' : 'bg-gray-100'}`} />
    </div>
  );
}

export function ModelStatus({ model }: { model: ModelAPI }) {
  const endpointStatus = model.endpoint_status || 'not_deployed';
  const isBuildingState = model.build_status === 'building';
  const isDeployingState = endpointStatus === 'deploying';
  const isHealthy = endpointStatus === 'healthy';
  const isStopped = endpointStatus === 'stopped';

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

  // Live endpoint logs from WS cache
  const { data: wsLogs } = useQuery<{ logs: string; updated_at: string }>({
    queryKey: queryKeys.modelEndpointLogs(model.id),
    enabled: false,
  });

  // REST fallback
  const { data: restLogs } = useQuery({
    queryKey: ['endpoint-logs-modal', model.id],
    queryFn: () => getModelEndpointLogs(model.id),
    refetchInterval: 5000,
  });

  const text = wsLogs?.logs || restLogs?.logs || '';
  const logLines = text.split('\n').filter(Boolean);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Lifecycle Tracker ── */}
      <div className="flex w-full items-center overflow-x-auto pb-2 scrollbar-none max-w-2xl mx-auto mt-4 mb-4">
        <TrackerStep label="Registered" state={stage0} />
        <TrackerLine state={stage1 === 'completed' || stage1 === 'active' ? 'completed' : 'pending'} />
        <TrackerStep label="Build Ready" state={stage1} />
        <TrackerLine state={stage2 === 'completed' || stage2 === 'active' || stage2 === 'neutral' ? 'completed' : 'pending'} />
        <TrackerStep label="Deployed" state={stage2} />
        <TrackerLine state={stage3 === 'completed' || stage3 === 'active' || stage3 === 'failed' ? 'completed' : 'pending'} />
        <TrackerStep label="Healthy" state={stage3} />
      </div>

      <div className="flex flex-col">
        <TerminalLogViewer
          title={`Logs for ${model.endpoint_container_name || 'container'}`}
          logsOverride={logLines}
          isRunningOverride={isActiveModel(model) || isHealthy}
          placeholder="Waiting for container logs..."
        />
      </div>
    </div>
  );
}
