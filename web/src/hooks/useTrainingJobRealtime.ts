import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../lib/queryKeys';
import type {
  TrainingJob,
  TrainingJobEvent,
  TrainingJobLogsResponse,
  TrainingJobMetricsResponse,
} from '../types/modelApi';

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'fallback';

interface UseTrainingJobRealtimeOptions {
  onStatusTransition?: (prevStatus: string, nextStatus: string) => void;
}

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

function buildWsUrl(jobId: number, token: string): string {
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/auth';
  const httpBase = apiBase.replace(/\/api\/auth\/?$/, '').replace(/\/api\/?$/, '');
  const wsBase = httpBase.replace(/^http/, 'ws');
  return `${wsBase}/ws/training-jobs/${jobId}/?token=${encodeURIComponent(token)}`;
}

export function useTrainingJobRealtime(
  jobId: number | null | undefined,
  options: UseTrainingJobRealtimeOptions = {},
) {
  const queryClient = useQueryClient();
  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected');
  const lastStatusRef = useRef<string | null>(null);
  const toastedTransitionsRef = useRef<Set<string>>(new Set());
  const onStatusTransitionRef = useRef(options.onStatusTransition);

  useEffect(() => {
    onStatusTransitionRef.current = options.onStatusTransition;
  }, [options.onStatusTransition]);

  useEffect(() => {
    if (!jobId) {
      const fallbackTimer = setTimeout(() => setWsStatus('fallback'), 0);
      return () => clearTimeout(fallbackTimer);
    }

    const token = localStorage.getItem('access_token');
    if (!token) {
      const fallbackTimer = setTimeout(() => setWsStatus('fallback'), 0);
      return () => clearTimeout(fallbackTimer);
    }

    let closed = false;
    let retryCount = 0;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const updateJobCache = (job: Partial<TrainingJob> & { id: number }) => {
      queryClient.setQueryData(queryKeys.trainingJob(job.id), (old: TrainingJob | undefined) =>
        old ? { ...old, ...job } : old,
      );
      queryClient.setQueryData(queryKeys.trainingJobs, (old: { training_jobs: TrainingJob[] } | undefined) => {
        if (!old) return old;
        return {
          training_jobs: old.training_jobs.map((item) => (item.id === job.id ? { ...item, ...job } : item)),
        };
      });
    };

    const handleSnapshot = (message: Record<string, unknown>) => {
      const job = message.job as Partial<TrainingJob> & { id: number };
      if (!job?.id) return;

      const nextStatus = String(message.status || job.status || '');
      if (nextStatus && lastStatusRef.current && lastStatusRef.current !== nextStatus) {
        const transitionKey = `${lastStatusRef.current}->${nextStatus}`;
        if (!toastedTransitionsRef.current.has(transitionKey)) {
          toastedTransitionsRef.current.add(transitionKey);
          onStatusTransitionRef.current?.(lastStatusRef.current, nextStatus);
        }
      }
      if (nextStatus) lastStatusRef.current = nextStatus;
      updateJobCache(job);
    };

    const handleMessage = (raw: string) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      const type = String(message.type || '');
      if (type === 'training.job.snapshot') {
        handleSnapshot(message);
        return;
      }

      const messageJobId = Number(message.job_id);
      if (!messageJobId) return;

      if (type === 'training.job.logs') {
        const logsPayload: TrainingJobLogsResponse = {
          job_id: messageJobId,
          training_job_id: messageJobId,
          status: 'running',
          text: String(message.text || ''),
          logs: String(message.text || ''),
          log_stream_name: String(message.log_stream_name || ''),
          next_token: '',
          updated_at: String(message.updated_at || new Date().toISOString()),
        };
        queryClient.setQueryData(queryKeys.trainingJobLogs(messageJobId), logsPayload);
      } else if (type === 'training.job.metrics') {
        queryClient.setQueryData(
          queryKeys.trainingJobMetrics(messageJobId),
          message.metrics as TrainingJobMetricsResponse,
        );
      } else if (type === 'training.job.events') {
        queryClient.setQueryData(queryKeys.trainingJobEvents(messageJobId), {
          events: (message.events || []) as TrainingJobEvent[],
        });
      }
    };

    const connect = () => {
      if (closed) return;
      setWsStatus('connecting');

      socket = new WebSocket(buildWsUrl(jobId, token));
      socket.onopen = () => {
        retryCount = 0;
        setWsStatus('connected');
      };
      socket.onmessage = (event) => handleMessage(String(event.data));
      socket.onerror = () => {
        // The browser will follow this with onclose; reconnect there.
      };
      socket.onclose = () => {
        if (closed) return;
        if (retryCount >= MAX_RETRIES) {
          setWsStatus('fallback');
          return;
        }
        setWsStatus('disconnected');
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** retryCount, BACKOFF_MAX_MS);
        retryCount += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    retryTimer = setTimeout(connect, 0);

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close(1000, 'component unmounted');
      }
    };
  }, [jobId, queryClient]);

  return { wsStatus };
}
