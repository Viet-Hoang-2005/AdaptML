# Ansible K3s

Ansible owns host and cluster bootstrap through roles:

- `common`: OS packages, kernel/sysctl, users, prerequisites.
- `k3s_master`: first server/control-plane node and kubeconfig/token.
- `k3s_worker`: additional nodes joining the cluster.
- `helm`: Helm client/repositories.
- `k8s_addons`: operators and platform bootstrap.

The add-on role may install EBS CSI, External Secrets, CloudNativePG, KEDA, Argo Workflows, Kubeflow Training Operator, Karpenter, monitoring, and Argo CD. Verify current task includes and conditions before changing ownership.

Inventory group membership determines server/worker behavior. Keep SSH keys outside committed source and use Ansible Vault or external secret mechanisms for sensitive variables.

Prefer idempotent modules and handlers. Do not embed shell commands when a maintained Ansible module expresses the operation safely.
