export type ModelAccessMode = 'private' | 'public';
export type ModelAPIStatus =
  | 'registered'
  | 'ready'
  | 'uploading'
  | 'deploying'
  | 'deployed'
  | 'unhealthy'
  | 'deploy_failed'
  | 'stopped'
  | 'archived'
  | 'error'
  | 'disabled';
export type ModelBuildStatus = 'not_started' | 'building' | 'ready' | 'error';
export type ModelEndpointStatus = 'not_deployed' | 'deploying' | 'healthy' | 'unhealthy' | 'deploy_failed' | 'stopped';
export type ModelFlavor = 'sklearn' | 'xgboost';
export type ModelSourceType = 'manual_upload' | 'training_job';

export interface ModelAPI {
  id: string;
  name: string;
  version: string;
  description: string;
  model_info: string;
  access_mode: ModelAccessMode;
  source_type: ModelSourceType;
  source_training_job: number | null;
  source_artifact_uri: string;
  model_uri: string;
  endpoint_url: string;
  health_url: string;
  status: ModelAPIStatus;
  error_message: string;
  endpoint_status: ModelEndpointStatus;
  endpoint_error: string;
  endpoint_last_checked_at: string | null;
  endpoint_container_name: string;
  endpoint_image_name: string;
  endpoint_public_path: string;
  endpoint_internal_path: string;
  source_artifact: string;
  flavor: ModelFlavor | '';
  requirements_text: string;
  package_manifest: Record<string, unknown>;
  package_preview_tree: string[];
  build_status: ModelBuildStatus;
  build_error: string;
  source_code_file?: string | null;
  reference_data_file?: string | null;
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
  version?: string;
  artifact?: File | null;
  source_code_file?: File | null;
  reference_data_file?: File | null;
}

export interface ModelBuildFormValues {
  name: string;
  description: string;
  model_info: string;
  access_mode: ModelAccessMode;
  version?: string;
  source_artifact: File | null;
  label_mapping_file?: File | null;
  source_code_file?: File | null;
  reference_data_file?: File | null;
  flavor: ModelFlavor;
  requirements_text: string;
  requirements_file?: File | null;
}

export interface PackagePreviewResponse {
  model_id: string;
  package_manifest: Record<string, unknown>;
  package_preview_tree: string[];
  build_status: ModelBuildStatus;
  build_error: string;
}

export interface ModelEndpointLogsResponse {
  model_id: string;
  container_name: string;
  logs: string;
}

export interface ModelPredictionResponse {
  success: boolean;
  prediction: unknown;
  confidence: number | null;
  tenant_id: string;
  model_id: string;
}

export type TrainingJobStatus = 'pending' | 'uploading' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TrainingAcceleratorType = 'none' | 'gpu' | 'tpu' | 'trainium';

export interface TrainingJob {
  id: number;
  name: string;
  model_version: string;
  entry_point: string;
  training_backend: 'sagemaker' | 'local' | 'aws_batch';
  vcpu: number;
  memory: number;
  max_runtime_seconds: number;
  accelerator_type: TrainingAcceleratorType;
  accelerator_count: number;
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
  retry_of: number | null;
  deleted_at: string | null;
  is_deleted: boolean;
  registered_model: ModelAPI | null;
  registered_model_id: string | null;
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
  accelerator_type: TrainingAcceleratorType;
  accelerator_count: number;
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

export interface TrainingJobEvent {
  id: number;
  training_job: number;
  event_type: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface TrainingJobEventsResponse {
  events: TrainingJobEvent[];
}

export interface TrainingUsageResponse {
  training_backend: 'sagemaker' | 'local' | 'aws_batch';
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
