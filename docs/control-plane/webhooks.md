# Internal Webhook Contract

Callbacks are internal-only and require one of these equivalent credentials:

- `X-Control-Plane-Secret: <secret>`
- `Authorization: Bearer <secret>`

The configured secret is mandatory in production and must contain at least 32
characters. Do not include credentials or presigned URLs in logs.

## Routes

| Producer | Route | Terminal status |
|---|---|---|
| Model packager / Argo build | `POST /internal/webhooks/builds/{build_uuid}/` | `success`, `error`, `cancelled` |
| Training runner / Argo training | `POST /internal/webhooks/training-jobs/{job_uuid}/` | `completed`, `failed`, `cancelled` |
| Evidently / Argo drift | `POST /internal/webhooks/drift-runs/{run_uuid}/` | `completed`, `failed` |

Webhook consumers are idempotent. Once a resource reaches a terminal state, a
duplicate callback returns success with `duplicate: true` and does not overwrite
the stored outcome. UUIDs also act as the callback idempotency key.

Payloads may include logs, an error message, image/package URI, output URI, and
drift report URIs as appropriate. Artifact transfer uses temporary presigned
URLs in the trigger payload; workers do not receive long-lived S3 credentials.
