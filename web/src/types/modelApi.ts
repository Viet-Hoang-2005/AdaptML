export type ModelAccessMode = 'private' | 'public';
export type ModelAPIStatus = 'ready' | 'uploading' | 'error' | 'disabled';

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

export interface ModelPredictionResponse {
  success: boolean;
  prediction: unknown;
  tenant_id: string;
  model_id: string;
}
