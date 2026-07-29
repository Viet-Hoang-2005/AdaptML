# Bootstrap sequence

1. Provision network, security, storage, secrets, IAM, compute/load balancing, and DNS through Terraform as enabled.
2. Obtain non-secret Terraform outputs needed for inventory.
3. Build/verify Ansible inventory for K3s server and workers.
4. Run host preparation.
5. Initialize the K3s server; securely distribute the join token.
6. Join worker nodes and verify node readiness.
7. Install Helm and required cluster operators/add-ons.
8. Bootstrap Argo CD and repository access.
9. Reconcile root/production Kustomize applications.
10. Validate storage, database, messaging, control workloads, execution workflows, ingress, and monitoring.

Maintain a single owner for each operator/resource. Terraform provisions cloud primitives; Ansible bootstraps hosts/operators; GitOps owns application state after bootstrap.
