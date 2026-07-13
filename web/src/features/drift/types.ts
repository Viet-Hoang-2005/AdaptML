import type { ResourceId } from '@/shared/types';

export interface DriftMonitoringResult {
  id: ResourceId;
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
  id: ResourceId;
  project_id: ResourceId;
  version_id: ResourceId;
  reference_asset_id: ResourceId;
  trigger_threshold: number;
  reference_data_s3_path: string;
  status: string;
  runs: DriftMonitoringResult[];
  created_at: string;
  updated_at: string;
}

export interface WorkspaceDataFile {
  id: ResourceId;
  relative_path: string;
  s3_uri: string;
  download_url: string;
  size_bytes: number;
  updated_at: string;
}

export interface DriftMonitorInput {
  model_id: ResourceId;
  trigger_threshold: number;
  reference_data_s3_path: string;
}
