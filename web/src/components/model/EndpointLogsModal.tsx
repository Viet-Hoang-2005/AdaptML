import { TerminalSquare, RefreshCw, Clipboard, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { getModelEndpointLogs } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { toast } from '../../lib/toast';
import type { ModelAPI } from '../../types/modelApi';

export function EndpointLogsModal({
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
  const { data: restLogs, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['endpoint-logs-modal', model.id],
    queryFn: () => getModelEndpointLogs(model.id),
    refetchInterval: 5000,
  });

  const text = wsLogs?.logs || restLogs?.logs || '';

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

  const handleCopy = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toast.success('Logs copied to clipboard.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="flex w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
              <TerminalSquare className="h-5 w-5 text-gray-600" />
              Endpoint Logs
            </h3>
            <p className="mt-1 text-xs text-gray-500 font-mono">
              {model.endpoint_container_name || `mlops_paas_model_endpoint_${model.id}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />}
              onClick={() => refetch()}
              disabled={isFetching}
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Clipboard className="h-4 w-4" />}
              onClick={handleCopy}
              disabled={!text}
            >
              Copy
            </Button>
            <button
              onClick={onClose}
              className="ml-2 rounded-full p-2 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="relative bg-[#0d1117] p-4 sm:p-6 flex-1 min-h-[400px] max-h-[70vh]">
          {error ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm font-medium text-red-400">Could not load endpoint logs.</p>
            </div>
          ) : isLoading && !text ? (
            <div className="flex h-full items-center justify-center">
              <p className="flex items-center gap-2 text-sm font-medium text-gray-400">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading endpoint logs...
              </p>
            </div>
          ) : !text ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm font-medium text-gray-500">No endpoint logs available yet.</p>
            </div>
          ) : (
            <pre
              ref={logsRef}
              className="h-full w-full overflow-auto text-[13px] leading-relaxed text-gray-300 font-mono scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600"
            >
              {text}
            </pre>
          )}

          {showScrollBtn && (
            <button
              onClick={() => {
                if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
                setShowScrollBtn(false);
              }}
              className="absolute bottom-6 right-6 rounded-full border border-gray-600 bg-gray-800/90 px-3 py-1.5 text-xs font-semibold text-gray-200 shadow-lg hover:bg-gray-700 backdrop-blur"
            >
              New logs ↓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
