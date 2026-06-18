export type ModelAccessMode = 'private' | 'public';
export type ModelAPIStatus = 'ready' | 'uploading' | 'error' | 'disabled';
export type ModelBuildStatus = 'not_started' | 'building' | 'ready' | 'error';
export type ModelFlavor = 'sklearn' | 'xgboost';

export interface ModelAPI {
  id: number;
  name: string;
  description: string;
  model_info: string;
  access_mode: ModelAccessMode;
  model_uri: string;
  endpoint_url: string;
  health_url: string;
  status: ModelAPIStatus;
  error_message: string;
  source_artifact: string;
  flavor: ModelFlavor | '';
  requirements_text: string;
  package_manifest: Record<string, unknown>;
  package_preview_tree: string[];
  build_status: ModelBuildStatus;
  build_error: string;
  created_at: string;
  updated_at: string;
}

export interface ModelAPIListResponse {
  models: ModelAPI[];
}

export interface ModelAPIFormValues {
  name: string;
  description: string;
  model_info: string;
  access_mode: ModelAccessMode;
  artifact?: File | null;
}

export interface ModelBuildFormValues {
  name: string;
  description: string;
  model_info: string;
  access_mode: ModelAccessMode;
  source_artifact: File | null;
  flavor: ModelFlavor;
  requirements_text: string;
  requirements_file?: File | null;
}

export interface PackagePreviewResponse {
  model_id: number;
  package_manifest: Record<string, unknown>;
  package_preview_tree: string[];
  build_status: ModelBuildStatus;
  build_error: string;
}

export interface ModelPredictionResponse {
  success: boolean;
  prediction: unknown;
  tenant_id: string;
  model_id: string;
}

export type TrainingJobStatus = 'pending' | 'uploading' | 'running' | 'completed' | 'failed';

export interface TrainingJob {
  id: number;
  name: string;
  model_version: string;
  entry_point: string;
  training_backend: 'sagemaker' | 'local' | 'aws_batch';
  vcpu: number;
  memory: number;
  max_runtime_seconds: number;
  source_zip: string;
  requirements_file: string;
  training_data: string;
  s3_source_uri: string;
  s3_training_data_uri: string;
  sagemaker_job_name: string;
  external_job_id: string;
  output_s3_uri: string;
  model_artifact_uri: string;
  status: TrainingJobStatus;
  error_message: string;
  training_logs: string;
  started_at: string | null;
  completed_at: string | null;
  runtime_seconds: number;
  stop_reason: string;
  deleted_at: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface TrainingJobListResponse {
  training_jobs: TrainingJob[];
}

export interface TrainingJobFormValues {
  name: string;
  model_version: string;
  entry_point: string;
  vcpu: number;
  memory: number;
  max_runtime_seconds: number;
  source_zip: File | null;
  requirements_file: File | null;
  training_data: File | null;
}

export interface TrainingJobDownloadURLResponse {
  download_url: string;
}

export interface TrainingJobLogsResponse {
  job_id: number;
  training_job_id: number;
  status: TrainingJobStatus;
  logs: string;
  text: string;
  log_stream_name: string;
  next_token: string;
  updated_at: string;
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
  job_id: number;
  training_job_id: number;
  status: TrainingJobStatus;
  metrics_available: boolean;
  latest: TrainingMetricPoint | null;
  history: TrainingMetricPoint[];
  log_stream_name: string;
  message: string;
  updated_at: string;
}

export interface TrainingUsageResponse {
  training_backend: 'sagemaker' | 'local' | 'aws_batch';
  monthly_quota_seconds: number;
  monthly_runtime_seconds: number;
  remaining_seconds: number;
  running_jobs_count: number;
  completed_jobs_count: number;
  failed_jobs_count: number;
  current_month_start: string;
  current_month_end: string;
}
