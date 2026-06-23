import { TerminalSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';

export function BuildLogsPanel({ modelId }: { modelId: string }) {
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

  if (!logs.length && !text) return null;

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-gray-800 bg-[#0d1117] shadow-inner">
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900/50 px-4 py-2.5">
        <span className="flex items-center gap-2 text-xs font-semibold text-green-400">
          <TerminalSquare className="h-4 w-4" />
          Build Process Logs
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-300 transition-colors"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {expanded && (
        <div className="relative">
          <pre
            ref={logsRef}
            className="max-h-64 overflow-auto p-4 text-[13px] leading-relaxed text-gray-300 font-mono whitespace-pre-wrap scrollbar-thin scrollbar-track-gray-900 scrollbar-thumb-gray-700"
          >
            {text || 'Waiting for build logs...'}
          </pre>
          {showScrollBtn && (
            <button
              onClick={() => {
                if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
                setShowScrollBtn(false);
              }}
              className="absolute bottom-4 right-4 rounded-full border border-gray-600 bg-gray-800/90 px-3 py-1.5 text-xs font-semibold text-gray-200 shadow-lg hover:bg-gray-700 backdrop-blur"
            >
              New logs ↓
            </button>
          )}
        </div>
      )}
    </div>
  );
}
