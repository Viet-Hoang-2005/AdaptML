# GitOps and Kustomize

- Argo CD bootstraps repository synchronization and Applications.
- Root `k8s/kustomization.yaml` composes platform directories and the application production overlay.
- `k8s/apps/base` defines shared workloads; `k8s/apps/production` applies production changes.
- Argo CD bootstrap resources under `k8s/argocd` are separate from ordinary root reconciliation unless explicitly referenced.

## Current topology caveats

- Inspect the root entry for the production app overlay; a descriptive suffix/comment embedded as path text may make it invalid.
- `k8s/security/` contains policies but is not currently referenced by the root Kustomization.
- Several operators are installed by Ansible rather than root GitOps.

Do not silently claim an unreferenced manifest is active. Fix ownership/reconciliation explicitly and validate rendered output.

GitOps promotion changes image references/manifests in Git; Argo CD reconciles them. Avoid manual drift except authorized emergency operations with a documented rollback.
