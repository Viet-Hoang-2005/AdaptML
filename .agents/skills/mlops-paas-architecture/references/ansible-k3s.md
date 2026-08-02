# Ansible K3s

Ansible owns host and cluster bootstrap through roles:

- `common`: OS packages, kernel/sysctl, users, prerequisites.
- `k3s_master`: first server/control-plane node and kubeconfig/token.
- `k3s_worker`: additional nodes joining the cluster.
- `helm`: pinned Helm client.
- `platform_core`: pinned operators, External Secrets, and root Argo CD bootstrap.
- `platform_training`: bootstrap the Argo CD training-operator parent application,
  maintain cluster-specific Karpenter runtime settings and render capacity resources.
- `verify`: bootstrap and reconciled-platform assertions.

Use the rollout tags `preflight`, `bootstrap`, `platform-core`,
`platform-training`, and `verify`. Core defaults on; training, Karpenter, and GPU
capacity require explicit opt-in. K3s is configured through protected
`/etc/rancher/k3s/config.yaml` files and pinned by `INSTALL_K3S_VERSION`.

Dynamic inventory requires Terraform outputs for the server, workers, VPC and
EC2 key pair. Workers use ProxyJump through the server. Keep SSH keys outside
committed source; the WSL key must be `~/.ssh/aws_key` with mode `0600`.

Terraform owns AWS primitives; Ansible owns host bootstrap, the K3s agent-token
secret, Karpenter runtime endpoint settings and cluster-specific capacity
resources. Argo CD owns Kubeflow Training Operator, Karpenter CRD/controller,
Node Feature Discovery and NVIDIA GPU Operator through the `platform-operators`
parent Application. Do not add Karpenter NodeClass/NodePool back to root GitOps.

Ansible also owns the bundled Traefik `HelmChartConfig`. Public TLS terminates
at the ALB, while K3s ServiceLB with `externalTrafficPolicy: Cluster` presents
the static worker Flannel gateway as Traefik's immediate peer. Trust only those
gateway `/32` addresses for forwarded headers; never use
`forwardedHeaders.insecure`. Revalidate the addresses whenever worker PodCIDRs
or ServiceLB traffic policy changes.

Prefer idempotent modules and handlers. Do not embed shell commands when a maintained Ansible module expresses the operation safely.
