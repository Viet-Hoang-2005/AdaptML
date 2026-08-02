# GitOps and Kustomize

- Ansible bootstraps repository credentials and the `mlops-paas-system` root Application.
- Root `k8s/kustomization.yaml` renders only the production GitOps control tree after migration.
- Explicit child Applications under `k8s/gitops/production` own service/domain Kustomizations.
- Static workloads live under `k8s/workloads`; platform, execution and operator resources have separate ownership paths.

## Current topology caveats

- `k8s/deferred/security/` contains inactive policies and is intentionally outside every Application source.
- Training operators are child Applications of the unified production root and retain the `platform-*` names.
- Karpenter NodeClass and NodePool are rendered by Ansible and intentionally
  excluded from GitOps because endpoint, instance profile, token, and user data
  are cluster-specific. Argo ignores only the Karpenter controller runtime
  endpoint/name/queue fields that Ansible injects.
- `k8s/deferred/security/` remains intentionally excluded during the current stability
  phase; do not describe its NetworkPolicies or custom PDBs as active.

Do not silently claim an unreferenced manifest is active. Fix ownership/reconciliation explicitly and validate rendered output.

GitOps promotion changes image references/manifests in Git; Argo CD reconciles them. Avoid manual drift except authorized emergency operations with a documented rollback.
