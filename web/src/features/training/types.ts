import type { ResourceId } from '@/shared/types';
import type { ModelAccessMode, ModelFlavor, ModelProject } from '@/features/catalog/types';

export type TrainingJobStatus = 'pending' | 'queued' | 'uploading' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TrainingAcceleratorType = 'none' | 'gpu' | 'tpu' | 'trainium';

export interface TrainingJob {
  id: ResourceId;
  project_id: ResourceId;
  name: string;
  model_version: string;
  entry_point: string;
  requirements_text: string;
  training_backend: 'kubeflow' | 'local';
  backend: 'docker' | 'argo' | 'kubeflow' | 'local';
  vcpu: number;
  memory: number;
  memory_mb: number;
  max_runtime_seconds: number;
  accelerator_type: TrainingAcceleratorType;
  accelerator_count: number;
  source_zip: string;
  requirements_file: string;
  training_data: string;
  s3_source_uri: string;
  s3_training_data_uri: string;
  code_snapshot_uri: string;
  data_snapshot_uri: string;
  sagemaker_job_name: string;
  external_job_id: string;
  output_s3_uri: string;
  output_uri: string;
  model_artifact_uri: string;
  status: TrainingJobStatus;
  error_message: string;
  training_logs: string;
  tracking: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  runtime_seconds: number;
  stop_reason: string;
  retry_of: ResourceId | null;
  deleted_at: string | null;
  is_deleted: boolean;
  registered_model: ModelProject | null;
  registered_model_id: ResourceId | null;
  created_at: string;
  updated_at: string;
}

export interface TrainingJobRegisterModelValues {
  model_name: string;
  model_version?: string;
  flavor?: ModelFlavor | '';
  access_mode?: ModelAccessMode;
  description?: string;
}

export interface TrainingJobListResponse { training_jobs: TrainingJob[] }

export interface TrainingJobFormValues {
  name: string;
  model_version: string;
  entry_point: string;
  requirements_text: string;
  vcpu: number;
  memory: number;
  max_runtime_seconds: number;
  accelerator_type: TrainingAcceleratorType;
  accelerator_count: number;
  source_zip: File | null;
  training_data: File | null;
  registered_model_id?: ResourceId;
  project_id?: ResourceId;
}

export interface TrainingJobDownloadURLResponse { download_url: string }

export interface TrainingJobLogsResponse {
  job_id: ResourceId;
  training_job_id: ResourceId;
  status: TrainingJobStatus;
  logs: string | string[];
  text: string;
  log_stream_name?: string;
  next_token?: string;
  next_offset?: number;
  error_message?: string;
  updated_at?: string;
}

export interface TrainingMetricPoint {
  timestamp: string;
  cpu_percent: number | null;
  cpu_limit_cores: number | null;
  memory_used_mb: number | null;
  memory_limit_mb: number | null;
  memory_percent: number | null;
  gpu_available: boolean;
  gpu_percent: number | null;
  gpu_memory_used_mb: number | null;
  gpu_memory_total_mb: number | null;
  gpu_memory_percent: number | null;
}

export interface TrainingJobMetricsResponse {
  job_id: ResourceId;
  training_job_id: ResourceId;
  status: TrainingJobStatus;
  metrics_available: boolean;
  latest: TrainingMetricPoint | null;
  history: TrainingMetricPoint[];
  log_stream_name: string;
  message: string;
  updated_at: string;
}

export interface TrainingJobEvent {
  id: ResourceId;
  training_job?: ResourceId;
  event_type: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TrainingJobEventsResponse { events: TrainingJobEvent[] }

export interface TrainingUsageResponse {
  training_backend: 'kubeflow' | 'local';
  monthly_quota_seconds: number;
  monthly_runtime_seconds: number;
  remaining_seconds: number;
  active_jobs_count: number;
  running_jobs_count: number;
  completed_jobs_count: number;
  failed_jobs_count: number;
  current_month_start: string;
  current_month_end: string;
}
