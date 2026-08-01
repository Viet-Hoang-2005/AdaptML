# Argo execution

WorkflowTemplates and Argo Events cover:

- Build/package.
- Deploy model worker.
- Delete runtime.
- Evidently drift execution.
- Training submission.
- Training cancellation.

The event source/sensor receives trusted Control Plane requests and submits the correct template. Resource UUIDs, callback URLs, image/storage inputs, and idempotency must survive the hop.

Training uses `user-jobs` and Kubeflow Training Operator. Use dedicated service accounts, disable token automount where possible, and keep tenant code isolated.

Cancellation/delete templates must be idempotent (`ignore-not-found` behavior), wait for runtime termination where required, and report through the correct scoped callback. Never allow a tenant container to authoritatively claim terminal success.
