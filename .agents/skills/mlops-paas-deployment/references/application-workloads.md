# Application workloads

The application base contains:

- Control Plane API, Celery worker, Service, ConfigMap, and autoscaling.
- Web frontend.
- Consumer.
- model-server inference gateway.

Dynamic model workers are created by deployment workflows, not a fixed per-model Deployment. Training jobs run in `user-jobs`.

For each workload verify:

- namespace and service account;
- image source/tag/digest;
- ConfigMap versus Secret references;
- probes, ports, resources, and termination behavior;
- selectors/service names;
- autoscaling compatibility;
- no shared secrets in untrusted containers.

The Control Plane is the lifecycle orchestrator. Workers must not independently mutate project/version/deployment truth.
