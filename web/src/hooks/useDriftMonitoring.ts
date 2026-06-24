import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axiosInstance from '../lib/axios';
import { controlPlaneURL } from '../lib/api';

export interface DriftMonitoringJob {
  id: number;
  model_api_id: string;
  trigger_threshold: number;
  reference_data_s3_path: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DriftMonitoringResult {
  id: number;
  job: number;
  report_url: string;
  drift_score: number;
  dataset_drift: boolean;
  drifted_features_count: number;
  total_features: number;
  run_at: string;
}

export function useDriftMonitoringJobs(modelId?: string) {
  return useQuery({
    queryKey: ['drift-jobs', modelId],
    queryFn: async () => {
      const { data } = await axiosInstance.get<DriftMonitoringJob[]>(controlPlaneURL('/drift-jobs/'), {
        params: { model_id: modelId }
      });
      return data;
    },
    enabled: !!modelId,
  });
}

export function useDriftMonitoringResults(jobId?: number) {
  return useQuery({
    queryKey: ['drift-results', jobId],
    queryFn: async () => {
      const { data } = await axiosInstance.get<DriftMonitoringResult[]>(controlPlaneURL(`/drift-jobs/${jobId}/results/`));
      return data;
    },
    enabled: !!jobId,
  });
}

export function useCreateDriftMonitoringJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      model_id: string;
      trigger_threshold: number;
      reference_data_s3_path: string;
    }) => {
      const { data } = await axiosInstance.post<DriftMonitoringJob>(controlPlaneURL('/drift-jobs/'), payload);
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['drift-jobs', variables.model_id] });
    },
  });
}

export function useDeleteDriftMonitoringJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: number; model_id: string }) => {
      await axiosInstance.delete(controlPlaneURL(`/drift-jobs/${payload.id}/`));
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['drift-jobs', variables.model_id] });
    },
  });
}

export function useUpdateDriftMonitoringJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      id: number;
      model_id: string;
      trigger_threshold: number;
      reference_data_s3_path: string;
    }) => {
      const { data } = await axiosInstance.put<DriftMonitoringJob>(controlPlaneURL(`/drift-jobs/${payload.id}/`), payload);
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['drift-jobs', variables.model_id] });
    },
  });
}

export function useRunDriftMonitoringJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: number; model_id: string }) => {
      await axiosInstance.post(controlPlaneURL(`/drift-jobs/${payload.id}/run/`));
    },
    onSuccess: (_, variables) => {
      // Invalidate results after triggering (although it's async, we might want to poll)
      queryClient.invalidateQueries({ queryKey: ['drift-results', variables.id] });
    },
  });
}

export function useProductionData(modelId?: string) {
  return useQuery({
    queryKey: ['production-data', modelId],
    queryFn: async () => {
      const { data } = await axiosInstance.get<{ features: Record<string, unknown>; prediction: string }[]>(controlPlaneURL(`/models/${modelId}/production-data/`));
      return data;
    },
    enabled: !!modelId,
  });
}

export function useReferenceFiles(modelId?: string) {
  return useQuery({
    queryKey: ['reference-files', modelId],
    queryFn: async () => {
      const { data } = await axiosInstance.get<{key: string, s3_uri: string, size: number, last_modified: string}[]>(controlPlaneURL(`/models/${modelId}/reference-files/`));
      return data;
    },
    enabled: !!modelId,
  });
}

export function useUploadReferenceData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ modelId, file }: { modelId: string, file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await axiosInstance.post<{s3_uri: string, message: string}>(controlPlaneURL(`/models/${modelId}/reference-data/`), formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['reference-files', variables.modelId] });
    },
  });
}
