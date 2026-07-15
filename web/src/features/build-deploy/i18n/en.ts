export const buildDeployEn = {
  title: 'Management', search: 'Search model by name...', upload: 'Upload model', noModels: 'No models found',
  loading: 'Loading models...', noDescription: 'No description provided.',
  noModelsDescription: 'Upload your first MLflow model package to create a prediction endpoint.', noMatch: 'No models matching "{{query}}"',
  columns: { index: '#', name: 'Name', description: 'Description', flavor: 'Flavor', access: 'Access', status: 'Status', updated: 'Updated', actions: 'Action' },
  status: { metadata: 'metadata only', imageReady: 'image ready', deployed: 'deployed' },
  buildLogs: 'Build Console', deploymentLogs: 'Deployment Console', deleteTitle: 'Delete model API',
  deleteDescription: 'Delete {{name}}? This action cannot be undone.', deleteConfirm: 'Delete model',
  lifecycle: {
    registered: 'Registered', buildReady: 'Build Ready', deployed: 'Deployed', healthy: 'Healthy',
    logsDeprecated: 'Realtime Pod Log Streaming Deprecated', prometheus: 'Prometheus Powered',
    logsDescription: 'Live WebSocket container log streaming is no longer supported in our production Kubernetes environment. To ensure zero network overhead and enterprise-grade multi-tenant isolation, container health checks, hardware metrics (CPU/RAM/Network Bandwidth), and traffic statistics are now directly monitored via the Prometheus Observability Engine.',
    logsHint: 'Navigate to the Observability or Metrics tab to inspect real-time serving performance.',
    buildLogs: 'Build Process Logs', waitingLogs: 'Waiting for build logs...', newLogs: 'New logs',
  },
} as const;
