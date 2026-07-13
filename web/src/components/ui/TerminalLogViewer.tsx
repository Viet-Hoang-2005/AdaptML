import { useEffect, useRef, useState } from 'react';
import { Clipboard, Loader2, Play, Square, Terminal } from 'lucide-react';

import { getBuildLogs, getDeploymentLogs, getDriftRunLogs, getModelProject } from '../../lib/api';
import { toast } from '../../lib/toast';

type LogKind = 'build' | 'deployment' | 'drift';

export function TerminalLogViewer({
  modelId,
  buildId,
  deploymentId,
  driftRunId,
  onBuildSuccess,
  onCompleted,
  onRebuild,
  onCancel,
  buildDisabled,
  placeholder,
  title,
  logsOverride,
  isRunningOverride,
  customButtons,
  startLabel,
  stopLabel,
  restartLabel,
}: {
  modelId?: string | null;
  buildId?: string | null;
  deploymentId?: string | null;
  driftRunId?: string | null;
  onBuildSuccess?: (modelId: string, previewTree: string[]) => void;
  onCompleted?: (status: string) => void;
  onRebuild?: () => Promise<void> | void;
  onCancel?: () => void;
  buildDisabled?: boolean;
  placeholder?: string;
  title?: string;
  logsOverride?: string[];
  isRunningOverride?: boolean;
  customButtons?: React.ReactNode;
  startLabel?: string;
  stopLabel?: string;
  restartLabel?: string;
}) {
  const logKind: LogKind | null = buildId ? 'build' : deploymentId ? 'deployment' : driftRunId ? 'drift' : null;
  const resourceId = buildId || deploymentId || driftRunId || null;
  const [building, setBuilding] = useState(Boolean(resourceId));
  const [logs, setLogs] = useState<string[]>(resourceId ? ['[SYSTEM] Starting process...'] : [placeholder || '']);
  const [buildStatus, setBuildStatus] = useState<string>(resourceId ? 'building' : 'idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isStartingBuild, setIsStartingBuild] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const fetchLogs = async () => {
      if (!resourceId || !logKind || buildStatus !== 'building') return;
      try {
        const data = logKind === 'build'
          ? await getBuildLogs(resourceId, offsetRef.current)
          : logKind === 'deployment'
            ? await getDeploymentLogs(resourceId, offsetRef.current)
            : await getDriftRunLogs(resourceId, offsetRef.current);
        if (data.logs.length) {
          setLogs((previous) => [...previous, ...data.logs.filter((log) => !log.startsWith('BUILD_EOF_'))]);
          offsetRef.current = data.next_offset;
        }

        const succeeded = (logKind === 'build' && data.build_status === 'ready')
          || (logKind === 'deployment' && data.build_status === 'healthy')
          || (logKind === 'drift' && data.build_status === 'completed');
        const failed = ['failed', 'cancelled', 'unhealthy', 'error'].includes(data.build_status);
        if (!succeeded && !failed) return;

        setBuildStatus(data.build_status);
        setBuilding(false);
        if (succeeded) {
          if (logKind === 'build' && modelId) {
            toast.success('Build completed successfully!');
            const model = await getModelProject(modelId);
            onBuildSuccess?.(model.id, model.package_preview_tree || []);
          } else {
            toast.success(`${title || 'Process'} completed successfully!`);
          }
          onCompleted?.(data.build_status);
        } else {
          const message = data.build_error || (data.build_status === 'cancelled' ? 'Process cancelled.' : 'Process failed.');
          setErrorMsg(message);
          toast.error(message);
          onCompleted?.(data.build_status);
        }
      } catch {
        // Polling is best-effort; the next interval retries transient failures.
      }
    };

    if (building && logKind) {
      interval = setInterval(fetchLogs, 1500);
      fetchLogs();
    }
    return () => interval && clearInterval(interval);
  }, [building, buildStatus, logKind, modelId, onBuildSuccess, onCompleted, resourceId, title]);

  const isGeneric = logsOverride !== undefined;
  const activeLogs = isGeneric ? logsOverride : logs;
  const activeRunning = isGeneric ? Boolean(isRunningOverride) : building;
  const activeStatus = isGeneric
    ? (activeRunning ? 'building' : (activeLogs.length > (placeholder ? 1 : 0) ? 'ready' : 'idle'))
    : buildStatus;
  const activeTitle = title || 'Build Console';
  const activePlaceholder = placeholder || 'Click "Build" button to start building your model...';

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [activeLogs]);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900 shadow-lg">
      <div className="relative flex items-center border-b border-gray-700 bg-gray-800/80 px-4 py-3">
        <Terminal className="mr-2 h-4 w-4 text-gray-400" />
        <span className="text-xs font-mono text-gray-400">{activeTitle}</span>
        {activeRunning && <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-green-500" />}
        <div className="ml-auto flex items-center">
          {customButtons !== undefined ? customButtons : <>
            {activeStatus === 'idle' && onRebuild ? <button type="button" disabled={buildDisabled || isStartingBuild || activeRunning} onClick={async () => { setIsStartingBuild(true); try { await onRebuild(); } finally { setIsStartingBuild(false); } }} className="flex items-center gap-1.5 rounded-md bg-gray-700 px-3 py-1 text-xs font-medium text-white hover:bg-gray-600 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-400">
              {isStartingBuild ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}{startLabel || 'Build'}
            </button> : activeRunning && onCancel ? <button type="button" onClick={() => { if (!isGeneric) { setLogs((previous) => [...previous, '[SYSTEM] Process cancelled by user.']); setBuilding(false); setBuildStatus('cancelled'); } onCancel(); }} className="flex items-center gap-1.5 rounded-md border border-red-800/50 bg-red-900/30 px-3 py-1 text-xs font-medium text-red-400 hover:bg-red-800/50"><Square className="h-3 w-3" />{stopLabel || 'Stop'}</button> : activeStatus !== 'idle' && !activeRunning && onRebuild ? <button type="button" disabled={buildDisabled || isStartingBuild} onClick={async () => { setIsStartingBuild(true); try { await onRebuild(); } finally { setIsStartingBuild(false); } }} className="flex items-center gap-1.5 rounded-md bg-gray-700 px-3 py-1 text-xs font-medium text-white hover:bg-gray-600 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-400">{isStartingBuild ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}{restartLabel || 'Re-Build'}</button> : null}
          </>}
          <button type="button" onClick={() => { navigator.clipboard.writeText(activeLogs.join('\n')); toast.success('Logs copied.'); }} className="ml-3 flex items-center gap-1.5 rounded-md bg-gray-700 px-3 py-1 text-xs font-medium text-white hover:bg-gray-600" title="Copy log"><Clipboard className="h-3 w-3" />Copy</button>
        </div>
      </div>
      <div ref={terminalRef} className="h-72 w-full custom-scrollbar overflow-y-auto bg-gray-900 p-4 font-mono text-sm text-gray-300 antialiased" style={{ scrollBehavior: 'smooth' }}>
        {activeLogs.length === 0 ? <span className="text-gray-500">{activePlaceholder}</span> : !resourceId && !isGeneric ? <div className="mb-1 break-all text-gray-500 italic">{activePlaceholder}</div> : activeLogs.map((log, index) => <div key={index} className="mb-1 break-all whitespace-pre-wrap leading-tight"><span className={/error|exception|failed/i.test(log) ? 'text-red-400' : 'text-gray-300'}>{log}</span></div>)}
        {errorMsg && <div className="mt-4 border-t border-red-500/30 pt-4 text-red-400"><span className="font-bold">Error:</span> {errorMsg}</div>}
      </div>
    </div>
  );
}
