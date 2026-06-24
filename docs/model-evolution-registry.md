# Model Evolution Backend Registry (Phase 10A)

## Overview

The Model Evolution Backend Registry is a native model registry implemented within the Control Plane. It allows tracking, versions, history, and metrics associated with models deployed within the MLOps platform, laying the foundation for advanced model governance without requiring external dependencies like a standalone MLflow server for metadata tracking.

The implementation preserves the existing Django Control Plane logic where the `ModelAPI` model acts as the core deployment configuration and primary source of truth, while layering a hierarchical (`ModelFamily` / `ModelVersion`) tracking system on top.

## Architecture

1.  **Data Models (PostgreSQL + Django ORM)**
    *   **`ModelFamily`**: Represents a unique group of model versions for a tenant (identified by the `name` field from the original `ModelAPI` upload). It tracks the `current_production_version`.
    *   **`ModelVersion`**: Represents an iteration of a `ModelFamily` (e.g., `v1`, `v2`). It has a one-to-one mapping with the `ModelAPI` table to link artifact references, deployment status, and source jobs. Stages include `none`, `candidate`, `staging`, `production`, and `archived`.
    *   **`ModelDeploymentHistory`**: An append-only log capturing lifecycle events (registration, build, deployment, promotion, rollback) along with who performed them and when.
    *   **`ModelMetric`**: A unified time-series table tracking individual data points for models (such as `cpu_percent`, `memory_used_mb`, `loss`, `accuracy`) ingested from associated TrainingJob logs.

2.  **Core Services**
    *   `orchestration.registry_service.py`: Contains pure Python functions for:
        *   `sync_model_registry_for_model_api(model_api)`: An idempotent sync function that transforms a `ModelAPI` event into the appropriate `ModelFamily` and `ModelVersion` structures.
        *   `record_history(version, action, ...)`: Records events in `ModelDeploymentHistory`.
        *   `promote_version(family, version, actor)` / `rollback_family(family, version, actor)`: Handles the logic of changing a version's stage to/from `production`.
        *   `sync_metrics_for_version(version)`: Reads the source `TrainingJob` logs (if available) to parse out any `METRIC_JSON` entries and populate `ModelMetric`.

3.  **API Integration**
    *   The `registry_service` methods are injected seamlessly into existing views like `ModelAPIBuildView`, `ModelAPIDeployView`, `ModelAPIBuildWebhookView`, and `TrainingJobRegisterModelView`.
    *   New RESTful read endpoints for the registry (list families, list versions, fetch history, promote, rollback, metrics) are exposed via `registry_views.py` and mapped under `/api/orchestration/registry/`.

## Key Design Principles

*   **Idempotency & Resilience**: `get_or_create` ensures we never crash on duplicate syncs. If multiple `ModelAPI` creations fire for the same name, they are grouped under one `ModelFamily`.
*   **Dual-Write Strategy**: `ModelAPI` dictates action. `ModelRegistry` models react and log. The core `build -> deploy -> predict` flow remains undisturbed.
*   **Auditability**: Every stage change or deployment interaction is recorded in `ModelDeploymentHistory`.

## Management Commands

To handle the transition from a flat `ModelAPI` table to the registry structure, two management commands have been created:

1.  **`backfill_model_registry`**: 
    ```bash
    python manage.py backfill_model_registry
    ```
    Scans existing `ModelAPI` records, creates families and versions, and records initial history events (registered, built, deployed) based on their current state.

2.  **`sync_model_metrics`**:
    ```bash
    python manage.py sync_model_metrics
    ```
    Scans `TrainingJob` logs connected to existing `ModelVersions` and parses `METRIC_JSON` outputs to backfill historical `ModelMetric` data points.

## Frontend UI (Phase 10B)

The Model Evolution UI is implemented in `web/src/pages/Dashboard/ModelEvolutionPage.tsx` and related components in `web/src/components/model-evolution/`.

### Architecture

The frontend follows a localized state management approach, avoiding giant global fetching loops:
1. **ModelEvolutionPage**: Acts as the controller, fetching the list of `ModelFamily`s and orchestrating selections.
2. **ModelFamilyList**: Renders the left sidebar list of families, highlighting the currently selected one and displaying a "Prod Active" badge if a production version exists.
3. **ModelFamilyDetail**: Shows family metadata and a table of all associated `RegistryVersion`s.
4. **ModelVersionDetail**: The main workspace for a specific version, utilizing tabbed navigation to switch between Details, Metrics, and History.

### Metrics Visualization

Metrics are visualized using a **dependency-free lightweight implementation**. Instead of relying on a heavy charting library like `recharts` or `chart.js`, the metrics panel renders responsive, CSS-driven HTML mini-bar charts. This ensures lightning-fast performance and reduces the frontend bundle size.

### Lifecycle Actions

The UI exposes two primary actions, both protected by confirmation modals:
* **Promote to Production**: Calls `/api/orchestration/registry/families/:id/versions/:id/promote/`.
* **Rollback to Version**: Calls `/api/orchestration/registry/families/:id/versions/:id/rollback/`.

> **Note on Traffic Routing:** In Phase 10, promotion and rollback act exclusively as registry markers. They do **not** instantly switch the live prediction endpoints on Traefik/Kubernetes. This ensures a safe environment to build up the registry history before automating the traffic shift in Phase 11.

## UI Polish & Version Comparison (Phase 10C)

Phase 10C introduces significant enhancements to the Model Evolution UI to make it more professional, robust, and demo-ready without relying on heavy external charting libraries.

### Version Comparison MVP
A lightweight version comparison modal (`VersionComparisonModal.tsx`) allows users to select two versions from the same family and compare their attributes side-by-side. 
- It fetches the metrics independently for the selected versions and displays the latest point for each.
- It compares stage, source, created time, and endpoint availability.

### Metric Parser Enhancements
The `orchestration.registry_service._parse_metrics_from_logs` regex was hardened to support two `METRIC_JSON` string variants natively:
```txt
# Without colon (Old Format)
METRIC_JSON {"accuracy": 0.95}

# With colon (New Standard Format)
METRIC_JSON: {"accuracy": 0.95}
```
This ensures backwards compatibility while encouraging the more standard log structure.

### Empty State & Code Snippets
To solve the issue of `ModelMetric` records returning `0` points because users did not know how to emit metrics, a new empty state is introduced in `ModelMetricsPanel.tsx` that provides a clear, copy-pasteable Python code snippet:
```python
import json

# Emit metrics for each epoch/step
print("METRIC_JSON:", json.dumps({
    "step": 1,
    "accuracy": 0.95,
    "loss": 0.12,
    "f1": 0.93
}))
```

### SVG Sparklines & Trend Tables
The div-based mini-bars were replaced by smooth, elegant, gradient-filled SVG sparklines. 
A "Recent Trend" table was also added beneath the charts to clearly show the raw values of the last 5 steps without cluttering the main chart area.

---

## Phase 10E.1: MLflow Run Linking MVP

### Responsibility Split

| Concern | Native Registry | MLflow |
|---|---|---|
| Tenant ownership | ✅ | ❌ |
| Model Family / Version | ✅ | ❌ |
| Deploy state / endpoint URL | ✅ | ❌ |
| Promote / Rollback history | ✅ | ❌ |
| Production marker | ✅ | ❌ |
| Future production alias routing | ✅ | ❌ |
| Training run lineage | optional | ✅ |
| Training params / metrics log | optional | ✅ |
| Artifact deep-dive | optional | ✅ |
| MLflow UI deep link | ❌ | ✅ |

**The Native Registry remains the platform Source of Truth.**
MLflow is used as an optional experiment lineage tool only.

### How to Emit MLflow Run ID

In your `train.py`, inside the `mlflow.start_run()` context:

```python
with mlflow.start_run() as run:
    # Emit markers for Control Plane lineage capture
    print(f"MLFLOW_RUN_ID:{run.info.run_id}")
    print(f"MLFLOW_EXPERIMENT_ID:{run.info.experiment_id}")
    # Optional: emit model URI after logging model
    print(f"MLFLOW_MODEL_URI:runs:/{run.info.run_id}/model")
    print(f"MLFLOW_ARTIFACT_URI:{mlflow.get_artifact_uri()}")
```

Supported formats (all parsed automatically):
```
MLFLOW_RUN_ID:<run_id>
MLFLOW_RUN_ID: <run_id>
MLFLOW_RUN_ID=<run_id>
mlflow_run_id=<run_id>
```

### METRIC_JSON Fallback

Always keep `METRIC_JSON` output as primary metrics — it works with zero dependencies:

```python
import json
print("METRIC_JSON:", json.dumps({
    "step": 1,
    "accuracy": 0.95,
    "loss": 0.12,
    "f1": 0.93
}))
```

`mlflow.log_metric()` sync is planned for Phase 10E.2.

### URL Convention

| Purpose | URL | Where used |
|---|---|---|
| Container training runtime | `MLFLOW_TRACKING_URI=http://mlflow:5000` | Inside docker containers / training jobs |
| Browser / deep links | `MLFLOW_UI_URL=http://localhost:5001` | Frontend "Open in MLflow" button |

> **NEVER** put `http://localhost:5001` inside a training container.  
> **NEVER** put `http://mlflow:5000` in a browser link.

### AWS Batch Warning

Do NOT set `MLFLOW_TRACKING_URI=http://mlflow:5000` for AWS Batch jobs.
AWS Batch containers usually cannot resolve the local docker-compose hostname `mlflow`.

Use `AWS_BATCH_MLFLOW_TRACKING_URI` instead — if this env var is empty, MLflow env is not injected into Batch:

```env
AWS_BATCH_MLFLOW_TRACKING_URI=https://your-mlflow-server.example.com
```

Training will not fail if this is unset.

### Multi-Tenant Warning

The MLflow UI (`http://localhost:5001`) is **not tenant-safe**. All tenants' runs are visible to anyone with access.  
Use it for local development and admin use only. **Do not expose the MLflow UI to end users.**

### Phase 10E Roadmap

| Phase | Status | Description |
|---|---|---|
| 10E-Audit | ✅ Done | Existing MLflow flow discovery & integration design |
| 10E.1 | ✅ Done | MLflow run ID linking MVP |
| 10E.2 | 🔲 Planned | Sync mlflow.log_metric into ModelMetric |
| 10E.3 | 🔲 Planned | MLflow artifacts/checkpoints UI |
| 10E.4 | 🔲 Planned | Mirror Native production marker to MLflow alias |

---

## Phase 10E.1 Troubleshooting

### 1. `Invalid Host header - possible DNS rebinding attack detected` (HTTP 403)

**Symptom:** Calling `http://mlflow:5000/api/2.0/...` from inside the `control-plane` container returns HTTP 403 with the message above.

**Cause:** MLflow 3.x / Uvicorn enforces an allowlist of valid `Host` headers by default (`localhost` + private IPs only). Docker container-to-container calls use the service name (`mlflow`) as the Host header, which is rejected.

**Fix:** Pass `--allowed-hosts` to `mlflow server`:

```yaml
# docker-compose.yml (mlflow service)
command:
  - mlflow
  - server
  - --host
  - "0.0.0.0"
  - --port
  - "5000"
  - --allowed-hosts
  - mlflow,mlflow:5000,mlops_paas_mlflow,localhost,127.0.0.1
  - --backend-store-uri
  - ${MLFLOW_BACKEND_STORE_URI}
  - --default-artifact-root
  - s3://...
```

Use the YAML list form for `command`, not the `>` block scalar, so multi-value flags are passed correctly.

Set `MLFLOW_ALLOWED_HOSTS` in `.env` and reference it via `${MLFLOW_ALLOWED_HOSTS}` in compose for easier maintenance.

---

### 2. `ModuleNotFoundError: No module named 'mlflow'` in local training

**Symptom:** Local training job fails immediately with `ModuleNotFoundError: No module named 'mlflow'`.

**Causes:**
1. `requirements.txt` in the uploaded source zip does not include `mlflow`.
2. The training backend could not find/install requirements before running `train.py`.

**Fixes:**

1. Add `mlflow` to `requirements.txt` in your training zip:
   ```
   pandas
   scikit-learn
   mlflow
   ```

2. Ensure the local training backend uses the correct requirements resolution priority:
   - Uploaded `requirements_file` FieldFile (if the backing file exists on disk)
   - `requirements.txt` inside the extracted source directory
   - Skip install (no crash) if neither is found

3. If you see `[Errno 2] No such file or directory: '/app/src/media/training_uploads/requirements.txt'`, this means the uploaded FieldFile DB path exists but the file was cleaned up. The fixed resolver falls back to `source_dir/requirements.txt` automatically.

---

### 3. AWS Batch: no `MLFLOW_RUN_ID` in logs (expected)

**Symptom:** AWS Batch job completes successfully, but `TrainingJob.mlflow_run_id` is `None`.

**Cause:** This is **expected** when `AWS_BATCH_MLFLOW_TRACKING_URI` is empty (the default). The local Compose hostname `http://mlflow:5000` is NOT injected into AWS Batch because Batch containers cannot resolve internal Docker Compose DNS names.

**Action:** No fix needed. If you want MLflow tracking from Batch, set:

```env
# .env
AWS_BATCH_MLFLOW_TRACKING_URI=https://your-mlflow-server.example.com
```

Leave blank (the default) to skip MLflow injection for Batch. Training will still succeed using `METRIC_JSON` stdout logging.

---

### 4. Local training venv pip install fails

**Symptom:** Training log contains `Failed to install requirements.` followed by pip errors.

**Common causes:**
- Package not found (typo in requirements)
- Network timeout
- Platform incompatibility

**Fix:** Check the pip error in `TrainingJob.training_logs` (visible in the Training page). The full pip stderr is captured and stored.

Increase `LOCAL_TRAINING_TIMEOUT` if install takes too long:
```env
LOCAL_TRAINING_TIMEOUT=3600
```

---

### 5. AWS Batch job completed but no `MLFLOW_RUN_ID`

**Symptom:** AWS Batch logs contain `MLFLOW_RUN_ID` but `TrainingJob.mlflow_run_id` is empty.

This means CloudWatch logs were fetched successfully, but marker persistence failed.
Refresh-status must parse the full `training_logs` and save:
- `mlflow_run_id`
- `mlflow_experiment_id`
- `mlflow_model_uri`
- `mlflow_artifact_uri`

Manual regex verification:
`MLFLOW_RUN_ID:\s*(\S+)`

**Symptom:** AWS Batch job shows `status=completed` but logs do not contain markers.

**Diagnosis checklist:**

1. **Check `.env`** — `AWS_BATCH_MLFLOW_TRACKING_URI` must be set to a publicly reachable URL:
   ```env
   AWS_BATCH_MLFLOW_TRACKING_URI=https://your-tunnel.trycloudflare.com
   ```

2. **Check `docker compose config`** — `AWS_BATCH_MLFLOW_TRACKING_URI` must appear under `control-plane`:
   ```powershell
   docker compose config | Select-String "AWS_BATCH_MLFLOW_TRACKING_URI"
   ```
   If it's missing, the env var was not wired in `docker-compose.yml`.

3. **Recreate control-plane after any `.env` change:**
   ```powershell
   docker compose up -d --force-recreate control-plane
   ```

4. **Verify inside container:**
   ```powershell
   docker compose exec -T control-plane printenv | Select-String "AWS_BATCH_MLFLOW"
   ```

5. **Verify Django settings:**
   ```powershell
   docker compose exec -T control-plane python src/manage.py shell -c \
     "from django.conf import settings; print(settings.AWS_BATCH_MLFLOW_TRACKING_URI)"
   ```

6. **Verify Batch job received the env:**
   ```powershell
   aws batch describe-jobs --jobs <job_id> --region ap-southeast-1 \
     --query "jobs[0].container.environment[?contains(name, 'MLFLOW')]" --output table
   ```

7. **Verify Cloudflare tunnel is running** during the Batch job. If the tunnel expired, training succeeded but MLflow call failed silently (the example script wraps MLflow calls in try/except and prints `MLFLOW_WARNING:`).

> [!IMPORTANT]
> Do NOT set `AWS_BATCH_MLFLOW_TRACKING_URI=http://mlflow:5000`.
> That hostname is only resolvable inside Docker Compose, not from AWS Batch containers.
> Always use a public URL (Cloudflare Tunnel, internal ALB, or VPN endpoint).

**Root cause (docker-compose wiring):**

`docker-compose.yml` must explicitly pass the variable to the `control-plane` service:

```yaml
# docker-compose.yml — control-plane service
environment:
  MLFLOW_TRACKING_URI: ${MLFLOW_TRACKING_URI:-http://mlflow:5000}
  MLFLOW_UI_URL: ${MLFLOW_UI_URL:-http://localhost:5001}
  MLFLOW_EXPERIMENT_NAME: ${MLFLOW_EXPERIMENT_NAME:-mlops-paas-training}
  AWS_BATCH_MLFLOW_TRACKING_URI: ${AWS_BATCH_MLFLOW_TRACKING_URI:-}
```

Without this wiring, `.env` variables are read by Compose but not forwarded to the container's process environment, so `os.environ.get("AWS_BATCH_MLFLOW_TRACKING_URI")` always returns `""` inside Django.

---

## MLflow Tracking Resilience (Best-Effort)

### MLflow tracking is best-effort

AWS Batch training may receive `MLFLOW_TRACKING_URI` through `AWS_BATCH_MLFLOW_TRACKING_URI`.
If MLflow is reachable, training logs emit `MLFLOW_RUN_ID` and related markers.
If MLflow is unreachable, training still completes and emits `MLFLOW_WARNING` instead.
In that case, Model Evolution can still register/deploy the model using the normal artifact package, but the MLflow deep link will be unavailable.

### Environment variables

```env
# Public MLflow endpoint for AWS Batch (e.g. Cloudflare Tunnel URL)
# Leave empty to skip MLflow tracking in Batch jobs.
AWS_BATCH_MLFLOW_TRACKING_URI=

MLFLOW_EXPERIMENT_NAME=mlops-paas-training

# Optional: set to 'true' to make MLflow failure fatal (fail the training job)
# Default is 'false' — MLflow is best-effort
MLFLOW_TRACKING_REQUIRED=false

# Optional: timeout for MLflow HTTP requests (seconds)
MLFLOW_HTTP_REQUEST_TIMEOUT=10
```

### What happens when MLflow is unreachable

| Field | Behavior |
|-------|----------|
| `TrainingJob.status` | `completed` (training succeeded) |
| `TrainingJob.mlflow_run_id` | `None` / empty |
| `training_logs` | Contains `MLFLOW_WARNING:<reason>` |
| Register Model | ✅ Works using normal artifact path |
| Deploy Model | ✅ Works using normal artifact path |
| MLflow deep link in UI | ⚠️ Not shown (hidden when `mlflow_run_id` is empty) |

### Training job stdout markers

Success (MLflow reachable):

```
MLFLOW_RUN_ID:<run_id>
MLFLOW_EXPERIMENT_ID:<experiment_id>
MLFLOW_MODEL_URI:runs:/<run_id>/sklearn-model
MLFLOW_ARTIFACT_URI:s3://...
```

Failure (MLflow unreachable):

```
MLFLOW_WARNING:MLflow logging skipped due to error: <reason>
```

### 6. Training failed due to Cloudflare Tunnel expiry

**Symptom:** AWS Batch exitCode=1 with logs showing:

```
urllib3.exceptions.NameResolutionError: HTTPSConnection(host='your-tunnel.trycloudflare.com', ...): Failed to resolve ...
mlflow.exceptions.MlflowException: API request to https://... failed
```

**Root cause:** The Cloudflare Tunnel URL expired mid-training. Previous versions of the training script called `mlflow.set_experiment()` at module level, which caused the entire training process to crash before training even began.

**Fix:** Training script now wraps all MLflow calls inside `try_log_to_mlflow()` which is best-effort. Training and artifact saving always happen first, MLflow logging happens after as an optional step.

**Verification:**

```powershell
docker compose exec -T control-plane python src/manage.py shell -c "
from authentication.models import TrainingJob
from orchestration.mlflow_utils import parse_mlflow_metadata_from_logs
j = TrainingJob.objects.filter(name='<your-job-name>').order_by('-created_at').first()
logs = j.training_logs or ''
print('status=', j.status)
print('has warning=', 'MLFLOW_WARNING' in logs)
print('has run marker=', 'MLFLOW_RUN_ID' in logs)
print('parsed=', parse_mlflow_metadata_from_logs(logs))
print('run_id=', j.mlflow_run_id)
"
```
