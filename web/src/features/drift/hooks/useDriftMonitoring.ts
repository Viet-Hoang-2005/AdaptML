import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiErrorMessage } from '@/shared/api/errors';
import { toast } from '@/shared/ui/toastStore';
import {
  createDriftMonitoringJob,
  deleteDriftMonitoringJob,
  listDriftMonitoringJobs,
  listDriftMonitoringResults,
  listReferenceFiles,
  runDriftMonitoringJob,
  updateDriftMonitoringJob,
  uploadReferenceData,
} from '@/features/drift/api/driftApi';
import { driftQueryKeys } from '@/features/drift/queryKeys';

export type { DriftMonitoringJob, DriftMonitoringResult } from '@/features/drift/types';

export function useDriftMonitoringJobs(modelId?: string) {
  return useQuery({
    queryKey: driftQueryKeys.monitors(modelId ?? ''),
    queryFn: () => listDriftMonitoringJobs(modelId!),
    enabled: Boolean(modelId),
  });
}

export function useDriftMonitoringResults(jobId?: string) {
  return useQuery({
    queryKey: driftQueryKeys.results(jobId ?? ''),
    queryFn: () => listDriftMonitoringResults(jobId!),
    enabled: Boolean(jobId),
  });
}

export function useCreateDriftMonitoringJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createDriftMonitoringJob,
    onSuccess: (_, variables) => queryClient.invalidateQueries({
      queryKey: driftQueryKeys.monitors(variables.model_id),
    }),
  });
}

export function useDeleteDriftMonitoringJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; model_id: string }) => deleteDriftMonitoringJob(payload.id),
    onSuccess: (_, variables) => queryClient.invalidateQueries({
      queryKey: driftQueryKeys.monitors(variables.model_id),
    }),
  });
}

export function useUpdateDriftMonitoringJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateDriftMonitoringJob,
    onSuccess: (_, variables) => queryClient.invalidateQueries({
      queryKey: driftQueryKeys.monitors(variables.model_id),
    }),
  });
}

export function useRunDriftMonitoringJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; model_id: string }) => runDriftMonitoringJob(payload.id),
    onSuccess: (_, variables) => {
      toast.success('Drift monitoring run queued');
      void queryClient.invalidateQueries({ queryKey: driftQueryKeys.results(variables.id) });
    },
    onError: (error: unknown) => toast.error(getApiErrorMessage(error, 'Failed to run drift monitoring')),
  });
}

export function useProductionData(modelId?: string) {
  return useQuery({
    queryKey: driftQueryKeys.productionData(modelId ?? ''),
    queryFn: async () => [] as { features: Record<string, unknown>; prediction: string }[],
    enabled: Boolean(modelId),
  });
}

export function useReferenceFiles(modelId?: string) {
  return useQuery({
    queryKey: driftQueryKeys.referenceFiles(modelId ?? ''),
    queryFn: async () => (await listReferenceFiles(modelId!)).map((file) => ({
      key: file.relative_path,
      size: file.size_bytes,
      last_modified: file.updated_at,
    })),
    enabled: Boolean(modelId),
  });
}

export function useUploadReferenceData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ modelId, file }: { modelId: string; file: File }) => uploadReferenceData(modelId, file),
    onSuccess: (_, variables) => queryClient.invalidateQueries({
      queryKey: driftQueryKeys.referenceFiles(variables.modelId),
    }),
  });
}
