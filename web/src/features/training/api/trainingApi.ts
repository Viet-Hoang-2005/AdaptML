import { apiClient } from '@/shared/api/client';
import { controlPlaneURL } from '@/shared/api/config';
import { pageResults } from '@/shared/api/pagination';
import { getModelProject } from '@/features/catalog/api/catalogApi';
import type { ModelProject } from '@/features/catalog/types';
import type {
  TrainingJob,
  TrainingJobDownloadURLResponse,
  TrainingJobEventsResponse,
  TrainingJobFormValues,
  TrainingJobListResponse,
  TrainingJobLogsResponse,
  TrainingJobMetricsResponse,
  TrainingJobRegisterModelValues,
  TrainingUsageResponse,
} from '@/features/training/types';

const trainingJobFormData = (payload: TrainingJobFormValues) => {
  const formData = new FormData();
  formData.append('name', payload.name);
  formData.append('project', payload.registered_model_id || payload.project_id || '');
  formData.append('entry_point', payload.entry_point || 'train.py');
  formData.append('requirements_text', payload.requirements_text);
  formData.append('vcpu', String(payload.vcpu));
  formData.append('memory_mb', String(payload.memory));
  formData.append('max_runtime_seconds', String(payload.max_runtime_seconds));
  formData.append('accelerator_type', payload.accelerator_type);
  formData.append('accelerator_count', String(payload.accelerator_count));
  if (payload.source_zip) formData.append('source_zip', payload.source_zip);
  if (payload.training_data) formData.append('training_data', payload.training_data);
  if (payload.registered_model_id) formData.append('registered_model_id', payload.registered_model_id);
  return formData;
};

export const createTrainingJob = async (payload: TrainingJobFormValues): Promise<TrainingJob> => {
  const { data: job } = await apiClient.post<TrainingJob>(
    controlPlaneURL('/training-jobs/'),
    trainingJobFormData(payload),
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return (await apiClient.post<TrainingJob>(controlPlaneURL(`/training-jobs/${job.id}/submit/`))).data;
};

export const listTrainingJobs = async (includeDeleted = false): Promise<TrainingJobListResponse> => {
  void includeDeleted;
  const { data } = await apiClient.get<{ results: TrainingJob[] } | TrainingJob[]>(controlPlaneURL('/training-jobs/'));
  return { training_jobs: pageResults(data) };
};

export const getTrainingUsage = async (): Promise<TrainingUsageResponse> => {
  const { training_jobs: jobs } = await listTrainingJobs();
  const monthlyRuntime = jobs.reduce((total, job) => total + job.runtime_seconds, 0);
  const trainingBackend = ['argo', 'kubeflow'].includes(jobs[0]?.backend ?? '') ? 'kubeflow' : 'local';
  return {
    training_backend: trainingBackend,
    monthly_quota_seconds: 0,
    monthly_runtime_seconds: monthlyRuntime,
    remaining_seconds: 0,
    active_jobs_count: jobs.filter((job) => ['queued', 'running'].includes(job.status)).length,
    running_jobs_count: jobs.filter((job) => job.status === 'running').length,
    completed_jobs_count: jobs.filter((job) => job.status === 'completed').length,
    failed_jobs_count: jobs.filter((job) => job.status === 'failed').length,
    current_month_start: '',
    current_month_end: '',
  };
};

export const getTrainingJob = async (jobId: string): Promise<TrainingJob> =>
  (await apiClient.get<TrainingJob>(controlPlaneURL(`/training-jobs/${jobId}/`))).data;

export const refreshTrainingJobStatus = getTrainingJob;

export const getTrainingJobDownloadUrl = async (jobId: string): Promise<TrainingJobDownloadURLResponse> =>
  (await apiClient.get<TrainingJobDownloadURLResponse>(controlPlaneURL(`/training-jobs/${jobId}/download/`))).data;

export const registerTrainingJobModel = async (
  jobId: string,
  payload: TrainingJobRegisterModelValues,
): Promise<ModelProject> => {
  const job = await getTrainingJob(jobId);
  const project = await getModelProject(job.project_id);
  await apiClient.post(controlPlaneURL(`/registry/models/${job.project_id}/versions/`), {
    version: payload.model_version || '1',
    description: payload.description || '',
    flavor: payload.flavor || '',
    source_job: job.id,
  });
  return project;
};

export const getTrainingJobLogs = async (jobId: string, offset = 0): Promise<TrainingJobLogsResponse> => {
  const job = await getTrainingJob(jobId);
  const logs = String(job.tracking?.logs_tail ?? job.error_message ?? '');
  return {
    job_id: job.id,
    training_job_id: job.id,
    status: job.status,
    logs: logs.slice(offset),
    text: logs.slice(offset),
    next_offset: logs.length,
  };
};

export const getTrainingJobMetrics = async (jobId: string): Promise<TrainingJobMetricsResponse> => {
  const job = await getTrainingJob(jobId);
  return {
    job_id: job.id,
    training_job_id: job.id,
    status: job.status,
    metrics_available: false,
    latest: null,
    history: [],
    log_stream_name: '',
    message: 'Runtime metrics are not available for this backend.',
    updated_at: job.updated_at,
  };
};

export const getTrainingJobEvents = async (jobId: string): Promise<TrainingJobEventsResponse> => ({
  events: (await apiClient.get<TrainingJobEventsResponse['events']>(
    controlPlaneURL(`/training-jobs/${jobId}/events/`),
  )).data,
});

export const cancelTrainingJob = async (jobId: string): Promise<TrainingJob> => {
  const { data } = await apiClient.post<TrainingJob | { training_job: TrainingJob }>(
    controlPlaneURL(`/training-jobs/${jobId}/cancel/`),
  );
  return 'training_job' in data ? data.training_job : data;
};

export const retryTrainingJob = async (jobId: string): Promise<TrainingJob> => {
  const previous = await getTrainingJob(jobId);
  const { data: job } = await apiClient.post<TrainingJob>(controlPlaneURL('/training-jobs/'), {
    project: previous.project_id,
    name: previous.name,
    entry_point: previous.entry_point,
    requirements_text: previous.requirements_text,
    code_snapshot_uri: previous.code_snapshot_uri,
    data_snapshot_uri: previous.data_snapshot_uri,
    backend: previous.backend,
    vcpu: previous.vcpu,
    memory_mb: previous.memory_mb,
    max_runtime_seconds: previous.max_runtime_seconds,
    accelerator_type: previous.accelerator_type,
    accelerator_count: previous.accelerator_count,
  });
  return (await apiClient.post<TrainingJob>(controlPlaneURL(`/training-jobs/${job.id}/submit/`))).data;
};

export const deleteTrainingJob = async (jobId: string): Promise<TrainingJob> =>
  (await apiClient.delete<TrainingJob>(controlPlaneURL(`/training-jobs/${jobId}/`))).data;

export const restoreTrainingJob = getTrainingJob;
