# Production Kubernetes GitOps

`mlops-paas-system` is the single Argo CD root Application. The root owns
AppProjects, public repository descriptors and explicit child Applications;
each child owns one independently observable service or domain.

## Topology

| Plane | Source | Argo CD project |
| --- | --- | --- |
| GitOps control | `k8s/gitops/production` | `default` |
| Foundation and platform | `k8s/infra` | `mlops-platform` |
| Argo execution | `k8s/argo` | `mlops-execution` |
| Static workloads | `k8s/apps/overlays/production` | `mlops-workloads` |
| Core and training operators | Pinned Git/Helm sources | `platform-operators` |

`platform-karpenter-capacity` owns the production CPU/GPU EC2NodeClasses and
NodePools. Their non-secret cluster identifiers and stable private K3s API DNS
are declared in Git; the K3s join-token value remains in Secrets Manager.
Dynamic model Deployments and PyTorchJobs remain lifecycle-owned resources and
are not adopted by Argo CD.

## Foundation

`mlops-prod-foundation` is the only owner of production namespaces declared in
Git and the EBS StorageClass. Upstream operator namespace manifests are removed
from their rendered sources so namespace ownership stays with foundation.

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

Control Plane, consumer, model-server and web share environment-neutral manifests
under `k8s/apps/base`. Each service has an independent production overlay
under `k8s/apps/overlays/production`; these overlays are the only workload
paths reconciled by Argo CD. GitHub Actions changes only the affected production
overlay and keeps promotion on Git SHA tags during the current phase.

The base image references contain only logical image names and are not deployable
targets. Add future `dev` or `staging` overlays beside `production` rather than
putting environment-specific registry names, tags, ConfigMaps or patches in base.

## Edge

`mlops-prod-edge` owns Cloudflare Tunnel configuration, Traefik routes and the
Traefik health endpoint. Public exposure changes require a security review.

## Operators

Argo CD owns seven core Helm releases: AWS EBS CSI, External Secrets,
CloudNativePG, KEDA, Argo Workflows, Argo Events and kube-prometheus-stack. It
also retains the existing `platform-*` children for Kubeflow Training,
Karpenter CRDs/controller/capacity, Node Feature Discovery and NVIDIA GPU
Operator. Ansible owns only K3s, token publication and the Argo CD bootstrap;
there are no ignored or runtime-patched Karpenter controller fields.

## Deferred security resources

`k8s/security` is intentionally outside every reconciled
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

Orphan warnings stay enabled. AppProjects ignore only accepted runtime resources
created by CloudNativePG, Kubernetes and Argo Workflows. Monitoring resources
are owned directly by `platform-monitoring`; a new orphan outside the accepted
identities remains visible as an `OrphanedResourceWarning`.
