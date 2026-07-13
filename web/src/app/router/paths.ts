export const routes = {
  login: '/login',
  dashboard: '/dashboard',
  overview: '/dashboard/home/models',
  modelTesting: '/dashboard/home/model-testing',
  buildDeploy: '/dashboard/api-management',
  uploadModel: '/dashboard/api-management/upload/build-package',
  training: '/dashboard/model-training',
  registry: '/dashboard/model-evolution',
  monitoring: '/dashboard/drift-monitoring',
  notifications: '/dashboard/notifications',
  profile: '/dashboard/settings/profile',
  developerSettings: '/dashboard/settings/developer',
} as const;

export const projectRoute = (base: string, projectId: string) => `${base}/${projectId}`;
