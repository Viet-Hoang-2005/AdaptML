# Control Plane API Catalog

All public resource identifiers are UUIDs. Routes have no `/v1` prefix and no
legacy aliases.

## Public API

| Area | Routes |
|---|---|
| Identity | `/api/auth/token/`, `/api/auth/token/refresh/`, `/api/auth/register/`, `/api/auth/profile/`, OTP, password, OAuth, JWKS routes |
| API keys | `/api/api-keys/`, `/api/api-keys/{key_uuid}/`, `/api/api-keys/{key_uuid}/regenerate/` |
| Projects | `/api/models/`, `/api/models/{project_uuid}/` |
| Workspace | `/api/models/{project_uuid}/workspace/{code|data}/files/` |
| Requirements | `/api/models/{project_uuid}/requirements/` |
| Versions | `/api/registry/models/{project_uuid}/versions/`, `/api/registry/versions/{version_uuid}/`, `/{version_uuid}/smoke-test/` |
| Aliases | `/api/registry/models/{project_uuid}/aliases/`, `/api/registry/models/{project_uuid}/aliases/{alias}/predict/` |
| Training | `/api/training-jobs/`, `/{job_uuid}/`, `/{job_uuid}/submit/`, `/{job_uuid}/cancel/`, `/{job_uuid}/events/`, `/{job_uuid}/download/` |
| Builds | `/api/builds/`, `/api/builds/{build_uuid}/`, `/api/builds/{build_uuid}/cancel/` |
| Deployments | `/api/deployments/`, `/{deployment_uuid}/`, `/{deployment_uuid}/stop/` |
| Endpoints | `/api/endpoints/`, `/api/endpoints/{endpoint_uuid}/logs/` |
| Drift | `/api/drift-monitors/`, `/{monitor_uuid}/`, `/{monitor_uuid}/runs/` |
| Observability | `/api/observability/models/{project_uuid}/` |
| Operations | `/health/live`, `/health/ready`, `/health/metrics` |

Collections use the shared DRF pagination envelope. Input serializers validate
tenant ownership before services mutate state. API key secrets are returned only
on creation or regeneration and can be scoped only to projects owned by the user.

## Inference URL

Public endpoint URLs use:

```text
/{tenant_id}/models/{project_uuid}/{version_uuid}/predict
/{tenant_id}/models/{project_uuid}/{version_uuid}/health
```

Traefik rewrites these paths to the central model server as
`/models/{version_uuid}/{action}`. The model server resolves the healthy endpoint
from the control-plane schema and enforces project access mode/API key scope.
