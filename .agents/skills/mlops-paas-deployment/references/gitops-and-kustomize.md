# GitOps and Kustomize

- Ansible installs Argo CD and bootstraps the public `mlops-paas-system` root Application; no Git credential is required while the repository remains public.
- Root `k8s/kustomization.yaml` renders only the production GitOps control tree after migration.
- Explicit child Applications under `k8s/gitops/production` own service/domain Kustomizations.
- Static workload manifests live under `k8s/apps/base`; Argo CD reconciles only environment overlays such as `k8s/apps/overlays/production`. Infrastructure, Argo execution and operator resources have separate ownership paths.

## Current topology caveats

- `k8s/security/` contains inactive broad policies and is intentionally outside every Application source. The targeted EventSource/EventBus NetworkPolicies in `k8s/argo` are active execution resources.
- Core and training operators are pinned Helm/Git child Applications of the unified production root and retain `platform-*` names.
- `platform-karpenter-capacity` owns CPU/GPU EC2NodeClasses and NodePools. Git
  contains stable non-secret identifiers and the private K3s API DNS name;
  Terraform owns AWS primitives and Ansible publishes only the token value.
- `k8s/security/` remains intentionally excluded during the current stability
  phase; do not describe its NetworkPolicies or custom PDBs as active. Do not
  extend that statement to the reconciled policies under `k8s/argo`.

Do not silently claim an unreferenced manifest is active. Fix ownership/reconciliation explicitly and validate rendered output.

GitOps promotion changes image references/manifests in Git; Argo CD reconciles them. Avoid manual drift except authorized emergency operations with a documented rollback.
