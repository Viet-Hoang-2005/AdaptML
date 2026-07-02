// Deprecated: WebSocket hook for training jobs has been removed.
// Training job pages now use React Query HTTP Polling with Redis backend.
export function useTrainingJobRealtime() {
  return { wsStatus: 'fallback' as const };
}
