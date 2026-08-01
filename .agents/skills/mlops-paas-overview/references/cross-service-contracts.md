# Cross-service contracts

## Environment ID contracts

| Runtime | Required identity |
| --- | --- |
| Model packager | `BUILD_ID` plus explicit project/image context |
| ML/DL serving | `PROJECT_ID`, `MODEL_VERSION_ID` |
| Evidently | `PROJECT_ID`, `MODEL_VERSION_ID`, `DRIFT_RUN_ID`, tenant context |
| Training runner | `TRAINING_JOB_ID` |

Never reintroduce `MODEL_ID`; it ambiguously represented different resources.

## S3 layout

```text
users/{tenant}/models/{project}/code
users/{tenant}/models/{project}/data
users/{tenant}/models/{project}/builds/{build}/inputs
users/{tenant}/models/{project}/training/jobs/{job}/input
users/{tenant}/models/{project}/training/jobs/{job}/output
users/{tenant}/models/{project}/training/jobs/{job}/mlflow
users/{tenant}/models/{project}/versions/{version}
users/{tenant}/models/{project}/drift/{monitor}/{run}
```

Presigned URLs must be scoped to one object/prefix operation and expire quickly.

## Image contract

- Local repository: `image-{project_uuid}`.
- Production repository: `{registry}/user-images/image-{project_uuid}`.
- Build tag: `build-{build_uuid}`.
- Human version tag: `v{version_number}`.
- Immutable identity: Docker image ID locally; registry manifest digest in production.

## Callback contract

Callbacks bind the resource UUID in the path, authenticate the reporter, and use idempotency to tolerate retries. Common callbacks cover builds, deployments/deletion, training, cancellation, and drift runs. Never trust a tenant workload to assign its own terminal lifecycle state.
