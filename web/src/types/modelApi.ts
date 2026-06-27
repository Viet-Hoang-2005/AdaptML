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
  metrics_summary?: Record<string, unknown>;
  params_summary?: Record<string, unknown>;
  model_insights_summary?: RegistryModelInsightsSummary;
  has_model_insights?: boolean;
  metadata_warnings?: string[];
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
  metrics_file?: File | null;
  params_file?: File | null;
  model_insights_file?: File | null;
  feature_importance_file?: File | null;
  input_schema_file?: File | null;
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

export type RegistryStage = 'none' | 'candidate' | 'staging' | 'production' | 'archived';
export type RegistrySourceType = 'manual_upload' | 'training_job' | 'imported';
export type RegistryHistoryStatus = 'success' | 'failed' | 'running';
export type RegistryDeployabilityStatus = 'unknown' | 'deployable' | 'track_only' | 'invalid';

export interface RegistryArtifactManifestItem {
  path: string;
  size_bytes?: number;
  sha256?: string;
  kind?: 'model' | 'checkpoint' | 'metadata' | 'log' | 'other' | string;
}

export interface RegistryModelInsightItem {
  name: string;
  value: number;
  abs_value?: number;
  class_name?: string;
  rank?: number;
}

export interface RegistryModelInsightsSummary {
  schema_version?: string;
  kind?: 'feature_importance' | 'coefficients' | string;
  source?: string;
  feature_count?: number;
  items?: RegistryModelInsightItem[];
}

export type DriftSummaryStatus = 'not_configured' | 'healthy' | 'drift_detected' | 'report_unavailable' | 'unknown';

export interface DriftSummary {
  configured: boolean;
  status: DriftSummaryStatus;
  drift_percent: number | null;
  driftPercent?: number | null;
  drift_score: number | null;
  driftScore?: number | null;
  dataset_drift: boolean | null;
  datasetDrift?: boolean | null;
  latest_result_id: number | null;
  latestResultId?: number | null;
  drift_job_id: number | null;
  driftJobId?: number | null;
  report_url: string | null;
  reportUrl?: string | null;
  report_page_url: string;
  reportPageUrl?: string;
  last_checked_at: string | null;
  lastCheckedAt?: string | null;
  drifted_features_count: number | null;
  driftedFeaturesCount?: number | null;
  total_features: number | null;
  totalFeatures?: number | null;
  message: string;
}

export interface RegistryVersion {
  id: number;
  tenant?: number | string;
  family?: number;
  version: string;
  model_api?: string | number | null;
  source_training_job?: number | null;
  source_training_job_id?: number | null;
  source_training_job_name?: string;
  source_training_job_status?: string;
  source_training_job_backend?: string;
  source_type: RegistrySourceType;
  artifact_uri: string;
  image_name: string;
  endpoint_url: string;
  stage: RegistryStage;
  training_summary?: Record<string, unknown>;
  metrics_summary?: Record<string, unknown>;
  metricsSummary?: Record<string, unknown>;
  params_summary?: Record<string, unknown>;
  paramsSummary?: Record<string, unknown>;
  model_insights_summary?: RegistryModelInsightsSummary;
  modelInsightsSummary?: RegistryModelInsightsSummary;
  has_model_insights?: boolean;
  hasModelInsights?: boolean;
  model_insights_kind?: string;
  modelInsightsKind?: string;
  model_insights_item_count?: number;
  modelInsightsItemCount?: number;
  artifact_manifest?: RegistryArtifactManifestItem[];
  artifactManifest?: RegistryArtifactManifestItem[];
  tracking_status?: string;
  tracking_error?: string;
  tracking_ingested_at?: string | null;
  deployability_status?: RegistryDeployabilityStatus;
  deployability_reason?: string;
  primary_metrics?: Record<string, number>;
  can_build?: boolean;
  can_deploy?: boolean;
  build_disabled_reason?: string;
  deploy_disabled_reason?: string;
  build_status?: string;
  build_error?: string;
  deployment_status?: string;
  endpoint_status?: string;
  endpoint_error?: string;
  endpoint_last_checked_at?: string | null;
  message?: string;
  reason_code?: string;
  technical_detail?: string;
  health?: Record<string, unknown>;
  mlflow_run_id?: string | null;
  mlflow_experiment_id?: string | null;
  mlflow_run_url?: string | null;
  mlflow_model_uri?: string | null;
  mlflow_artifact_uri?: string | null;
  created_at: string;
  updated_at: string;
  drift_summary?: DriftSummary;
  driftSummary?: DriftSummary;
}

export interface RegistrySmokeTestRequest {
  features: Record<string, unknown>;
}

export interface RegistrySmokeTestResponse {
  success: boolean;
  endpoint_url: string;
  status?: string;
  reason_code?: string;
  message?: string;
  technical_detail?: string;
  prediction?: unknown;
  confidence?: number | null;
  latency_ms?: number;
  status_code?: number;
  response?: unknown;
  error?: string;
}

export interface RegistryMetricDiff {
  name: string;
  left: unknown;
  right: unknown;
  delta: number | null;
  delta_percent: number | null;
  higher_is_better: boolean | null;
  winner: 'left' | 'right' | 'tie' | 'unknown';
}

export interface RegistryParamDiff {
  name: string;
  left: unknown;
  right: unknown;
  changed: boolean;
  only_in?: 'left' | 'right' | '';
}

export interface RegistryArtifactDiff {
  added: RegistryArtifactManifestItem[];
  removed: RegistryArtifactManifestItem[];
  changed: Array<{
    path: string;
    left_size_bytes?: number;
    right_size_bytes?: number;
    left_sha256?: string;
    right_sha256?: string;
    left_kind?: string;
    right_kind?: string;
  }>;
  unchanged_count: number;
}

export interface RegistryVersionCompareResponse {
  family: Pick<RegistryFamily, 'id' | 'name' | 'display_name'>;
  left: Partial<RegistryVersion> & Pick<RegistryVersion, 'id' | 'version' | 'stage'>;
  right: Partial<RegistryVersion> & Pick<RegistryVersion, 'id' | 'version' | 'stage'>;
  metrics_diff: RegistryMetricDiff[];
  params_diff: RegistryParamDiff[];
  artifact_diff: RegistryArtifactDiff;
  deployability_diff: {
    left: { status: string; reason: string };
    right: { status: string; reason: string };
  };
  deployment_diff: {
    left_stage: string;
    right_stage: string;
    left_endpoint_url: string;
    right_endpoint_url: string;
    left_deployed: boolean;
    right_deployed: boolean;
    left_image_name: string;
    right_image_name: string;
  };
  recommendation: {
    winner: 'left' | 'right' | 'unknown';
    confidence: 'low' | 'medium' | 'high';
    reason: string;
    warnings: string[];
  };
}

export interface RegistryFamily {
  id: number;
  tenant?: number | string;
  name: string;
  display_name: string;
  description: string;
  current_production_version: RegistryVersion | null;
  version_count?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RegistryMetric {
  id: number;
  metric_name: string;
  value: number;
  step: number;
  source: string;
  created_at: string;
  extra?: Record<string, unknown>;
}

export interface RegistryHistory {
  id: number;
  action: string;
  status: RegistryHistoryStatus;
  version: string;
  from_stage: string;
  to_stage: string;
  message: string;
  actor: string;
  created_at: string;
  extra?: Record<string, unknown>;
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
  training_data: File | null;
  registered_model_id?: string;
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
