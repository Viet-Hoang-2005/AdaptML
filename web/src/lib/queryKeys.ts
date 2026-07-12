export const queryKeys = {
  profile: ['profile'] as const,
  profileAvatars: ['profile-avatars'] as const,
  apiKeys: ['api-keys'] as const,
  modelProjects: ['model-projects'] as const,
  modelProject: (id: string) => ['model-projects', 'detail', id] as const,
  modelBuildLogs: (id: string) => ['model-projects', 'build-logs', id] as const,
  modelEndpointLogs: (id: string) => ['model-projects', 'endpoint-logs', id] as const,
  // Keep trainingJobs as a plain array for backward compatibility with existing pages.
  // The hook uses trainingJob(id) for fine-grained per-job cache updates.
  trainingJobs: ['training-jobs'] as const,
  trainingJob: (id: number) => ['training-jobs', 'detail', id] as const,
  trainingJobLogs: (id: number) => ['training-jobs', 'logs', id] as const,
  trainingJobMetrics: (id: number) => ['training-jobs', 'metrics', id] as const,
  trainingJobEvents: (id: number) => ['training-jobs', 'events', id] as const,
  trainingUsage: ['training-usage'] as const,
};
