/**
 * useModelRealtime — WebSocket realtime hook for ModelAPI deployment sync.
 *
 * Connects to: ws(s)://<host>/ws/models/<modelId>/?token=<access_token>
 *
 * Responsibilities:
 *  - Push model.snapshot updates into TanStack cache (list + detail + any registered_model in training jobs)
 *  - Push model.build_logs into modelBuildLogs(<id>) cache
 *  - Push model.endpoint_logs into modelEndpointLogs(<id>) cache
 *  - Toast only on meaningful status transitions (build, endpoint)
 *  - Reconnect with exponential backoff; fall back to polling after MAX_RETRIES
 */

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '../lib/queryKeys';
import { toast } from '../lib/toast';
import type { ModelAPI, ModelAPIListResponse } from '../types/modelApi';
import type { TrainingJob } from '../types/modelApi';

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'fallback';

interface UseModelRealtimeOptions {
  /** Called on every status transition (build or endpoint). */
  onStatusTransition?: (kind: 'build' | 'endpoint', prevStatus: string, nextStatus: string) => void;
}

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;

function buildWsUrl(modelId: string, token: string): string {
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/auth';
  const httpBase = apiBase.replace(/\/api\/auth\/?$/, '').replace(/\/api\/?$/, '');
  const wsBase = httpBase.replace(/^http/, 'ws');
  return `${wsBase}/ws/models/${modelId}/?token=${encodeURIComponent(token)}`;
}

export function useModelRealtime(
  modelId: string | null | undefined,
  options: UseModelRealtimeOptions = {},
) {
  const queryClient = useQueryClient();
  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected');

  // Track previous build/endpoint statuses per model for toast dedup.
  const prevBuildStatusRef = useRef<string | null>(null);
  const prevEndpointStatusRef = useRef<string | null>(null);
  const toastedRef = useRef<Set<string>>(new Set());
  const onStatusTransitionRef = useRef(options.onStatusTransition);

  useEffect(() => {
    onStatusTransitionRef.current = options.onStatusTransition;
  }, [options.onStatusTransition]);

  useEffect(() => {
    if (!modelId) {
      const t = setTimeout(() => setWsStatus('fallback'), 0);
      return () => clearTimeout(t);
    }
    const token = localStorage.getItem('access_token');
    if (!token) {
      const t = setTimeout(() => setWsStatus('fallback'), 0);
      return () => clearTimeout(t);
    }

    let closed = false;
    let retryCount = 0;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Cache helpers ────────────────────────────────────────────────────────

    const updateModelCache = (model: Partial<ModelAPI> & { id: number }) => {
      // Update list cache
      queryClient.setQueryData<ModelAPIListResponse>(queryKeys.modelApis, (old) => {
        if (!old) return old;
        return {
          models: old.models.map((m) => (m.id === model.id ? { ...m, ...model } : m)),
        };
      });
      // Update detail cache if present
      queryClient.setQueryData<ModelAPI>(queryKeys.modelApi(model.id), (old) =>
        old ? { ...old, ...model } : old,
      );
      // Update registered_model inside any TrainingJob that references this model
      queryClient.setQueriesData<TrainingJob>(
        { queryKey: ['training-jobs', 'detail'] },
        (job) => {
          if (!job || job.registered_model?.id !== model.id) return job;
          return { ...job, registered_model: { ...job.registered_model, ...model } };
        },
      );
    };

    // ── Toast helpers ────────────────────────────────────────────────────────

    const maybeToastBuild = (
      modelName: string,
      version: string,
      prev: string | null,
      next: string,
    ) => {
      if (!prev || prev === next) return;
      const key = `build:${modelId}:${prev}→${next}`;
      if (toastedRef.current.has(key)) return;
      toastedRef.current.add(key);
      if (prev === 'building' && next === 'ready') {
        toast.success(`Build completed for ${modelName}@${version}`);
        onStatusTransitionRef.current?.('build', prev, next);
      } else if (prev === 'building' && next === 'error') {
        toast.error(`Build failed for ${modelName}@${version}`);
        onStatusTransitionRef.current?.('build', prev, next);
      }
    };

    const maybeToastEndpoint = (
      modelName: string,
      version: string,
      prev: string | null,
      next: string,
    ) => {
      if (!prev || prev === next) return;
      const key = `endpoint:${modelId}:${prev}→${next}`;
      if (toastedRef.current.has(key)) return;
      toastedRef.current.add(key);
      if (prev === 'deploying' && next === 'healthy') {
        toast.success(`Endpoint healthy for ${modelName}@${version}`);
        onStatusTransitionRef.current?.('endpoint', prev, next);
      } else if (prev === 'deploying' && (next === 'deploy_failed' || next === 'unhealthy')) {
        toast.error(`Endpoint ${next.replace('_', ' ')} for ${modelName}@${version}`);
        onStatusTransitionRef.current?.('endpoint', prev, next);
      } else if (next === 'stopped') {
        toast.warning(`Endpoint stopped for ${modelName}@${version}`);
        onStatusTransitionRef.current?.('endpoint', prev, next);
      }
    };

    // ── Message handler ──────────────────────────────────────────────────────

    const handleMessage = (raw: string) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      const type = String(message.type || '');

      if (type === 'model.snapshot') {
        const model = message.model as Partial<ModelAPI> & { id: number };
        if (!model?.id) return;

        const nextBuild = String(message.build_status || model.build_status || '');
        const nextEndpoint = String(message.endpoint_status || model.endpoint_status || '');
        const modelName = String(model.name || '');
        const version = String(model.version || 'v1');

        // Toast only after initial load (refs will be null on first message)
        if (prevBuildStatusRef.current !== null) {
          maybeToastBuild(modelName, version, prevBuildStatusRef.current, nextBuild);
        }
        if (prevEndpointStatusRef.current !== null) {
          maybeToastEndpoint(modelName, version, prevEndpointStatusRef.current, nextEndpoint);
        }

        if (nextBuild) prevBuildStatusRef.current = nextBuild;
        if (nextEndpoint) prevEndpointStatusRef.current = nextEndpoint;

        updateModelCache(model);
        return;
      }

      const msgModelId = String(message.model_id);
      if (!msgModelId) return;

      if (type === 'model.build_logs') {
        const logs = (message.logs as string[]) || [];
        queryClient.setQueryData(queryKeys.modelBuildLogs(msgModelId), {
          model_id: msgModelId,
          logs,
          updated_at: String(message.updated_at || new Date().toISOString()),
        });
        return;
      }

      if (type === 'model.endpoint_logs') {
        queryClient.setQueryData(queryKeys.modelEndpointLogs(msgModelId), {
          model_id: msgModelId,
          logs: String(message.logs || ''),
          updated_at: String(message.updated_at || new Date().toISOString()),
        });
        return;
      }
    };

    // ── Connection lifecycle ─────────────────────────────────────────────────

    const connect = () => {
      if (closed) return;
      setWsStatus('connecting');

      socket = new WebSocket(buildWsUrl(modelId, token));
      socket.onopen = () => {
        retryCount = 0;
        setWsStatus('connected');
      };
      socket.onmessage = (event) => handleMessage(String(event.data));
      socket.onerror = () => {
        // browser will follow with onclose
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
  }, [modelId, queryClient]);

  return { wsStatus };
}
