import axiosInstance from './axios';
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
  ModelProject,
  Build,
  Deployment,
  ModelVersion,
  ModelBuildFormValues,
  ModelProjectFormValues,
  ModelProjectListResponse,
  ModelEndpointLogsResponse,
  ModelPredictionResponse,
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
} from '../types/models';

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
  const { data } = await axiosInstance.get<UserProfile>('/auth/profile/');
  return data;
};

export const updateProfile = async (payload: UpdateProfileRequest): Promise<MessageResponse> => {
  const { data } = await axiosInstance.put<MessageResponse>('/auth/profile/', payload);
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

  const { data } = await axiosInstance.put<MessageResponse>('/auth/profile/', formData, {
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

export const selectProfileAvatar = async (avatarId: string): Promise<MessageResponse> => {
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
  const { data } = await axiosInstance.post<{ id: string; name: string; description: string; key: string; key_prefix: string; allowed_projects: string[]; created_at: string }>(controlPlaneURL('/api-keys/'), { name: payload.name, description: payload.description, allowed_projects: payload.allowed_models });
  return { message: 'API key created.', api_key: data.key, key_prefix: data.key_prefix, id: data.id, name: data.name, description: data.description, scope: 'specific', allowed_models: data.allowed_projects, created_at: data.created_at };
};

export const listAPIKeys = async (): Promise<APIKeyListResponse> => {
  const { data } = await axiosInstance.get<{ results?: Array<{ id: string; name: string; description: string; key_prefix: string; allowed_projects: string[]; created_at: string }> }>(controlPlaneURL('/api-keys/'));
  return { tenant_id: '', api_keys: (data.results ?? []).map((key) => ({ ...key, scope: 'specific', allowed_models: key.allowed_projects })) };
};

export const updateAPIKey = async (keyId: string, payload: CreateAPIKeyRequest): Promise<APIKeyRecord & MessageResponse> => {
  const { data } = await axiosInstance.put<{ id: string; name: string; description: string; key_prefix: string; allowed_projects: string[]; created_at: string }>(controlPlaneURL(`/api-keys/${keyId}/`), { name: payload.name, description: payload.description, allowed_projects: payload.allowed_models });
  return { ...data, scope: 'specific', allowed_models: data.allowed_projects, message: 'API key updated.' };
};

export const deleteAPIKey = async (keyId: string): Promise<MessageResponse> => {
  await axiosInstance.delete(controlPlaneURL(`/api-keys/${keyId}/`));
  return { message: 'API key revoked.' };
};

export const regenerateAPIKey = async (keyId: string): Promise<CreatedAPIKeyResponse> => {
  const { data } = await axiosInstance.post<{ id: string; name: string; description: string; key: string; key_prefix: string; allowed_projects: string[]; created_at: string }>(controlPlaneURL(`/api-keys/${keyId}/regenerate/`));
  return { message: 'API key regenerated.', api_key: data.key, key_prefix: data.key_prefix, id: data.id, name: data.name, description: data.description, scope: 'specific', allowed_models: data.allowed_projects, created_at: data.created_at };
};

export const listModelProjects = async (): Promise<ModelProjectListResponse> => {
  const { data } = await axiosInstance.get<{ results?: ModelProject[] } | ModelProject[]>(controlPlaneURL('/models/'));
  return { models: Array.isArray(data) ? data : (data.results ?? []) };
};

export const getModelProject = async (modelId: string): Promise<ModelProject> => {
  const { data } = await axiosInstance.get<ModelProject>(controlPlaneURL(`/models/${modelId}/`));
  return data;
};

export const createModelProject = async (payload: ModelProjectFormValues): Promise<ModelProject> => {
  const { data } = await axiosInstance.post<ModelProject>(controlPlaneURL('/models/'), {
    name: payload.name,
    description: payload.description,
    access_mode: payload.access_mode,
  });
  if (payload.source_code_file) await uploadSourceCodeFile(data.id, payload.source_code_file, payload.source_code_file.name);
  if (payload.reference_data_file) await uploadReferenceFile(data.id, payload.reference_data_file, payload.reference_data_file.name);
  if (payload.artifact) {
    const versionData = new FormData();
    versionData.append('version', payload.version || '1');
    versionData.append('source_artifact', payload.artifact);
    await axiosInstance.post(controlPlaneURL(`/registry/models/${data.id}/versions/`), versionData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }
  return data;
};

export const buildModelProject = async (payload: ModelBuildFormValues): Promise<ModelProject> => {
  const { data: project } = await axiosInstance.post<ModelProject>(controlPlaneURL('/models/'), {
    name: payload.name,
    description: payload.description,
    access_mode: payload.access_mode,
    requirements_text: payload.requirements_text,
  });
  if (payload.source_code_file) await uploadSourceCodeFile(project.id, payload.source_code_file, payload.source_code_file.name);
  if (payload.reference_data_file) await uploadReferenceFile(project.id, payload.reference_data_file, payload.reference_data_file.name);
  const versionData = new FormData();
  versionData.append('version', payload.version || '1');
  versionData.append('flavor', payload.flavor);
  if (payload.source_artifact) versionData.append('source_artifact', payload.source_artifact);
  const { data: version } = await axiosInstance.post<ModelVersion>(
    controlPlaneURL(`/registry/models/${project.id}/versions/`),
    versionData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  const { data: build } = await axiosInstance.post<Build>(controlPlaneURL('/builds/'), {
    version: version.id,
  });
  return {
    ...project,
    version: version.version,
    flavor: version.flavor,
    build_id: build.id,
    build_status: build.status,
  };
};

export const deployModelProject = async (modelId: string): Promise<ModelProject> => {
  const project = await getModelProject(modelId);
  const versions = await getProjectVersions(modelId);
  const builds = await listBuilds();
  const versionIds = new Set(versions.map((version) => version.id));
  const build = builds.find((item) => versionIds.has(item.version_id) && item.status === 'ready');
  if (!build) throw new Error('No ready build is available for this project.');
  const { data: deployment } = await axiosInstance.post<Deployment>(controlPlaneURL('/deployments/'), {
    build: build.id,
  });
  return {
    ...project,
    deployment_id: deployment.id,
    status: 'deploying',
    endpoint_status: deployment.status === 'healthy' ? 'healthy' : 'deploying',
  };
};

export const redeployModelProject = async (modelId: string): Promise<ModelProject> => {
  return deployModelProject(modelId);
};

export const stopModelEndpoint = async (modelId: string): Promise<ModelProject> => {
  const project = await getModelProject(modelId);
  const deployments = await listDeployments();
  const versions = await getProjectVersions(modelId);
  const versionIds = new Set(versions.map((version) => version.id));
  const deployment = deployments.find((item) => versionIds.has(item.version_id) && item.status !== 'stopped');
  if (deployment) await axiosInstance.post(controlPlaneURL(`/deployments/${deployment.id}/stop/`));
  return { ...project, status: 'stopped', endpoint_status: 'stopped' };
};

export const checkModelEndpointHealth = async (modelId: string): Promise<ModelProject> => {
  const project = await getModelProject(modelId);
  const { data } = await axiosInstance.get<{ results?: Array<{ version_id: string; public_url: string; health_status: string }> }>(controlPlaneURL('/endpoints/'));
  const versions = await getProjectVersions(modelId);
  const versionIds = new Set(versions.map((version) => version.id));
  const endpoint = (data.results ?? []).find((item) => versionIds.has(item.version_id));
  return { ...project, endpoint_url: endpoint?.public_url ?? '', endpoint_status: endpoint?.health_status === 'healthy' ? 'healthy' : 'unhealthy' };
};

export const getModelEndpointLogs = async (modelId: string): Promise<ModelEndpointLogsResponse> => {
  const versions = await getProjectVersions(modelId);
  const versionIds = new Set(versions.map((version) => version.id));
  const { data: endpointPage } = await axiosInstance.get<
    { results?: Array<{ id: string; version_id: string; runtime_name: string }> }
  >(controlPlaneURL('/endpoints/'));
  const endpoint = (endpointPage.results ?? []).find((item) => versionIds.has(item.version_id));
  if (!endpoint) return { model_id: modelId, container_name: '', logs: '' };
  const { data } = await axiosInstance.get<{ runtime_name: string; logs: string }>(
    controlPlaneURL(`/endpoints/${endpoint.id}/logs/`),
  );
  return { model_id: modelId, container_name: data.runtime_name, logs: data.logs };
};

export const triggerModelProjectBuild = async (modelId: string): Promise<ModelProject> => {
  const project = await getModelProject(modelId);
  const versions = await getProjectVersions(modelId);
  if (!versions[0]) throw new Error('Register a version before building.');
  const { data } = await axiosInstance.post<Build>(controlPlaneURL('/builds/'), { version: versions[0].id });
  return { ...project, build_id: data.id, build_status: data.status };
};

export const updateModelProject = async (modelId: string, payload: ModelProjectFormValues): Promise<ModelProject> => {
  const { data } = await axiosInstance.put<ModelProject>(controlPlaneURL(`/models/${modelId}/`), {
    name: payload.name,
    description: payload.description,
    access_mode: payload.access_mode,
  });
  return data;
};

export const deleteModelProject = async (modelId: string, force: boolean = false): Promise<MessageResponse> => {
  const { data } = await axiosInstance.delete<MessageResponse>(controlPlaneURL(`/models/${modelId}/` + (force ? '?force=true' : '')));
  return data;
};

export const getBuildLogs = async (buildId: string, offset: number): Promise<{logs: string[], next_offset: number, build_status: string, build_error: string}> => {
  const { data } = await axiosInstance.get<{
    logs: string[];
    next_offset: number;
    status: string;
    error_message: string;
  }>(controlPlaneURL(`/builds/${buildId}/logs/`), { params: { offset } });
  return {
    logs: data.logs,
    next_offset: data.next_offset,
    build_status: data.status,
    build_error: data.error_message,
  };
};

export const getDeploymentLogs = async (deploymentId: string, offset: number): Promise<{logs: string[], next_offset: number, build_status: string, build_error: string}> => {
  const { data } = await axiosInstance.get<{
    logs: string[];
    next_offset: number;
    status: string;
    error_message: string;
  }>(controlPlaneURL(`/deployments/${deploymentId}/logs/`), { params: { offset } });
  return {
    logs: data.logs,
    next_offset: data.next_offset,
    build_status: data.status,
    build_error: data.error_message,
  };
};

export const getDriftRunLogs = async (runId: string, offset: number): Promise<{logs: string[], next_offset: number, build_status: string, build_error: string}> => {
  const { data } = await axiosInstance.get<{
    logs: string[];
    next_offset: number;
    status: string;
    error_message: string;
  }>(controlPlaneURL(`/drift-monitors/runs/${runId}/logs/`), { params: { offset } });
  return {
    logs: data.logs,
    next_offset: data.next_offset,
    build_status: data.status,
    build_error: data.error_message,
  };
};

export const cancelBuildAPI = async (modelId: string): Promise<void> => {
  const versions = await getProjectVersions(modelId);
  const builds = await listBuilds();
  const versionIds = new Set(versions.map((version) => version.id));
  const build = builds.find(
    (item) => versionIds.has(item.version_id) && !['ready', 'failed', 'cancelled'].includes(item.status),
  );
  if (build) await axiosInstance.post(controlPlaneURL(`/builds/${build.id}/cancel/`));
};

export const predictWithModelProject = async (
  endpointUrl: string,
  features: Record<string, unknown>,
): Promise<ModelPredictionResponse> => {
  const { data } = await axiosInstance.post<ModelPredictionResponse>(endpointUrl, { features });
  return data;
};

const pageResults = <T>(data: { results?: T[] } | T[]): T[] => (Array.isArray(data) ? data : (data.results ?? []));

export const getProjectVersions = async (projectId: string): Promise<ModelVersion[]> => {
  const { data } = await axiosInstance.get<{ results?: ModelVersion[] } | ModelVersion[]>(
    controlPlaneURL(`/registry/models/${projectId}/versions/`),
  );
  return pageResults(data);
};

export const listBuilds = async (): Promise<Build[]> => {
  const { data } = await axiosInstance.get<{ results?: Build[] } | Build[]>(controlPlaneURL('/builds/'));
  return pageResults(data);
};

export const listDeployments = async (): Promise<Deployment[]> => {
  const { data } = await axiosInstance.get<{ results?: Deployment[] } | Deployment[]>(controlPlaneURL('/deployments/'));
  return pageResults(data);
};

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
  const { data: job } = await axiosInstance.post<TrainingJob>(
    controlPlaneURL('/training-jobs/'),
    trainingJobFormData(payload),
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  const { data } = await axiosInstance.post<TrainingJob>(controlPlaneURL(`/training-jobs/${job.id}/submit/`));
  return data;
};

export const updateModelRequirements = async (modelId: string, requirementsText: string): Promise<ModelProject> => {
  const { data } = await axiosInstance.patch<ModelProject>(
    controlPlaneURL(`/models/${modelId}/requirements/`),
    { requirements_text: requirementsText },
  );
  return data;
};

export const listTrainingJobs = async (includeDeleted = false): Promise<TrainingJobListResponse> => {
  void includeDeleted;
  const { data } = await axiosInstance.get<{ results?: TrainingJob[] } | TrainingJob[]>(controlPlaneURL('/training-jobs/'));
  return { training_jobs: pageResults(data) };
};

export const getTrainingUsage = async (): Promise<TrainingUsageResponse> => {
  const { training_jobs: jobs } = await listTrainingJobs();
  const monthlyRuntime = jobs.reduce((total, job) => total + job.runtime_seconds, 0);
  const trainingBackend = ['argo', 'kubeflow'].includes(jobs[0]?.backend ?? '') ? 'kubeflow' : 'local';
  return { training_backend: trainingBackend, monthly_quota_seconds: 0, monthly_runtime_seconds: monthlyRuntime, remaining_seconds: 0, active_jobs_count: jobs.filter((job) => ['queued', 'running'].includes(job.status)).length, running_jobs_count: jobs.filter((job) => job.status === 'running').length, completed_jobs_count: jobs.filter((job) => job.status === 'completed').length, failed_jobs_count: jobs.filter((job) => job.status === 'failed').length, current_month_start: '', current_month_end: '' };
};

export const getTrainingJob = async (jobId: string): Promise<TrainingJob> => {
  const { data } = await axiosInstance.get<TrainingJob>(controlPlaneURL(`/training-jobs/${jobId}/`));
  return data;
};

export const refreshTrainingJobStatus = async (jobId: string): Promise<TrainingJob> => {
  return getTrainingJob(jobId);
};

export const getTrainingJobDownloadUrl = async (jobId: string): Promise<TrainingJobDownloadURLResponse> => {
  const { data } = await axiosInstance.get<TrainingJobDownloadURLResponse>(
    controlPlaneURL(`/training-jobs/${jobId}/download/`),
  );
  return data;
};

export const registerTrainingJobModel = async (
  jobId: string,
  payload: TrainingJobRegisterModelValues,
): Promise<ModelProject> => {
  const job = await getTrainingJob(jobId);
  const project = await getModelProject(job.project_id);
  await axiosInstance.post(controlPlaneURL(`/registry/models/${job.project_id}/versions/`), {
    version: payload.model_version || '1',
    description: payload.description || '',
    flavor: payload.flavor || '',
    source_job: job.id,
  });
  return project;
};

export const getTrainingJobLogs = async (jobId: string, offset: number = 0): Promise<TrainingJobLogsResponse> => {
  const job = await getTrainingJob(jobId);
  const logs = String(job.tracking?.logs_tail ?? job.error_message ?? '');
  return { job_id: job.id, training_job_id: job.id, status: job.status, logs: logs.slice(offset), text: logs.slice(offset), next_offset: logs.length };
};

export const getTrainingJobMetrics = async (jobId: string): Promise<TrainingJobMetricsResponse> => {
  const job = await getTrainingJob(jobId);
  return { job_id: job.id, training_job_id: job.id, status: job.status, metrics_available: false, latest: null, history: [], log_stream_name: '', message: 'Runtime metrics are not available for this backend.', updated_at: job.updated_at };
};

export const getTrainingJobEvents = async (jobId: string): Promise<TrainingJobEventsResponse> => {
  const { data } = await axiosInstance.get<TrainingJobEventsResponse['events']>(controlPlaneURL(`/training-jobs/${jobId}/events/`));
  return { events: data };
};

export const cancelTrainingJob = async (jobId: string): Promise<TrainingJob> => {
  const { data } = await axiosInstance.post<TrainingJob | { training_job: TrainingJob }>(
    controlPlaneURL(`/training-jobs/${jobId}/cancel/`),
  );
  return 'training_job' in data ? data.training_job : data;
};

export const retryTrainingJob = async (jobId: string): Promise<TrainingJob> => {
  const previous = await getTrainingJob(jobId);
  const { data: job } = await axiosInstance.post<TrainingJob>(controlPlaneURL('/training-jobs/'), {
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
  const { data } = await axiosInstance.post<TrainingJob>(controlPlaneURL(`/training-jobs/${job.id}/submit/`));
  return data;
};

export const deleteTrainingJob = async (jobId: string): Promise<TrainingJob> => {
  const { data } = await axiosInstance.delete<TrainingJob>(controlPlaneURL(`/training-jobs/${jobId}/`));
  return data;
};

export const restoreTrainingJob = async (jobId: string): Promise<TrainingJob> => {
  return getTrainingJob(jobId);
};

export const getRegistryFamilies = async (): Promise<RegistryFamily[]> => {
  const { models } = await listModelProjects();
  return models.map((project) => ({
    id: project.id,
    name: project.name,
    display_name: project.name,
    description: project.description,
    current_production_version: null,
    is_active: project.is_active,
    created_at: project.created_at,
    updated_at: project.updated_at,
  }));
};

const asRegistryVersion = (version: ModelVersion): RegistryVersion => ({
  id: version.id,
  project_id: version.project_id,
  version: version.version,
  source_type: version.source_job_id ? 'training_job' : 'manual_upload',
  source_training_job: version.source_job_id,
  source_training_job_id: version.source_job_id,
  artifact_uri: version.artifacts[0]?.uri ?? '',
  image_name: '',
  endpoint_url: '',
  stage: version.stage,
  metrics_summary: version.metrics_summary,
  params_summary: version.params_summary,
  model_insights_summary: version.insights_summary,
  deployability_status: version.deployability,
  deployability_reason: version.deployability_reason,
  can_build: ['unknown', 'deployable'].includes(version.deployability),
  can_deploy: version.deployability === 'deployable',
  created_at: version.registered_at,
  updated_at: version.registered_at,
});

export const getRegistryVersions = async (familyId: string): Promise<RegistryVersion[]> => {
  return (await getProjectVersions(familyId)).map(asRegistryVersion);
};

export const getRegistryVersion = async (versionId: string): Promise<RegistryVersion> => {
  const { data } = await axiosInstance.get<ModelVersion>(controlPlaneURL(`/registry/versions/${versionId}/`));
  return asRegistryVersion(data);
};

export const getRegistryMetrics = async (
  familyId: string,
  versionId: string,
): Promise<Record<string, RegistryMetric[]>> => {
  void familyId;
  const { data } = await axiosInstance.get<ModelVersion & { metrics?: Array<{ id: string; name: string; value: number; step: number | null; timestamp: string | null; metadata: Record<string, unknown> }> }>(controlPlaneURL(`/registry/versions/${versionId}/`));
  return { metrics: (data.metrics ?? []).map((metric) => ({ id: metric.id, metric_name: metric.name, value: metric.value, step: metric.step ?? 0, source: 'registry', created_at: metric.timestamp ?? data.registered_at, extra: metric.metadata })) };
};

export const getRegistryHistory = async (familyId: string): Promise<RegistryHistory[]> => {
  const versions = await getProjectVersions(familyId);
  return versions.flatMap((version) => ((version as ModelVersion & { events?: Array<{ id: string; event_type: string; from_state: string; to_state: string; created_at: string }> }).events ?? []).map((event) => ({ id: event.id, action: event.event_type, status: 'success', version: version.version, from_stage: event.from_state, to_stage: event.to_state, message: event.event_type, actor: '', created_at: event.created_at })));
};

export const compareRegistryVersions = async (
  familyId: string,
  leftVersionId: string,
  rightVersionId: string,
): Promise<RegistryVersionCompareResponse> => {
  const [left, right] = await Promise.all([getRegistryVersion(leftVersionId), getRegistryVersion(rightVersionId)]);
  const family = (await getRegistryFamilies()).find((item) => item.id === familyId);
  if (!family) throw new Error('Model project not found.');
  return { family, left, right, metrics_diff: [], params_diff: [], artifact_diff: { added: [], removed: [], changed: [], unchanged_count: 0 }, deployability_diff: { left: { status: left.deployability_status ?? 'unknown', reason: left.deployability_reason ?? '' }, right: { status: right.deployability_status ?? 'unknown', reason: right.deployability_reason ?? '' } }, deployment_diff: { left_stage: left.stage, right_stage: right.stage, left_endpoint_url: left.endpoint_url, right_endpoint_url: right.endpoint_url, left_deployed: false, right_deployed: false, left_image_name: left.image_name, right_image_name: right.image_name }, recommendation: { winner: 'unknown', confidence: 'low', reason: 'Compare metrics to choose a version.', warnings: [] } };
};

export const promoteRegistryVersion = async (
  familyId: string,
  versionId: string,
  alias: RoutingAliasName = 'production',
): Promise<PromoteAliasResponse> => {
  await axiosInstance.post(controlPlaneURL(`/registry/models/${familyId}/aliases/`), { name: alias, version: versionId });
  return { success: true, message: `Alias ${alias} now points to the selected version.` };
};

export const predictViaRoutingAlias = async (
  familyId: string,
  alias: RoutingAliasName,
  payload: unknown,
): Promise<unknown> => {
  const { data } = await axiosInstance.post(
    controlPlaneURL(`/registry/models/${familyId}/aliases/${alias}/predict/`),
    payload,
  );
  return data;
};

export const rollbackRegistryFamily = async (familyId: string, versionId: string): Promise<RegistryVersion> => {
  await promoteRegistryVersion(familyId, versionId, 'production');
  return getRegistryVersion(versionId);
};

export const buildRegistryVersionPackage = async (versionId: string): Promise<RegistryVersion> => {
  await axiosInstance.post(controlPlaneURL('/builds/'), { version: versionId });
  return getRegistryVersion(versionId);
};

export const deployRegistryVersion = async (versionId: string): Promise<RegistryVersion> => {
  const build = (await listBuilds()).find((item) => item.version_id === versionId && item.status === 'ready');
  if (!build) throw new Error('No ready build exists for this version.');
  await axiosInstance.post(controlPlaneURL('/deployments/'), { build: build.id });
  return getRegistryVersion(versionId);
};

export const checkRegistryVersionHealth = async (versionId: string): Promise<RegistryVersion> => {
  return getRegistryVersion(versionId);
};

export const smokeTestRegistryVersion = async (
  versionId: string,
  payload: RegistrySmokeTestRequest,
): Promise<RegistrySmokeTestResponse> => {
  const { data } = await axiosInstance.post<RegistrySmokeTestResponse>(
    controlPlaneURL(`/registry/versions/${versionId}/smoke-test/`),
    payload,
  );
  return data;
};

export interface S3File {
  key: string;
  relative_path: string;
  size: number;
  last_modified: string;
  download_url: string;
}

export const listSourceCodeFiles = async (modelIdStr: string): Promise<S3File[]> => {
  const { data } = await axiosInstance.get<Array<{ relative_path: string; size_bytes: number; updated_at: string; download_url: string }>>(controlPlaneURL(`/models/${modelIdStr}/workspace/code/files/`));
  return data.map((file) => ({ key: file.relative_path, relative_path: file.relative_path, size: file.size_bytes, last_modified: file.updated_at, download_url: file.download_url }));
};

export const uploadSourceCodeFile = async (modelIdStr: string, file: File, path: string): Promise<{ message: string }> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('relative_path', path);
  
  const { data } = await axiosInstance.post<{ message: string }>(
    controlPlaneURL(`/models/${modelIdStr}/workspace/code/files/`),
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data;
};

export const deleteSourceCodeFile = async (modelId: string, path: string): Promise<MessageResponse> => {
  const { data } = await axiosInstance.delete<MessageResponse>(
    controlPlaneURL(`/models/${modelId}/workspace/code/files/`),
    { data: { relative_path: path } }
  );
  return data;
};

export const deleteReferenceFile = async (modelId: string, path: string): Promise<MessageResponse> => {
  const { data } = await axiosInstance.delete<MessageResponse>(
    controlPlaneURL(`/models/${modelId}/workspace/data/files/`),
    { data: { relative_path: path } }
  );
  return data;
};

export const listReferenceFiles = async (modelIdStr: string): Promise<S3File[]> => {
  const { data } = await axiosInstance.get<Array<{ relative_path: string; size_bytes: number; updated_at: string; download_url: string }>>(controlPlaneURL(`/models/${modelIdStr}/workspace/data/files/`));
  return data.map((file) => ({ key: file.relative_path, relative_path: file.relative_path, size: file.size_bytes, last_modified: file.updated_at, download_url: file.download_url }));
};

export const uploadReferenceFile = async (modelIdStr: string, file: File, path: string): Promise<{ message: string }> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('relative_path', path);

  const { data } = await axiosInstance.post<{ message: string }>(
    controlPlaneURL(`/models/${modelIdStr}/workspace/data/files/`),
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data;
};
