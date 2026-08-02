# Ansible K3s rollout

This directory bootstraps the AWS-hosted K3s cluster from WSL Ubuntu. Terraform
owns AWS resources, Ansible owns host preparation and operator bootstrap, and
Argo CD owns application workloads declared by the root `k8s/kustomization.yaml`.

## Control-host setup

Use a dedicated Python virtual environment in WSL. Never store the EC2 private
key in the repository.

```bash
cd /mnt/d/AI\ Models/mlops-paas-system
python3 -m venv .venv-ansible
source .venv-ansible/bin/activate
pip install -r ansible/requirements-control.txt
ansible-galaxy collection install -r ansible/requirements.yml
install -m 0600 /path/to/aws_key ~/.ssh/aws_key
```

The active AWS CLI session is used only from WSL for preflight checks and, when
Karpenter is explicitly enabled, writing the K3s agent token to Secrets Manager.
The playbook does not copy AWS access keys to a node or Kubernetes Secret.

The dynamic inventory reads applied Terraform outputs. After adding or changing
output blocks, refresh the state deliberately before running Ansible:

```bash
terraform -chdir=infra apply -refresh-only
terraform -chdir=infra output -json
```

Review the refresh-only plan before approval; the Ansible workflow never runs
Terraform apply on your behalf.

## Phases

| Tag | Responsibility | Default |
|---|---|---|
| `preflight` | Validate Linux, Terraform inventory, SSH key and rollout flags | Always |
| `bootstrap` | Prepare Ubuntu, install K3s `v1.34.9+k3s1`, join static workers | Enabled |
| `platform-core` | Install pinned operators, bootstrap External Secrets and Argo CD | Enabled |
| `platform-training` | Install Kubeflow, Karpenter, GPU Operator and smoke tests | Explicit |
| `verify` | Validate nodes, bundled components and root GitOps health | Explicit/final |

K3s keeps its bundled Traefik, ServiceLB and local-path provisioner during this
phase. The single server uses embedded etcd, secrets encryption, snapshots, a
control-plane taint and a root-only kubeconfig. Two static workers join over the
server private IP and receive AWS provider IDs from IMDSv2.

The bundled Traefik entrypoints use an explicit 600-second request timeout.
This matches the public ALB idle timeout and prevents large Harbor layer uploads
from being terminated by Traefik's 60-second default while the request body is
still being streamed.

TLS terminates at the public ALB. Because the bundled K3s ServiceLB currently
uses `externalTrafficPolicy: Cluster`, Traefik sees the selected worker's
Flannel gateway as the immediate proxy. `traefik_forwarded_headers_trusted_ips`
must therefore contain only those gateway `/32` addresses. This allows Django
to honor the ALB's `X-Forwarded-Proto: https` without enabling Traefik's unsafe
`forwardedHeaders.insecure` mode. Revalidate these addresses after changing the
static worker topology or cluster PodCIDR allocation.

Core operators are pinned and installed with Ansible modules in this order:

1. AWS EBS CSI
2. External Secrets Operator
3. CloudNativePG
4. KEDA
5. Argo Workflows and Argo Events
6. kube-prometheus-stack
7. Argo CD

Operator controllers are scheduled on static workers, whose EC2 instance
profile provides AWS access where required. Ansible applies the
`ClusterSecretStore`, waits for it, creates the Argo repository credential via
an `ExternalSecret`, then creates and waits for the root Application.

## Commands

Run static checks before touching hosts:

```bash
cd ansible
export ANSIBLE_CONFIG=./ansible.cfg
ansible-inventory --graph
ansible-playbook --syntax-check site.yml
ansible-lint .
kubectl kustomize --enable-helm ../k8s >/dev/null
```

Roll out deliberately:

```bash
ansible-playbook site.yml --tags bootstrap
ansible-playbook site.yml --tags bootstrap  # idempotency check
ansible-playbook site.yml --tags platform-core
ansible-playbook site.yml --tags verify
```

After the core platform is stable, enable training explicitly:

The training platform is deployed only through Ansible and remains closed to
tenant traffic after rollout. It installs the Kubeflow Training Operator
(PyTorchJob V1), Karpenter, NVIDIA GPU Operator, and Karpenter CPU/GPU capacity
objects. It also executes disposable CPU and GPU PyTorchJob smoke tests in
`ansible-training-smoke`.

Run the production rollout from WSL, copying the configuration to the native
WSL filesystem (Ansible rejects configuration stored directly on `/mnt/d`):

```bash
cd /mnt/d/AI\ Models/mlops-paas-system/ansible
export ANSIBLE_CONFIG="$(mktemp /tmp/mlops-paas-ansible.XXXXXX.cfg)"
trap 'rm -f "$ANSIBLE_CONFIG"' EXIT
install -m 0600 ansible.cfg "$ANSIBLE_CONFIG"
ansible-playbook -i inventory/terraform.py site.yml \
  --tags preflight,platform-training,verify
```

The rollout requires Terraform outputs for the Karpenter instance profile,
interruption queue, and controller policy. Each Karpenter NodePool is capped at
one node and permits Spot first with On-Demand fallback. The smoke namespace is
always removed, then Ansible waits for the temporary Karpenter nodes to
consolidate. It never uses `user-jobs` or application secrets.

`TRAINING_ENABLED=false` remains in the Control Plane ConfigMap. The API returns
HTTP 503 for training submission and the UI hides training execution controls,
even while the platform components are installed. Do not set an Argo training
webhook URL or enable the feature until Sensor mapping, EventSource
authentication, and workload-isolation controls have been reviewed.

For rollback, first delete smoke resources and wait until no `PyTorchJob` is
running. Disable/delete Karpenter NodePools, let empty training nodes drain, then
remove Karpenter. Remove the GPU Operator before the Training Operator; do not
change core GitOps workloads during this process.

## Access and artifacts

Workers have private IPs and use `ProxyJump` through the server. Host keys use
OpenSSH `accept-new`; existing mismatches still fail. The fetched kubeconfig is
written to ignored `ansible/artifacts/kubeconfig` with mode `0600`. For remote
administration, tunnel the private Kubernetes API through the server instead of
publishing port 6443.

## Ownership and deferred hardening

- Terraform: VPC, EC2, ALB, IAM, S3, Secrets Manager and Karpenter AWS resources.
- Ansible: OS/K3s, pinned operators, GitOps bootstrap and cluster-specific
  Karpenter NodeClass/NodePool.
- Argo CD: resources referenced by root Kustomize, including applications and
  platform manifests already present there.

`k8s/security` is intentionally not referenced by root GitOps in this rollout.
Custom NetworkPolicies and PodDisruptionBudgets are deferred until the platform
is stable. This is a temporary operational decision, not a production security
guarantee.

One K3s server is still a control-plane single point of failure. Local etcd
snapshots improve recovery but do not provide HA; that requires three servers.
