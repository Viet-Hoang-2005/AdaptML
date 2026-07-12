# Control Plane Architecture

## Boundaries

The control plane is a modular monolith split by business capability. Each app
owns its database tables and write rules. Cross-domain reads use selectors;
cross-domain writes use services. Direct imports from another app's API module
or infrastructure calls from API endpoints are prohibited.

```text
HTTP request
  -> api endpoint + DRF serializer
  -> application service / selector
  -> domain model and transaction
  -> transaction.on_commit
  -> Celery task
  -> infrastructure execution backend
  -> Docker locally or Argo in production
```

## Domain Model

- `CustomUser`: identity and tenant boundary. One user maps to one `tenant_id`.
- `ModelProject`: mutable model workspace and latest requirements.
- `WorkspaceAsset`: latest code or data object with checksum and S3 URI.
- `TrainingJob`: immutable code, data, and requirements snapshot for one run.
- `TrainingOutput`: files produced by a training job.
- `ModelVersion`: immutable registry record sourced from an upload or job.
- `ModelArtifact`: version artifact or metadata mapping.
- `Build`: image/package build state for one version.
- `Deployment`: rollout state for one successful build.
- `Endpoint`: routable runtime attached to one deployment.
- `DriftMonitor` and `DriftRun`: monitoring configuration and executions.
- `EventOutbox`: transactional events awaiting Redpanda publication.

Every externally addressable resource uses a UUID `public_id`. Integer primary
keys remain internal implementation details and never appear in URLs or S3 keys.

## Async Execution

The web process validates commands and commits state. Celery owns build,
training, deployment, drift, cleanup, polling, and outbox publication. Backends
share a contract selected from settings: Docker for local development and Argo
webhooks for production. Callbacks use UUID URLs and a required shared secret.

Tasks lock mutable rows, store `celery_task_id`, tolerate duplicate terminal
callbacks, use time limits, and retry transient connection failures with backoff.

## Storage

```text
users/{tenant}/models/{project_uuid}/
|-- code/                              # Latest editable source
|-- data/                              # Latest editable data
|-- training/jobs/{job_uuid}/
|   |-- input/code/source.zip          # Job snapshot
|   |-- input/data/train.csv           # Job snapshot
|   |-- output/model.tar.gz            # User/trainer outputs
|   `-- mlflow/                        # Job-scoped weights and run artifacts
`-- versions/{version_uuid}/
    `-- artifacts/                     # Immutable registered/build artifacts
```

There is no global MLflow artifact root and no version-scoped editable code or
data. Registering a training result maps job snapshots and weights to an
immutable model version without moving the mutable project workspace.

## Ownership Rules

1. API endpoints may import their own serializers, domain services, and selectors.
2. Apps may call another app only through its service or selector contract.
3. Infrastructure modules may import domain models only inside adapter methods.
4. Domain models do not import API, task, or infrastructure modules.
5. Package `__init__.py` files do not re-export domain models.
6. Tenant-facing queries must start from a tenant-scoped selector.
