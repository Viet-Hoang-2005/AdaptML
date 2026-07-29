# Secrets, IAM, registry, and network

- Local secrets live in an ignored `.env`; production uses Secrets Manager and External Secrets for trusted workloads.
- Rotate credentials that were exposed to tenant code or logs.
- Never commit SSH private keys, OAuth secrets, JWT keys, AWS keys, Harbor robot credentials, or webhook secrets.
- IAM policies must scope S3 buckets/prefixes, Secrets Manager ARNs, registry operations, and infrastructure actions.
- Node IAM must not grant every pod broad secret access; use workload identity/isolated roles where supported.
- Restrict metadata service access and hop behavior.

Harbor automation uses a least-privilege robot account. Store image digest as immutable identity and verify signatures where the pipeline supports them.

Expose only required services. Large artifact/registry traffic needs an ingress/load-balancer path sized for uploads; administrative UIs may use a tunnel. Apply TLS, request limits, authentication, and source restrictions at each public boundary.
