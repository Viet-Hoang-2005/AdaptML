import { useState, useEffect, useRef } from 'react';
import { Terminal, Play, Square, Loader2, Clipboard } from 'lucide-react';
import { getBuildLogs, getModelAPI } from '../../lib/api';
import { toast } from '../../lib/toast';

export function TerminalLogViewer({
  modelId,
  onBuildSuccess,
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
  onBuildSuccess?: (modelId: string, previewTree: string[]) => void;
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
  const [building, setBuilding] = useState(!!modelId);
  const [logs, setLogs] = useState<string[]>(
    modelId ? ['[SYSTEM] Initiating build process...'] : [placeholder || '']
  );
  const [buildStatus, setBuildStatus] = useState<string>(modelId ? 'building' : 'idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isStartingBuild, setIsStartingBuild] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);

  const [prevModelId, setPrevModelId] = useState(modelId);
  if (modelId !== prevModelId) {
    setPrevModelId(modelId);
    setBuilding(!!modelId);
    setBuildStatus(modelId ? 'building' : 'idle');
    setLogs(modelId ? ['[SYSTEM] Initiating build process...'] : [placeholder || '']);
  }

  useEffect(() => {
    offsetRef.current = 0;
  }, [modelId]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    
    const fetchLogs = async () => {
      if (!modelId || buildStatus !== 'building') return;
      try {
        const data = await getBuildLogs(modelId, offsetRef.current);
        if (data.logs.length > 0) {
          setLogs(prev => {
            const newLogs = [...prev];
            data.logs.forEach(log => {
              if (log === 'BUILD_EOF_SUCCESS' || log === 'BUILD_EOF_ERROR') return;
              newLogs.push(log);
            });
            return newLogs;
          });
          offsetRef.current = data.next_offset;
        }
        
        if (data.build_status === 'ready' || data.build_status === 'error') {
          setBuildStatus(data.build_status);
          setBuilding(false);
          if (data.build_status === 'ready') {
             toast.success('Build completed successfully!');
             const finalModel = await getModelAPI(modelId);
             onBuildSuccess?.(finalModel.id, finalModel.package_preview_tree || []);
          } else {
             setErrorMsg(data.build_error || 'Build failed.');
             toast.error('Build failed.');
          }
        } else if (data.logs.includes('BUILD_EOF_ERROR')) {
          setBuildStatus('error');
          setBuilding(false);
          setErrorMsg('Build process exited with an error.');
        } else if (data.logs.includes('BUILD_EOF_SUCCESS')) {
          setBuildStatus('ready');
          setBuilding(false);
          toast.success('Build completed successfully!');
          const finalModel = await getModelAPI(modelId);
          onBuildSuccess?.(finalModel.id, finalModel.package_preview_tree || []);
        }
      } catch {
        // silently ignore network errors during polling
      }
    };

    if (building) {
      interval = setInterval(fetchLogs, 1500);
      fetchLogs(); // initial fetch
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [building, buildStatus, modelId, onBuildSuccess]);

  const isGeneric = logsOverride !== undefined;
  const activeLogs = isGeneric ? logsOverride : logs;
  const activeRunning = isGeneric ? (isRunningOverride || false) : building;
  const activeStatus = isGeneric 
    ? (activeRunning ? 'building' : (activeLogs.length > (placeholder ? 1 : 0) ? 'ready' : 'idle'))
    : buildStatus;
  const activeTitle = title || "Build Console";
  const activePlaceholder = placeholder || "Click \"Build\" button to start building your model...";

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [activeLogs]);

  return (
    <div className="overflow-hidden rounded-xl bg-gray-900 shadow-lg border border-gray-800">
      <div className="relative flex items-center px-4 py-3 bg-gray-800/80 border-b border-gray-700">
        <Terminal className="h-4 w-4 text-gray-400 mr-2" />
        <span className="text-xs font-mono text-gray-400">{activeTitle}</span>
        {activeRunning && <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>}
        <div className="ml-auto flex items-center">
          {customButtons !== undefined ? customButtons : (
            <>
              {activeStatus === 'idle' && onRebuild ? (
                <button
                  type="button"
                  disabled={buildDisabled || isStartingBuild || activeRunning}
                  onClick={async () => {
                    setIsStartingBuild(true);
                    try {
                      await onRebuild();
                    } finally {
                      setIsStartingBuild(false);
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium text-white ${
                    buildDisabled || isStartingBuild || activeRunning ? 'bg-gray-800 text-gray-400 cursor-not-allowed' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  {isStartingBuild ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  {startLabel || 'Build'}
                </button>
              ) : activeRunning && onCancel ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!isGeneric) {
                      setLogs(prev => [...prev, '[SYSTEM] Build process cancelled by user.']);
                      setBuilding(false);
                      setBuildStatus('error');
                    }
                    onCancel();
                  }}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium text-red-400 bg-red-900/30 hover:bg-red-800/50 border border-red-800/50"
                >
                  <Square className="h-3 w-3" />
                  {stopLabel || 'Stop'}
                </button>
              ) : activeStatus !== 'idle' && !activeRunning && onRebuild ? (
                <button
                  type="button"
                  disabled={buildDisabled || isStartingBuild}
                  onClick={async () => {
                    setIsStartingBuild(true);
                    try {
                      await onRebuild();
                    } finally {
                      setIsStartingBuild(false);
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium text-white ${
                    buildDisabled || isStartingBuild ? 'bg-gray-800 text-gray-400 cursor-not-allowed' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  {isStartingBuild ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  {restartLabel || 'Re-Build'}
                </button>
              ) : null}
            </>
          )}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(activeLogs.join('\n'));
              toast.success('Logs copied.');
            }}
            className="ml-3 flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium bg-gray-700 text-white hover:bg-gray-600 transition-colors"
            title="Copy log"
          >
            <Clipboard className="h-3 w-3" />
            Copy
          </button>
        </div>
      </div>
      <div 
        ref={terminalRef}
        className="h-72 w-full custom-scrollbar overflow-y-auto bg-gray-900 p-4 font-mono text-sm text-gray-300 antialiased"
        style={{ scrollBehavior: 'smooth' }}
      >
        {activeLogs.length === 0 ? (
          <span className="text-gray-500">{activePlaceholder}</span>
        ) : !modelId && !isGeneric ? (
          <div className="mb-1 leading-tight break-all text-gray-500 italic">
            {activePlaceholder}
          </div>
        ) : (
          activeLogs.map((log, i) => {
            const match = log.match(/^(\[\d{2}:\d{2}:\d{2}\])\s*(SUCCESS|INFO|WARNING|ERROR)(.*)/si);
            if (match) {
              const time = match[1];
              const level = match[2];
              const rest = match[3];
              const levelUpper = level.toUpperCase();
              const colorClass = levelUpper === 'SUCCESS' ? 'text-emerald-300' : levelUpper === 'WARNING' ? 'text-amber-300' : levelUpper === 'ERROR' ? 'text-red-400' : 'text-blue-300';
              return (
                <div key={i} className="mb-2 leading-relaxed break-all whitespace-pre-wrap">
                  <span className="text-gray-500">{time}</span>{' '}
                  <span className={colorClass}>{level}</span>
                  <span className="text-gray-300">{rest}</span>
                </div>
              );
            }
            
            const isError = log.includes('error') || log.includes('Exception') || log.includes('failed');
            return (
              <div key={i} className="mb-1 leading-tight break-all">
                <span className={isError ? 'text-red-400' : 'text-gray-300'}>
                  {log}
                </span>
              </div>
            );
          })
        )}
        {errorMsg && (
          <div className="mt-4 border-t border-red-500/30 pt-4 text-red-400">
            <span className="font-bold">Error:</span> {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}
