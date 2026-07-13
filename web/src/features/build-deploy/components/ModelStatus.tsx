import type { ModelProject } from '@/features/catalog/types';
import { Activity, CheckCircle2, Circle, Info, Loader2, PauseCircle, XCircle } from 'lucide-react';

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

export function ModelStatus({ model }: { model: ModelProject }) {
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

      {/* ── Deprecation Notice for Realtime Pod Logs ── */}
      <div className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50/90 via-amber-50/50 to-orange-50/80 p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 shadow-inner">
            <Activity className="h-6 w-6" />
          </div>
          <div className="flex-1 space-y-2">
            <h4 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <span>Realtime Pod Log Streaming Deprecated</span>
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                Prometheus Powered
              </span>
            </h4>
            <p className="text-sm leading-relaxed text-gray-600">
              Live WebSocket container log streaming is no longer supported in our production Kubernetes environment. 
              To ensure zero network overhead and enterprise-grade multi-tenant isolation, container health checks, 
              hardware metrics (CPU/RAM/Network Bandwidth), and traffic statistics are now directly monitored via the 
              <strong className="text-gray-800 font-semibold"> Prometheus Observability Engine</strong>.
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs font-medium text-amber-700">
              <Info className="h-4 w-4" />
              <span>Navigate to the Observability or Metrics tab to inspect real-time serving performance.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
