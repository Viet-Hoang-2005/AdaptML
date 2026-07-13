import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import axiosInstance from '../lib/axios';
import { controlPlaneURL, getProjectVersions } from '../lib/api';
import { toast } from '../lib/toast';

interface Page<T> { results?: T[] }

export interface DriftMonitoringResult {
  id: string;
  status: string;
  report_url: string;
  report_html_uri?: string;
  drift_score: number;
  dataset_drift: boolean;
  has_drift?: boolean;
  drifted_features_count: number;
  total_features: number;
  run_at: string;
  created_at?: string;
}

export interface DriftMonitoringJob {
  id: string;
  project_id: string;
  version_id: string;
  reference_asset_id: string;
  trigger_threshold: number;
  reference_data_s3_path: string;
  status: string;
  runs: DriftMonitoringResult[];
  created_at: string;
  updated_at: string;
}

interface WorkspaceDataFile {
  id: string;
  relative_path: string;
  s3_uri: string;
  download_url: string;
  size_bytes: number;
  updated_at: string;
}

const results = <T>(data: Page<T> | T[]) => Array.isArray(data) ? data : (data.results ?? []);

export function useDriftMonitoringJobs(modelId?: string) {
  return useQuery({
    queryKey: ['drift-jobs', modelId],
    queryFn: async () => {
      const { data } = await axiosInstance.get<Page<DriftMonitoringJob> | DriftMonitoringJob[]>(controlPlaneURL('/drift-monitors/'));
      return results(data).filter((monitor) => monitor.project_id === modelId);
    },
    enabled: Boolean(modelId),
  });
}

export function useDriftMonitoringResults(jobId?: string) {
  return useQuery({
    queryKey: ['drift-results', jobId],
    queryFn: async () => {
      const { data } = await axiosInstance.get<DriftMonitoringJob>(controlPlaneURL(`/drift-monitors/${jobId}/`));
      return data.runs ?? [];
    },
    enabled: Boolean(jobId),
  });
}

async function resolveMonitorInputs(projectId: string, referencePath: string) {
  const [versions, files] = await Promise.all([
    getProjectVersions(projectId),
    axiosInstance.get<WorkspaceDataFile[]>(controlPlaneURL(`/models/${projectId}/workspace/data/files/`)),
  ]);
  const version = versions[0];
  const file = files.data.find((item) => item.id === referencePath || item.relative_path === referencePath || item.s3_uri === referencePath);
  if (!version) throw new Error('Register a model version before configuring drift monitoring.');
  if (!file) throw new Error('Select reference data from the project workspace.');
  return { version, file };
}

export function useCreateDriftMonitoringJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { model_id: string; trigger_threshold: number; reference_data_s3_path: string }) => {
      const { version, file } = await resolveMonitorInputs(payload.model_id, payload.reference_data_s3_path);
      const { data } = await axiosInstance.post<DriftMonitoringJob>(controlPlaneURL('/drift-monitors/'), {
        version: version.id,
        reference_asset: file.id,
        name: 'default',
        trigger_threshold: payload.trigger_threshold,
      });
      return data;
    },
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ['drift-jobs', variables.model_id] }),
  });
}

export function useDeleteDriftMonitoringJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; model_id: string }) => {
      await axiosInstance.delete(controlPlaneURL(`/drift-monitors/${payload.id}/`));
    },
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ['drift-jobs', variables.model_id] }),
  });
}

export function useUpdateDriftMonitoringJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; model_id: string; trigger_threshold: number; reference_data_s3_path: string }) => {
      const { version, file } = await resolveMonitorInputs(payload.model_id, payload.reference_data_s3_path);
      const { data } = await axiosInstance.put<DriftMonitoringJob>(controlPlaneURL(`/drift-monitors/${payload.id}/`), {
        version: version.id,
        reference_asset: file.id,
        name: 'default',
        trigger_threshold: payload.trigger_threshold,
      });
      return data;
    },
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ['drift-jobs', variables.model_id] }),
  });
}

export function useRunDriftMonitoringJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string; model_id: string }) => {
      const { data } = await axiosInstance.post<DriftMonitoringResult>(controlPlaneURL(`/drift-monitors/${payload.id}/runs/`), undefined, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      return data;
    },
    onSuccess: (_, variables) => {
      toast.success('Drift monitoring run queued');
      queryClient.invalidateQueries({ queryKey: ['drift-results', variables.id] });
    },
    onError: (error: AxiosError<{ error?: string }>) => {
      toast.error(error.response?.data?.error || error.message || 'Failed to run drift monitoring');
    },
  });
}

export function useProductionData(modelId?: string) {
  return useQuery({
    queryKey: ['production-data', modelId],
    queryFn: async () => [] as { features: Record<string, unknown>; prediction: string }[],
    enabled: Boolean(modelId),
  });
}

export function useReferenceFiles(modelId?: string) {
  return useQuery({
    queryKey: ['reference-files', modelId],
    queryFn: async () => {
      const { data } = await axiosInstance.get<WorkspaceDataFile[]>(controlPlaneURL(`/models/${modelId}/workspace/data/files/`));
      return data.map((file) => ({ key: file.relative_path, size: file.size_bytes, last_modified: file.updated_at }));
    },
    enabled: Boolean(modelId),
  });
}

export function useUploadReferenceData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ modelId, file }: { modelId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('relative_path', file.name);
      const { data } = await axiosInstance.post(controlPlaneURL(`/models/${modelId}/workspace/data/files/`), formData);
      return data;
    },
    onSuccess: (_, variables) => queryClient.invalidateQueries({ queryKey: ['reference-files', variables.modelId] }),
  });
}
