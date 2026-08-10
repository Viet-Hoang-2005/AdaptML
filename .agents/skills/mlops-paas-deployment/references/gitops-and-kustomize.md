# GitOps and Kustomize

- Ansible installs Argo CD and bootstraps the public `mlops-paas-system` root Application; no Git credential is required while the repository remains public.
- Root `k8s/kustomization.yaml` renders only the production GitOps control tree after migration.
- The root Application directly owns production namespaces from
  `k8s/gitops/production/cluster` at wave `-40`; `mlops-prod-storage` owns only
  the EBS StorageClass from `k8s/infra/storage` at wave `-30`.
- Explicit child Applications under `k8s/gitops/production` own service/domain Kustomizations.
- Static workload manifests live under `k8s/apps/base`; Argo CD reconciles only environment overlays such as `k8s/apps/overlays/production`. Infrastructure, Argo execution and operator resources have separate ownership paths.
- `mlops-prod-secrets` owns only `ClusterSecretStore`. Each workload, infrastructure domain and execution source owns its colocated `ExternalSecret` and the narrowly scoped Kubernetes target Secret it consumes; AWS Secrets Manager remains the shared value source.

## Current topology caveats

- `k8s/security/` contains inactive broad policies and is intentionally outside every Application source. The targeted EventSource/EventBus NetworkPolicies in `k8s/argo` are active execution resources.
- Core and training operators are pinned Helm/Git child Applications of the unified production root and retain `platform-*` names.
- `platform-kyverno` and `platform-image-verification` enforce keyless Cosign verification only for `registry.mlops-nids-nt114.id.vn/mlops-paas/*`. The policy identity is the repository's `cd.yml` workflow on `main`; tenant `user-images/*` remain outside the policy until their build path can sign independently.
- `platform-karpenter-capacity` owns CPU/GPU EC2NodeClasses and NodePools. Git
  contains stable non-secret identifiers and the private K3s API DNS name;
  Terraform owns AWS primitives and Ansible publishes only the token value.
- `k8s/security/` remains intentionally excluded during the current stability
  phase; do not describe its NetworkPolicies or custom PDBs as active. Do not
  extend that statement to the reconciled policies under `k8s/argo`.

Do not silently claim an unreferenced manifest is active. Fix ownership/reconciliation explicitly and validate rendered output.

GitOps promotion changes image references/manifests in Git; Argo CD reconciles them. Avoid manual drift except authorized emergency operations with a documented rollback.
