# GitOps and Kustomize

- Argo CD bootstraps repository synchronization and Applications.
- Root `k8s/kustomization.yaml` composes platform directories and the application production overlay.
- `k8s/apps/base` defines shared workloads; `k8s/apps/production` applies production changes.
- Argo CD bootstrap resources under `k8s/argocd` are separate from ordinary root reconciliation unless explicitly referenced.

## Current topology caveats

- Inspect the root entry for the production app overlay; a descriptive suffix/comment embedded as path text may make it invalid.
- `k8s/security/` contains policies but is not currently referenced by the root Kustomization.
- The optional training operators are reconciled by Argo CD child Applications
  beneath the `platform-operators` parent, which Ansible bootstraps after core
  GitOps is healthy. They are intentionally not part of the root application.
- Karpenter NodeClass and NodePool are rendered by Ansible and intentionally
  excluded from GitOps because endpoint, instance profile, token, and user data
  are cluster-specific. Argo ignores only the Karpenter controller runtime
  endpoint/name/queue fields that Ansible injects.
- `k8s/security/` remains intentionally excluded during the current stability
  phase; do not describe its NetworkPolicies or custom PDBs as active.

Do not silently claim an unreferenced manifest is active. Fix ownership/reconciliation explicitly and validate rendered output.

GitOps promotion changes image references/manifests in Git; Argo CD reconciles them. Avoid manual drift except authorized emergency operations with a documented rollback.
