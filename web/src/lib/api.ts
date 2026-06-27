import axiosInstance from './axios';
import { AxiosError } from 'axios';
import type { ApiErrorResponse } from '../types/api';
import type {
  LoginCredentials,
  SignUpRequest,
  OTPVerifyRequest,
  CompleteRegistrationRequest,
  AuthResponse,
  AvatarHistoryResponse,
  OTPResponse,
  OTPVerifyResponse,
  MessageResponse,
  APIKeyRecord,
  APIKeyListResponse,
  CreateAPIKeyRequest,
  CreatedAPIKeyResponse,
  PasswordChangeVerifyResponse,
  PasswordResetVerifyResponse,
  UpdateProfileAvatarRequest,
  UpdateProfileRequest,
  UserProfile,
} from '../types/auth';
import type {
  ModelAPI,
  ModelBuildFormValues,
  ModelAPIFormValues,
  ModelAPIListResponse,
  ModelEndpointLogsResponse,
  ModelPredictionResponse,
  PackagePreviewResponse,
  TrainingJob,
  TrainingJobDownloadURLResponse,
  TrainingJobEventsResponse,
  TrainingJobFormValues,
  TrainingJobListResponse,
  TrainingJobLogsResponse,
  TrainingJobMetricsResponse,
  TrainingJobRegisterModelValues,
  TrainingUsageResponse,
  RegistryFamily,
  RegistryHistory,
  RegistryMetric,
  RegistrySmokeTestRequest,
  RegistrySmokeTestResponse,
  PromoteAliasResponse,
  RoutingAliasName,
  RegistryVersion,
  RegistryVersionCompareResponse,
} from '../types/modelApi';

const normalizeApiBaseURL = (url: string) => url.replace(/\/+$/, '').replace(/\/auth$/, '');

const apiBaseURL = normalizeApiBaseURL(import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api');
const controlPlaneApiBaseURL = normalizeApiBaseURL(import.meta.env.VITE_CONTROL_PLANE_API_BASE_URL || apiBaseURL);

export const controlPlaneURL = (path: string) => `${controlPlaneApiBaseURL.replace(/\/+$/, '')}${path}`;

// 1. AUTHENTICATION
// Base Auth
export const loginBaseAuth = async (credentials: LoginCredentials): Promise<AuthResponse> => {
  const { data } = await axiosInstance.post<AuthResponse>('/auth/token/', credentials);
  return data;
};

export const requestOTP = async (payload: SignUpRequest): Promise<OTPResponse> => {
  const { data } = await axiosInstance.post<OTPResponse>('/auth/register/request-otp/', payload);
  return data;
};

export const verifyOTP = async (payload: OTPVerifyRequest): Promise<OTPVerifyResponse> => {
  const { data } = await axiosInstance.post<OTPVerifyResponse>('/auth/register/verify-otp/', payload);
  return data;
};

export const completeRegistration = async (payload: CompleteRegistrationRequest): Promise<AuthResponse> => {
  const formData = new FormData();
  formData.append('registration_token', payload.registration_token);
  formData.append('full_name', payload.full_name);
  formData.append('field_of_work', payload.field_of_work);
  formData.append('password', payload.password);

  if (payload.avatar) {
    formData.append('avatar', payload.avatar);
  }

  const { data } = await axiosInstance.post<AuthResponse>('/auth/register/complete/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return data;
};

// OAuth
export const loginGoogle = async (token: string): Promise<AuthResponse> => {
  const { data } = await axiosInstance.post<AuthResponse>('/auth/oauth/google/', { token });
  return data;
};

export const loginGitHub = async (code: string, redirectUri: string): Promise<AuthResponse> => {
  const { data } = await axiosInstance.post<AuthResponse>('/auth/oauth/github/', {
    code,
    redirect_uri: redirectUri,
  });
  return data;
};

// Forgot Password
export const forgotPasswordOTP = async (email: string): Promise<OTPResponse> => {
  const { data } = await axiosInstance.post<OTPResponse>('/auth/password-reset/request-otp/', { email });
  return data;
};

export const verifyForgotPasswordOTP = async (
  email: string,
  otpCode: string,
): Promise<PasswordResetVerifyResponse> => {
  const { data } = await axiosInstance.post<PasswordResetVerifyResponse>('/auth/password-reset/verify-otp/', {
    email,
    otp_code: otpCode,
  });
  return data;
};

export const resetForgottenPassword = async (resetToken: string, newPassword: string): Promise<OTPResponse> => {
  const { data } = await axiosInstance.post<OTPResponse>('/auth/password-reset/complete/', {
    reset_token: resetToken,
    new_password: newPassword,
  });
  return data;
};

// Profile
export const getProfile = async (): Promise<UserProfile> => {
  const { data } = await axiosInstance.get<UserProfile>('/auth/profile/me/');
  return data;
};

export const updateProfile = async (payload: UpdateProfileRequest): Promise<MessageResponse> => {
  const { data } = await axiosInstance.put<MessageResponse>('/auth/profile/me/', payload);
  return data;
};

export const updateProfileAvatar = async (payload: UpdateProfileAvatarRequest): Promise<MessageResponse> => {
  const formData = new FormData();

  if (payload.avatar) {
    formData.append('avatar', payload.avatar);
  }

  if (payload.remove_avatar) {
    formData.append('remove_avatar', 'true');
  }

  const { data } = await axiosInstance.put<MessageResponse>('/auth/profile/me/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return data;
};

export const listProfileAvatars = async (): Promise<AvatarHistoryResponse> => {
  const { data } = await axiosInstance.get<AvatarHistoryResponse>('/auth/profile/avatars/');
  return data;
};

export const selectProfileAvatar = async (avatarId: number): Promise<MessageResponse> => {
  const { data } = await axiosInstance.post<MessageResponse>(`/auth/profile/avatars/${avatarId}/select/`);
  return data;
};

export const deleteAccount = async (): Promise<MessageResponse> => {
  const { data } = await axiosInstance.delete<MessageResponse>('/auth/profile/delete/');
  return data;
};

export const requestPasswordChangeOTP = async (): Promise<MessageResponse> => {
  const { data } = await axiosInstance.post<MessageResponse>('/auth/profile/password-otp/');
  return data;
};

export const verifyPasswordChangeOTP = async (otpCode: string): Promise<PasswordChangeVerifyResponse> => {
  const { data } = await axiosInstance.post<PasswordChangeVerifyResponse>('/auth/profile/password-otp/verify/', {
    otp_code: otpCode,
  });
  return data;
};

export const completePasswordChange = async (
  passwordChangeToken: string,
  newPassword: string,
): Promise<MessageResponse> => {
  const { data } = await axiosInstance.post<MessageResponse>('/auth/profile/change-password/', {
    password_change_token: passwordChangeToken,
    new_password: newPassword,
  });
  return data;
};

export const createAPIKey = async (payload: CreateAPIKeyRequest): Promise<CreatedAPIKeyResponse> => {
  const { data } = await axiosInstance.post<CreatedAPIKeyResponse>('/auth/profile/api-key/', payload);
  return data;
};

export const listAPIKeys = async (): Promise<APIKeyListResponse> => {
  const { data } = await axiosInstance.get<APIKeyListResponse>('/auth/profile/api-key/');
  return data;
};

export const updateAPIKey = async (keyId: number, payload: CreateAPIKeyRequest): Promise<APIKeyRecord & MessageResponse> => {
  const { data } = await axiosInstance.put<APIKeyRecord & MessageResponse>(`/auth/profile/api-key/${keyId}/`, payload);
  return data;
};

export const deleteAPIKey = async (keyId: number): Promise<MessageResponse> => {
  const { data } = await axiosInstance.delete<MessageResponse>(`/auth/profile/api-key/${keyId}/`);
  return data;
};

export const regenerateAPIKey = async (keyId: number): Promise<CreatedAPIKeyResponse> => {
  const { data } = await axiosInstance.post<CreatedAPIKeyResponse>(`/auth/profile/api-key/${keyId}/regenerate/`);
  return data;
};

// Model APIs
const modelFormData = (payload: ModelAPIFormValues) => {
  const formData = new FormData();
  formData.append('name', payload.name);
  formData.append('description', payload.description);
  formData.append('model_info', payload.model_info);
  formData.append('access_mode', payload.access_mode);
  formData.append('version', payload.version || 'v1');
  if (payload.artifact) {
    formData.append('artifact', payload.artifact);
  }
  if (payload.source_code_file) {
    formData.append('source_code_file', payload.source_code_file);
  }
  if (payload.reference_data_file) {
    formData.append('reference_data_file', payload.reference_data_file);
  }
  return formData;
};

const modelBuildFormData = (payload: ModelBuildFormValues) => {
  const formData = new FormData();
  formData.append('name', payload.name);
  formData.append('description', payload.description);
  formData.append('model_info', payload.model_info);
  formData.append('access_mode', payload.access_mode);
  formData.append('version', payload.version || 'v1');
  formData.append('flavor', payload.flavor);
  formData.append('requirements_text', payload.requirements_text);
  if (payload.source_artifact) {
    formData.append('source_artifact', payload.source_artifact);
  }
  if (payload.source_code_file) {
    formData.append('source_code_file', payload.source_code_file);
  }
  if (payload.reference_data_file) {
    formData.append('reference_data_file', payload.reference_data_file);
  }
  if (payload.label_mapping_file) {
    formData.append('label_mapping_file', payload.label_mapping_file);
  }
  if (payload.metrics_file) {
    formData.append('metrics_file', payload.metrics_file);
  }
  if (payload.params_file) {
    formData.append('params_file', payload.params_file);
  }
  if (payload.model_insights_file) {
    formData.append('model_insights_file', payload.model_insights_file);
  }
  if (payload.feature_importance_file) {
    formData.append('feature_importance_file', payload.feature_importance_file);
  }
  if (payload.input_schema_file) {
    formData.append('input_schema_file', payload.input_schema_file);
  }
  if (payload.requirements_file) {
    formData.append('requirements_file', payload.requirements_file);
  }
  return formData;
};

export const listModelAPIs = async (): Promise<ModelAPIListResponse> => {
  const { data } = await axiosInstance.get<ModelAPIListResponse>(controlPlaneURL('/models/'));
  return data;
};

export const getModelAPI = async (modelId: string): Promise<ModelAPI> => {
  const { data } = await axiosInstance.get<ModelAPI>(controlPlaneURL(`/models/${modelId}/`));
  return data;
};

export const createModelAPI = async (payload: ModelAPIFormValues): Promise<ModelAPI> => {
  const { data } = await axiosInstance.post<ModelAPI>(controlPlaneURL('/models/'), modelFormData(payload), {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

export const buildModelAPI = async (payload: ModelBuildFormValues): Promise<ModelAPI> => {
  const { data } = await axiosInstance.post<ModelAPI>(controlPlaneURL('/models/build/'), modelBuildFormData(payload), {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

export const deployModelAPI = async (modelId: string): Promise<ModelAPI> => {
  const { data } = await axiosInstance.post<ModelAPI>(controlPlaneURL(`/models/${modelId}/deploy/`));
  return data;
};

export const redeployModelAPI = async (modelId: string): Promise<ModelAPI> => {
  const { data } = await axiosInstance.post<ModelAPI>(controlPlaneURL(`/models/${modelId}/redeploy/`));
  return data;
};

export const stopModelEndpoint = async (modelId: string): Promise<ModelAPI> => {
  const { data } = await axiosInstance.post<ModelAPI>(controlPlaneURL(`/models/${modelId}/stop-endpoint/`));
  return data;
};

export const checkModelEndpointHealth = async (modelId: string): Promise<ModelAPI> => {
  const { data } = await axiosInstance.post<ModelAPI>(controlPlaneURL(`/models/${modelId}/check-health/`));
  return data;
};

export const getModelEndpointLogs = async (modelId: string): Promise<ModelEndpointLogsResponse> => {
  const { data } = await axiosInstance.get<ModelEndpointLogsResponse>(controlPlaneURL(`/models/${modelId}/endpoint-logs/`));
  return data;
};

export const cleanupModelResources = async (modelId: string, removeImages = false): Promise<{ removed: unknown; model: ModelAPI }> => {
  const { data } = await axiosInstance.post<{ removed: unknown; model: ModelAPI }>(
    controlPlaneURL(`/models/${modelId}/cleanup/`),
    { remove_images: removeImages },
  );
  return data;
};

export const triggerModelAPIBuild = async (modelId: string): Promise<ModelAPI> => {
  const { data } = await axiosInstance.post<ModelAPI>(controlPlaneURL(`/models/${modelId}/build/`));
  return data;
};

export const updateModelAPI = async (modelId: string, payload: ModelAPIFormValues): Promise<ModelAPI> => {
  const { data } = await axiosInstance.put<ModelAPI>(controlPlaneURL(`/models/${modelId}/`), modelFormData(payload), {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

export const deleteModelAPI = async (modelId: string, force: boolean = false): Promise<MessageResponse> => {
  const { data } = await axiosInstance.delete<MessageResponse>(controlPlaneURL(`/models/${modelId}/` + (force ? '?force=true' : '')));
  return data;
};

export const getModelPackagePreview = async (modelId: string): Promise<PackagePreviewResponse> => {
  const { data } = await axiosInstance.get<PackagePreviewResponse>(controlPlaneURL(`/models/${modelId}/package-preview/`));
  return data;
};

export const getBuildLogs = async (modelId: string, offset: number): Promise<{logs: string[], next_offset: number, build_status: string, build_error: string}> => {
  const { data } = await axiosInstance.get(controlPlaneURL(`/models/${modelId}/build-logs/?offset=${offset}`));
  return data;
};

export const cancelBuildAPI = async (modelId: string): Promise<void> => {
  await axiosInstance.post(controlPlaneURL(`/models/${modelId}/cancel-build/`));
};

export const predictWithModelAPI = async (
  endpointUrl: string,
  features: Record<string, unknown>,
): Promise<ModelPredictionResponse> => {
  const { data } = await axiosInstance.post<ModelPredictionResponse>(endpointUrl, { features });
  return data;
};

const trainingJobFormData = (payload: TrainingJobFormValues) => {
  const formData = new FormData();
  formData.append('name', payload.name);
  formData.append('model_version', payload.model_version);
  formData.append('entry_point', payload.entry_point || 'train.py');
  formData.append('vcpu', String(payload.vcpu));
  formData.append('memory', String(payload.memory));
  formData.append('max_runtime_seconds', String(payload.max_runtime_seconds));
  formData.append('accelerator_type', payload.accelerator_type);
  formData.append('accelerator_count', String(payload.accelerator_count));
  if (payload.source_zip) {
    formData.append('source_zip', payload.source_zip);
  }
  if (payload.training_data) {
    formData.append('training_data', payload.training_data);
  }
  if (payload.registered_model_id) {
    formData.append('registered_model_id', payload.registered_model_id);
  }
  return formData;
};

export const createTrainingJob = async (payload: TrainingJobFormValues): Promise<TrainingJob> => {
  const { data } = await axiosInstance.post<TrainingJob>(
    controlPlaneURL('/training/jobs/'),
    trainingJobFormData(payload),
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
};

export const updateModelRequirements = async (modelId: string, requirementsText: string): Promise<ModelAPI> => {
  const { data } = await axiosInstance.patch<ModelAPI>(
    controlPlaneURL(`/models/${modelId}/`),
    { requirements_text: requirementsText },
  );
  return data;
};

export const listTrainingJobs = async (includeDeleted = false): Promise<TrainingJobListResponse> => {
  const { data } = await axiosInstance.get<TrainingJobListResponse>(
    controlPlaneURL(`/training/jobs/${includeDeleted ? '?include_deleted=true' : ''}`),
  );
  return data;
};

export const getTrainingUsage = async (): Promise<TrainingUsageResponse> => {
  const { data } = await axiosInstance.get<TrainingUsageResponse>(controlPlaneURL('/training/usage/'));
  return data;
};

export const getTrainingJob = async (jobId: number): Promise<TrainingJob> => {
  const { data } = await axiosInstance.get<TrainingJob>(controlPlaneURL(`/training/jobs/${jobId}/`));
  return data;
};

export const refreshTrainingJobStatus = async (jobId: number): Promise<TrainingJob> => {
  const { data } = await axiosInstance.post<TrainingJob>(controlPlaneURL(`/training/jobs/${jobId}/refresh-status/`));
  return data;
};

export const getTrainingJobDownloadUrl = async (jobId: number): Promise<TrainingJobDownloadURLResponse> => {
  const { data } = await axiosInstance.get<TrainingJobDownloadURLResponse>(
    controlPlaneURL(`/training/jobs/${jobId}/download-url/`),
  );
  return data;
};

export const registerTrainingJobModel = async (
  jobId: number,
  payload: TrainingJobRegisterModelValues,
): Promise<ModelAPI> => {
  const { data } = await axiosInstance.post<ModelAPI>(controlPlaneURL(`/training/jobs/${jobId}/register-model/`), payload);
  return data;
};

export const getTrainingJobLogs = async (jobId: number): Promise<TrainingJobLogsResponse> => {
  const { data } = await axiosInstance.get<TrainingJobLogsResponse>(controlPlaneURL(`/training/jobs/${jobId}/logs/`));
  return data;
};

export const getTrainingJobMetrics = async (jobId: number): Promise<TrainingJobMetricsResponse> => {
  const { data } = await axiosInstance.get<TrainingJobMetricsResponse>(controlPlaneURL(`/training/jobs/${jobId}/metrics/`));
  return data;
};

export const getTrainingJobEvents = async (jobId: number): Promise<TrainingJobEventsResponse> => {
  const { data } = await axiosInstance.get<TrainingJobEventsResponse>(controlPlaneURL(`/training/jobs/${jobId}/events/`));
  return data;
};

export const cancelTrainingJob = async (jobId: number): Promise<TrainingJob> => {
  const { data } = await axiosInstance.post<TrainingJob | { training_job: TrainingJob }>(
    controlPlaneURL(`/training/jobs/${jobId}/cancel/`),
  );
  return 'training_job' in data ? data.training_job : data;
};

export const retryTrainingJob = async (jobId: number): Promise<TrainingJob> => {
  const { data } = await axiosInstance.post<TrainingJob>(controlPlaneURL(`/training/jobs/${jobId}/retry/`));
  return data;
};

export const deleteTrainingJob = async (jobId: number): Promise<TrainingJob> => {
  const { data } = await axiosInstance.delete<TrainingJob>(controlPlaneURL(`/training/jobs/${jobId}/`));
  return data;
};

export const restoreTrainingJob = async (jobId: number): Promise<TrainingJob> => {
  const { data } = await axiosInstance.post<TrainingJob>(controlPlaneURL(`/training/jobs/${jobId}/restore/`));
  return data;
};

export const getRegistryFamilies = async (): Promise<RegistryFamily[]> => {
  const { data } = await axiosInstance.get<RegistryFamily[]>(controlPlaneURL('/registry/families/'));
  return data;
};

export const getRegistryVersions = async (familyId: number): Promise<RegistryVersion[]> => {
  const { data } = await axiosInstance.get<RegistryVersion[]>(controlPlaneURL(`/registry/families/${familyId}/versions/`));
  return data;
};

export const getRegistryVersion = async (versionId: number): Promise<RegistryVersion> => {
  const { data } = await axiosInstance.get<RegistryVersion>(controlPlaneURL(`/registry/versions/${versionId}/`));
  return data;
};

export const getRegistryMetrics = async (
  familyId: number,
  versionId: number,
): Promise<Record<string, RegistryMetric[]>> => {
  const { data } = await axiosInstance.get<Record<string, RegistryMetric[]>>(
    controlPlaneURL(`/registry/families/${familyId}/versions/${versionId}/metrics/`),
  );
  return data;
};

export const getRegistryHistory = async (familyId: number): Promise<RegistryHistory[]> => {
  const { data } = await axiosInstance.get<RegistryHistory[]>(controlPlaneURL(`/registry/families/${familyId}/history/`));
  return data;
};

export const compareRegistryVersions = async (
  familyId: number,
  leftVersionId: number,
  rightVersionId: number,
): Promise<RegistryVersionCompareResponse> => {
  const { data } = await axiosInstance.get<RegistryVersionCompareResponse>(
    controlPlaneURL(`/registry/families/${familyId}/compare/?left=${leftVersionId}&right=${rightVersionId}`),
  );
  return data;
};

export const promoteRegistryVersion = async (
  familyId: number,
  versionId: number,
  alias: RoutingAliasName = 'production',
): Promise<PromoteAliasResponse> => {
  const { data } = await axiosInstance.post<PromoteAliasResponse>(
    controlPlaneURL(`/registry/families/${familyId}/versions/${versionId}/promote/`),
    { alias },
  );
  return data;
};

export const predictViaRoutingAlias = async (
  familyId: number,
  alias: RoutingAliasName,
  payload: unknown,
): Promise<unknown> => {
  const { data } = await axiosInstance.post(
    controlPlaneURL(`/registry/families/${familyId}/aliases/${alias}/predict/`),
    payload,
  );
  return data;
};

export const rollbackRegistryFamily = async (familyId: number, versionId: number): Promise<RegistryVersion> => {
  const { data } = await axiosInstance.post<RegistryVersion>(
    controlPlaneURL(`/registry/families/${familyId}/rollback/`),
    { version_id: versionId },
  );
  return data;
};

export const buildRegistryVersionPackage = async (versionId: number): Promise<RegistryVersion> => {
  const { data } = await axiosInstance.post<RegistryVersion>(
    controlPlaneURL(`/registry/versions/${versionId}/build-package/`),
  );
  return data;
};

export const deployRegistryVersion = async (versionId: number): Promise<RegistryVersion> => {
  const { data } = await axiosInstance.post<RegistryVersion>(
    controlPlaneURL(`/registry/versions/${versionId}/deploy/`),
  );
  return data;
};

export const checkRegistryVersionHealth = async (versionId: number): Promise<RegistryVersion> => {
  const { data } = await axiosInstance.post<RegistryVersion>(
    controlPlaneURL(`/registry/versions/${versionId}/check-health/`),
  );
  return data;
};

export const smokeTestRegistryVersion = async (
  versionId: number,
  payload: RegistrySmokeTestRequest,
): Promise<RegistrySmokeTestResponse> => {
  const { data } = await axiosInstance.post<RegistrySmokeTestResponse>(
    controlPlaneURL(`/registry/versions/${versionId}/smoke-test/`),
    payload,
  );
  return data;
};

export function getApiErrorMessage(e: unknown, defaultMessage = 'An unexpected error occurred'): string {
  const axiosError = e as AxiosError<ApiErrorResponse>;
  return axiosError.response?.data?.error 
      || axiosError.response?.data?.message 
      || axiosError.message 
      || defaultMessage;
}

export interface S3File {
  key: string;
  relative_path: string;
  size: number;
  last_modified: string;
  download_url: string;
}

export const listSourceCodeFiles = async (modelIdStr: string): Promise<S3File[]> => {
  const { data } = await axiosInstance.get<S3File[]>(controlPlaneURL(`/models/${modelIdStr}/source-code-files/`));
  return data;
};

export const uploadSourceCodeFile = async (modelIdStr: string, file: File, path: string): Promise<{ message: string }> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', path);
  
  const { data } = await axiosInstance.put<{ message: string }>(
    controlPlaneURL(`/models/${modelIdStr}/source-code-upload/`),
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data;
};

export const deleteSourceCodeFile = async (modelId: string, path: string): Promise<MessageResponse> => {
  const { data } = await axiosInstance.delete<MessageResponse>(
    controlPlaneURL(`/models/${modelId}/source-code-upload/`),
    { data: { path } }
  );
  return data;
};

export const deleteReferenceFile = async (modelId: string, path: string): Promise<MessageResponse> => {
  const { data } = await axiosInstance.delete<MessageResponse>(
    controlPlaneURL(`/drift/models/${modelId}/reference-data/`),
    { data: { path } }
  );
  return data;
};

export const listReferenceFiles = async (modelIdStr: string): Promise<S3File[]> => {
  const { data } = await axiosInstance.get<S3File[]>(controlPlaneURL(`/drift/models/${modelIdStr}/reference-files/`));
  return data;
};

export const uploadReferenceFile = async (modelIdStr: string, file: File, path: string): Promise<{ message: string }> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', path);

  const { data } = await axiosInstance.post<{ message: string }>(
    controlPlaneURL(`/drift/models/${modelIdStr}/reference-data/`),
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data;
};
