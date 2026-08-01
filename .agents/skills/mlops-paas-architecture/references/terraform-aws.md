# Terraform AWS

The root composition wires modules for:

- `network`: VPC, public/private subnets, routes, NAT/internet gateways.
- `security`: security groups and traffic boundaries.
- `storage`: S3 buckets and storage configuration.
- `secrets`: Secrets Manager resources, not secret values in state/source.
- `iam`: instance, workload, registry, and automation permissions.
- `compute`: control/worker instances or related bootstrap compute.
- `alb`: listeners, target groups, certificates, and public service routing.
- `dns`: Route53 records.
- Karpenter dependencies: OIDC, queues, node roles/profiles, and discovery tags.

Inspect `variables.tf`, feature flags, `main.tf`, and outputs together. Disabled optional modules must not be referenced unconditionally. Apply least privilege and avoid wildcard Secrets Manager/S3/IAM permissions.

## Root feature flags

Persistent foundation resources use `enable_artifact_storage`, `enable_secrets_manager`, `enable_github_oidc`, and `enable_acm_certificate`. Runtime resources use `enable_network`, `enable_nat_gateway`, `enable_k3s_compute`, `enable_alb`, and `enable_karpenter`.

Current dependencies are enforced by root `check` blocks:

- K3s compute requires network, NAT, artifact storage, and Secrets Manager.
- ALB requires network, K3s compute, and ACM.
- Karpenter requires network, NAT, and the static K3s cluster.
- GitHub OIDC currently requires artifact storage and Secrets Manager because its IAM policy references both.

Turning a flag off proposes resource destruction; it is not a pause mechanism. Review the plan and protect or separate persistent foundation state before disabling S3 or Secrets Manager.

Do not edit generated state, commit tfvars containing secrets, or infer that AWS EC2 is still the only target; the deployment may use external VMs while retaining S3/Secrets Manager.
