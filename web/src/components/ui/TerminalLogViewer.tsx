import { useState, useEffect, useRef } from 'react';
import { Terminal, Play, XOctagon } from 'lucide-react';
import { getBuildLogs, getModelAPI } from '../../lib/api';
import { toast } from '../../lib/toast';

export function TerminalLogViewer({
  modelId,
  onBuildSuccess,
  onRebuild,
  buildDisabled,
  placeholder = 'Click "Build" button to start building your model...',
}: {
  modelId: number | null;
  onBuildSuccess: (modelId: number, previewTree: string[]) => void;
  onRebuild?: () => void;
  buildDisabled?: boolean;
  placeholder?: string;
}) {
  const [building, setBuilding] = useState(!!modelId);
  const [logs, setLogs] = useState<string[]>(
    modelId ? ['[SYSTEM] Initiating build process...'] : [placeholder]
  );
  const [buildStatus, setBuildStatus] = useState<string>(modelId ? 'building' : 'idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const terminalRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);

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
             onBuildSuccess(finalModel.id, finalModel.package_preview_tree || []);
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
          onBuildSuccess(finalModel.id, finalModel.package_preview_tree || []);
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

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="overflow-hidden rounded-xl bg-gray-900 shadow-lg border border-gray-800">
      <div className="flex items-center px-4 py-3 bg-gray-800/80 border-b border-gray-700">
        <Terminal className="h-4 w-4 text-gray-400 mr-2" />
        <span className="text-xs font-mono text-gray-400">Build Console</span>
        {building && <span className="ml-auto flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>}
        <div className="ml-auto flex items-center">
          {buildStatus === 'idle' && onRebuild ? (
            <button
              type="button"
              disabled={buildDisabled}
              onClick={onRebuild}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium text-white ${
                buildDisabled ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <Play className="h-3 w-3" />
              Build
            </button>
          ) : buildStatus === 'error' && onRebuild ? (
            <button
              type="button"
              disabled={buildDisabled}
              onClick={onRebuild}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium text-white ${
                buildDisabled ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              <XOctagon className="h-3 w-3" />
              Re-Build
            </button>
          ) : null}
        </div>
      </div>
      <div 
        ref={terminalRef}
        className="h-72 w-full overflow-y-auto bg-gray-900 p-4 font-mono text-sm text-gray-300 antialiased"
        style={{ scrollBehavior: 'smooth' }}
      >
        {logs.length === 0 ? (
          <span className="text-gray-500">Waiting for logs...</span>
        ) : !modelId ? (
          <div className="mb-1 leading-tight break-all text-gray-500 italic">
            {placeholder}
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="mb-1 leading-tight break-all">
              <span className="text-gray-500 mr-2">
                {String(i + 1).padStart(3, '0')}
              </span>
              <span className={log.includes('error') || log.includes('Exception') || log.includes('failed') ? 'text-red-400' : 'text-gray-300'}>
                {log}
              </span>
            </div>
          ))
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
