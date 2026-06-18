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
  source_zip: File | null;
  requirements_file: File | null;
  training_data: File | null;
}

export interface TrainingJobDownloadURLResponse {
  download_url: string;
}

export interface TrainingJobLogsResponse {
  training_job_id: number;
  status: TrainingJobStatus;
  logs: string;
}
