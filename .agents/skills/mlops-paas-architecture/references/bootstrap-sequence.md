# Bootstrap sequence

1. Provision network, security, storage, secrets, IAM, compute/load balancing, and DNS through Terraform as enabled.
2. Obtain non-secret Terraform outputs needed for inventory.
3. Build/verify Ansible inventory for K3s server and workers.
4. Run host preparation.
5. Initialize the K3s server; securely distribute the join token.
6. Join worker nodes and verify node readiness.
7. Install pinned core operators on static workers.
8. Apply the ClusterSecretStore, wait for it, then materialize Argo repository credentials through External Secrets.
9. Bootstrap Argo CD and reconcile the root/production Kustomize application.
10. Validate storage, database, messaging, control workloads, ingress, and monitoring.
11. Only after core stability, opt into Kubeflow, CPU Karpenter capacity, and finally validated GPU capacity.

Maintain a single owner for each operator/resource. Terraform provisions cloud primitives; Ansible bootstraps hosts/operators; GitOps owns application state after bootstrap.
