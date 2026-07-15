import { apiClient } from '@/shared/api/client';
import { controlPlaneURL } from '@/shared/api/config';
import { pageResults } from '@/shared/api/pagination';
import {
  getModelProject,
  uploadReferenceFile,
  uploadSourceCodeFile,
} from '@/features/catalog/api/catalogApi';
import type {
  Build,
  Deployment,
  ModelBuildFormValues,
  ModelBuildMetadata,
  ModelProject,
  ModelVersion,
} from '@/features/catalog/types';

const metadataFormData = (payload: ModelBuildFormValues): FormData => {
  const data = new FormData();
  data.append('name', payload.name);
  data.append('description', payload.description);
  data.append('access_mode', payload.access_mode);
  data.append('flavor', payload.flavor);
  data.append('artifact_format', payload.artifact_format);
  data.append('requirements_text', payload.requirements_text);
  const files: Array<[string, File | null | undefined]> = [
    ['source_artifact', payload.source_artifact],
    ['label_mapping_file', payload.label_mapping_file],
    ['metrics_file', payload.metrics_file],
    ['params_file', payload.params_file],
    ['model_insights_file', payload.model_insights_file],
    ['feature_importance_file', payload.feature_importance_file],
    ['input_schema_file', payload.input_schema_file],
    ['source_code_file', payload.source_code_file],
    ['reference_data_file', payload.reference_data_file],
  ];
  files.forEach(([name, file]) => {
    if (file) data.append(name, file);
  });
  return data;
};

export const createModelDraft = async (payload: ModelBuildFormValues): Promise<ModelBuildMetadata> =>
  (await apiClient.post<ModelBuildMetadata>(
    controlPlaneURL('/models/drafts/'),
    metadataFormData(payload),
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )).data;

export const getModelBuildMetadata = async (modelId: string): Promise<ModelBuildMetadata> =>
  (await apiClient.get<ModelBuildMetadata>(controlPlaneURL(`/models/${modelId}/build-metadata/`))).data;

export const updateModelBuildMetadata = async (
  modelId: string,
  payload: ModelBuildFormValues,
): Promise<ModelBuildMetadata> =>
  (await apiClient.put<ModelBuildMetadata>(
    controlPlaneURL(`/models/${modelId}/build-metadata/`),
    metadataFormData(payload),
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )).data;

export const startProjectBuild = async (modelId: string): Promise<Build> =>
  (await apiClient.post<Build>(controlPlaneURL(`/models/${modelId}/builds/`))).data;

export const getBuild = async (buildId: string): Promise<Build> =>
  (await apiClient.get<Build>(controlPlaneURL(`/builds/${buildId}/`))).data;

export const getLatestProjectBuild = async (modelId: string): Promise<Build | null> => {
  const [versions, builds] = await Promise.all([getProjectVersions(modelId), listBuilds()]);
  const versionIds = new Set(versions.map((version) => version.id));
  return builds.find((build) => versionIds.has(build.version_id)) ?? null;
};

export const saveBuildImage = async (buildId: string): Promise<Build> =>
  (await apiClient.post<Build>(controlPlaneURL(`/builds/${buildId}/save/`))).data;

export const deployBuild = async (buildId: string): Promise<Deployment> =>
  (await apiClient.post<Deployment>(controlPlaneURL('/deployments/'), { build: buildId })).data;

export const getProjectVersions = async (projectId: string): Promise<ModelVersion[]> => {
  const { data } = await apiClient.get<{ results: ModelVersion[] } | ModelVersion[]>(
    controlPlaneURL(`/registry/models/${projectId}/versions/`),
  );
  return pageResults(data);
};

export const listBuilds = async (): Promise<Build[]> => {
  const { data } = await apiClient.get<{ results: Build[] } | Build[]>(controlPlaneURL('/builds/'));
  return pageResults(data);
};

export const listDeployments = async (): Promise<Deployment[]> => {
  const { data } = await apiClient.get<{ results: Deployment[] } | Deployment[]>(controlPlaneURL('/deployments/'));
  return pageResults(data);
};

export const buildModelProject = async (payload: ModelBuildFormValues): Promise<ModelProject> => {
  const { data: project } = await apiClient.post<ModelProject>(controlPlaneURL('/models/'), {
    name: payload.name,
    description: payload.description,
    access_mode: payload.access_mode,
    requirements_text: payload.requirements_text,
  });
  if (payload.source_code_file) {
    await uploadSourceCodeFile(project.id, payload.source_code_file, payload.source_code_file.name);
  }
  if (payload.reference_data_file) {
    await uploadReferenceFile(project.id, payload.reference_data_file, payload.reference_data_file.name);
  }
  const versionData = new FormData();
  versionData.append('version', payload.version || '1');
  versionData.append('flavor', payload.flavor);
  if (payload.source_artifact) versionData.append('source_artifact', payload.source_artifact);
  const { data: version } = await apiClient.post<ModelVersion>(
    controlPlaneURL(`/registry/models/${project.id}/versions/`),
    versionData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  const { data: build } = await apiClient.post<Build>(controlPlaneURL('/builds/'), { version: version.id });
  return { ...project, version: version.version, flavor: version.flavor, build_id: build.id, build_status: build.status };
};

export const deployModelProject = async (modelId: string): Promise<ModelProject> => {
  const [project, versions, builds] = await Promise.all([
    getModelProject(modelId),
    getProjectVersions(modelId),
    listBuilds(),
  ]);
  const versionIds = new Set(versions.map((version) => version.id));
  const build = builds.find((item) => versionIds.has(item.version_id) && item.status === 'ready');
  if (!build) throw new Error('No ready build is available for this project.');
  const { data: deployment } = await apiClient.post<Deployment>(controlPlaneURL('/deployments/'), { build: build.id });
  return {
    ...project,
    deployment_id: deployment.id,
    status: 'deploying',
    endpoint_status: deployment.status === 'healthy' ? 'healthy' : 'deploying',
  };
};

export const redeployModelProject = deployModelProject;

export const stopModelEndpoint = async (modelId: string): Promise<ModelProject> => {
  const [project, deployments, versions] = await Promise.all([
    getModelProject(modelId),
    listDeployments(),
    getProjectVersions(modelId),
  ]);
  const versionIds = new Set(versions.map((version) => version.id));
  const deployment = deployments.find((item) => versionIds.has(item.version_id) && item.status !== 'stopped');
  if (deployment) await apiClient.post(controlPlaneURL(`/deployments/${deployment.id}/stop/`));
  return { ...project, status: 'stopped', endpoint_status: 'stopped' };
};

export const checkModelEndpointHealth = async (modelId: string): Promise<ModelProject> => {
  const [project, versions] = await Promise.all([getModelProject(modelId), getProjectVersions(modelId)]);
  const { data } = await apiClient.get<{
    results?: Array<{ version_id: string; public_url: string; health_status: string }>;
  }>(controlPlaneURL('/endpoints/'));
  const versionIds = new Set(versions.map((version) => version.id));
  const endpoint = (data.results ?? []).find((item) => versionIds.has(item.version_id));
  return {
    ...project,
    endpoint_url: endpoint?.public_url ?? '',
    endpoint_status: endpoint?.health_status === 'healthy' ? 'healthy' : 'unhealthy',
  };
};

export const triggerModelProjectBuild = async (modelId: string): Promise<ModelProject> => {
  const [project, versions] = await Promise.all([getModelProject(modelId), getProjectVersions(modelId)]);
  if (!versions[0]) throw new Error('Register a version before building.');
  const { data } = await apiClient.post<Build>(controlPlaneURL('/builds/'), { version: versions[0].id });
  return { ...project, build_id: data.id, build_status: data.status };
};

export const cancelBuild = async (modelId: string): Promise<void> => {
  const [versions, builds] = await Promise.all([getProjectVersions(modelId), listBuilds()]);
  const versionIds = new Set(versions.map((version) => version.id));
  const build = builds.find(
    (item) => versionIds.has(item.version_id) && !['ready', 'failed', 'cancelled'].includes(item.status),
  );
  if (build) await apiClient.post(controlPlaneURL(`/builds/${build.id}/cancel/`));
};
