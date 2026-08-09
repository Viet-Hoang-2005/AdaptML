# Bootstrap sequence

1. Provision network, security, storage, secrets, IAM, compute/load balancing, and DNS through Terraform as enabled.
2. Obtain non-secret Terraform outputs needed for inventory.
3. Build/verify Ansible inventory for K3s server and workers.
4. Run host preparation.
5. Initialize the K3s server; securely distribute the join token.
6. Join worker nodes and verify node readiness.
7. Install pinned Argo CD on static workers and create the public root Application.
8. Let the root reconcile foundation, pinned core operators, secrets, data, execution, workloads and edge in sync-wave order.
9. Validate storage, database, messaging, control workloads, ingress, and monitoring.
10. Only after core stability, inject Karpenter runtime settings and opt into CPU capacity, then validated GPU capacity.

Maintain a single owner for each operator/resource. Terraform provisions cloud primitives; Ansible bootstraps hosts and Argo CD; GitOps owns operators and application state after bootstrap.
