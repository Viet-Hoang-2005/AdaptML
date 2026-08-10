# Trust boundaries

## Trusted

- Control Plane API and workers.
- model-server authentication gateway.
- database/storage/registry operators with scoped credentials.
- Argo/Kubernetes controllers and trusted lifecycle reporters.

## Untrusted

- Tenant-uploaded training source and dependencies.
- Dynamic model images/workers.
- Uploaded archives and model artifacts.
- Public/browser/API input.
- Runtime logs and callback payloads until authenticated and validated.

Untrusted workloads must not receive shared application secrets, JWT private keys, OAuth secrets, AWS credentials, production Redis, broad MLflow access, or node metadata access.

Karpenter-created training nodes may read only the dedicated K3s agent-token
secret during host bootstrap. The token value stays out of Git and Terraform
state; workload containers must not receive the node IAM credentials or token.

PostgreSQL terminal state is updated only by trusted orchestration/reporters. A tenant callback may report bounded progress but cannot authoritatively complete another resource.

When TLS terminates before Traefik, forwarded scheme and client headers are
trusted only from the explicit immediate proxy addresses observed at Traefik.
Do not trust an entire pod/VPC CIDR when narrower `/32` proxy hops are stable,
and never enable forwarded-header insecure mode on a public entrypoint.
