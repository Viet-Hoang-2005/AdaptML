# Production Kubernetes GitOps

`mlops-paas-system` is the single Argo CD root Application. The root owns
AppProjects, public repository descriptors and explicit child Applications;
each child owns one independently observable service or domain.

## Topology

| Plane | Source | Argo CD project |
| --- | --- | --- |
| GitOps control | `k8s/gitops/production` | `default` |
| Foundation and platform | `k8s/platform` | `mlops-platform` |
| Argo execution | `k8s/execution/argo` | `mlops-execution` |
| Static workloads | `k8s/workloads` | `mlops-workloads` |
| Training operators | `k8s/operators` and pinned Helm charts | `platform-operators` |

Karpenter EC2NodeClass and NodePool resources remain Ansible-owned because they
contain cluster-specific bootstrap, instance-profile and endpoint settings.
Dynamic model Deployments and PyTorchJobs remain lifecycle-owned resources and
are not adopted by Argo CD.

## Foundation

`mlops-prod-foundation` is the only owner of production namespaces declared in
Git and the EBS StorageClass. Operator-created namespaces remain owned by their
operator Application when the upstream manifest creates them.

## Secrets

`mlops-prod-secrets` owns the ClusterSecretStore and every production
ExternalSecret. Secret values stay in AWS Secrets Manager and must never be
committed or printed during debugging.

## Data and platform services

PostgreSQL, Redis, Redpanda, Harbor and MLflow each have an independent
Application. Runtime-default ignore rules are scoped to the Application that
owns the affected resource.

## Execution

`mlops-prod-execution` owns Argo EventBus, EventSource, Sensor,
WorkflowTemplates and their least-privilege RBAC. Resources created by a
Workflow remain runtime-owned.

## Workloads

Control Plane, consumer, model-server and web have separate Kustomizations and
image promotion paths. GitHub Actions changes only the affected workload.

## Edge

`mlops-prod-edge` owns Cloudflare Tunnel configuration, Traefik routes and the
Traefik health endpoint. Public exposure changes require a security review.

## Operators

The existing `platform-*` child names are retained for Kubeflow Training,
Karpenter CRDs/controller, Node Feature Discovery and NVIDIA GPU Operator.
Karpenter runtime endpoint/name/queue values are injected by Ansible and ignored
only at the exact controller environment paths.

## Deferred security resources

`k8s/deferred/security` is intentionally outside every reconciled
Kustomization. Its NetworkPolicies and PDBs are not active controls.

## Validation and debugging

```bash
kubectl kustomize --enable-helm k8s
python3 scripts/validate_gitops_layout.py
kubectl get applications -n argocd -L mlops-paas.io/plane,mlops-paas.io/component
kubectl get application -n argocd <application> -o yaml
```

Debug the smallest unhealthy child first. Check its comparison conditions,
rendered source, events and owned resource health before inspecting the root.
Rollback a manifest through Git; do not delete CRDs, stateful resources or
runtime-created workloads to repair an Application status.
