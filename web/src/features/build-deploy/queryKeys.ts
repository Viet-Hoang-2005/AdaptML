export const buildDeployQueryKeys = {
  all: ['build-deploy'] as const,
  builds: () => [...buildDeployQueryKeys.all, 'builds'] as const,
  build: (id: string) => [...buildDeployQueryKeys.builds(), id] as const,
  logs: (id: string) => [...buildDeployQueryKeys.build(id), 'logs'] as const,
  deployments: () => [...buildDeployQueryKeys.all, 'deployments'] as const,
  deployment: (id: string) => [...buildDeployQueryKeys.deployments(), id] as const,
};
