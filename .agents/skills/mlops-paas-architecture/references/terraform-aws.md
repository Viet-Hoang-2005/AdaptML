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

Do not edit generated state, commit tfvars containing secrets, or infer that AWS EC2 is still the only target; the deployment may use external VMs while retaining S3/Secrets Manager.
