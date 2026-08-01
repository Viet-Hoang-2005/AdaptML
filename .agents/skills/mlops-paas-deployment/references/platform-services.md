# Platform services

Root/platform manifests cover PostgreSQL/CloudNativePG resources, Redis,
Redpanda, MLflow, Harbor, monitoring, Cloudflare, storage, health, workflows,
and application workloads. Karpenter NodeClass/NodePool are not root-owned.

Operators/controllers may be installed first by Ansible:

- External Secrets.
- CloudNativePG.
- KEDA.
- Argo Workflows.
- Monitoring stack.
- Argo CD.

Kubeflow and Karpenter belong to the optional Ansible training phase. CPU
capacity comes before GPU capacity; the GPU NodePool must remain disabled until
the complete NVIDIA runtime stack is verified.

Confirm CRDs/controllers exist before applying custom resources. Harbor is reconciled through its GitOps directory once referenced by root. Cloudflare exposes selected low-bandwidth/private UIs; do not assume it is suitable for large model uploads or registry pushes.

KEDA/HPA scale application workloads; Karpenter scales nodes only where the underlying cloud integration exists. External VM K3s deployments require an alternate capacity plan.
