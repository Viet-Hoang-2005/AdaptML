import hashlib
import json
import boto3
import mlflow
import tarfile
import tempfile

from pathlib import Path
from urllib.parse import urlparse
from django.conf import settings
from django.utils import timezone
from authentication.models import TrainingJob
from integrations.hashid_utils import encode_model_id
from integrations.s3_paths import training_job_mlflow_prefix
from registry.views import sync_registry_version_from_model_api

MODEL_EXTENSIONS = {".pkl", ".joblib", ".xgb"}
CHECKPOINT_EXTENSIONS = {".pt", ".pth", ".ckpt", ".h5", ".onnx", ".keras"}
METADATA_EXTENSIONS = {".json", ".yaml", ".yml", ".txt"}
MAX_MLFLOW_PARAM_VALUE_CHARS = 500
MAX_MODEL_INSIGHT_ITEMS = 500


class TrackingIngestionError(Exception):
    pass


class UnsafeTrainingArtifactError(TrackingIngestionError):
    pass


def _mlflow_tracking_error_message(exc: Exception) -> str:
    detail = str(exc)
    lowered = detail.lower()
    unavailable_markers = (
        "nameresolutionerror",
        "failed to resolve",
        "temporary failure in name resolution",
        "connection refused",
        "connectionerror",
        "newconnectionerror",
        "max retries exceeded",
        "timeout",
        "timed out",
    )
    if any(marker in lowered for marker in unavailable_markers):
        return "MLFLOW_UNAVAILABLE: Unable to reach MLflow tracking server. Metadata was ingested into Native Registry."
    if "mlflow_tracking_uri" in lowered:
        return "MLFLOW_UNAVAILABLE: MLflow tracking URI is not configured. Metadata was ingested into Native Registry."
    return f"MLflow tracking failed: {detail}"


def _s3_client():
    return boto3.client("s3", region_name=getattr(settings, "AWS_DEFAULT_REGION", "ap-southeast-1"))


def _parse_s3_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path.lstrip("/"):
        raise TrackingIngestionError("model_artifact_uri must be a valid s3:// URI.")
    return parsed.netloc, parsed.path.lstrip("/")


def _download_artifact(uri: str, destination: Path) -> None:
    parsed = urlparse(uri)
    if parsed.scheme == "s3":
        bucket, key = _parse_s3_uri(uri)
        _s3_client().download_file(bucket, key, str(destination))
        return
    if parsed.scheme == "file":
        source = Path(parsed.path)
    else:
        source = Path(uri)
    if source.exists() and source.is_file():
        destination.write_bytes(source.read_bytes())
        return
    raise TrackingIngestionError("model_artifact_uri must point to an S3 object or local tar.gz file.")


def _is_within_directory(base: Path, target: Path) -> bool:
    base_resolved = base.resolve()
    target_resolved = target.resolve()
    return target_resolved == base_resolved or base_resolved in target_resolved.parents


def _safe_extract_tar(archive_path: Path, destination: Path) -> None:
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            members = archive.getmembers()
            if not members:
                raise TrackingIngestionError("Training artifact is empty.")
            for member in members:
                member_path = Path(member.name)
                if member_path.is_absolute() or ".." in member_path.parts:
                    raise UnsafeTrainingArtifactError(f"Unsafe tar path rejected: {member.name}")
                if member.issym() or member.islnk():
                    raise UnsafeTrainingArtifactError(f"Unsafe tar link rejected: {member.name}")
                target = destination / member.name
                if not _is_within_directory(destination, target):
                    raise UnsafeTrainingArtifactError(f"Unsafe tar extraction path rejected: {member.name}")
            archive.extractall(destination)
    except (tarfile.TarError, OSError) as exc:
        raise TrackingIngestionError(f"Training artifact could not be extracted: {exc}") from exc


def _read_json_object(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _read_json_list(path: Path) -> list:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return payload if isinstance(payload, list) else []


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _artifact_kind(relative_path: Path) -> str:
    suffix = relative_path.suffix.lower()
    if relative_path.name == "MLmodel" or suffix in MODEL_EXTENSIONS:
        return "model"
    if suffix in CHECKPOINT_EXTENSIONS:
        return "checkpoint"
    if suffix in METADATA_EXTENSIONS:
        return "metadata"
    if suffix == ".log":
        return "log"
    return "other"


def _scan_artifact_manifest(root: Path) -> list[dict]:
    manifest = []
    for item in sorted(root.rglob("*")):
        if not item.is_file():
            continue
        if not _is_within_directory(root, item):
            continue
        relative_path = item.relative_to(root)
        manifest.append(
            {
                "path": relative_path.as_posix(),
                "size_bytes": item.stat().st_size,
                "sha256": _sha256_file(item),
                "kind": _artifact_kind(relative_path),
            }
        )
    return manifest


def _numeric_metrics(payload: dict) -> dict:
    return {
        str(key): value
        for key, value in (payload or {}).items()
        if isinstance(value, (int, float)) and not isinstance(value, bool)
    }


def _safe_params(payload: dict) -> dict:
    safe = {}
    for key, value in (payload or {}).items():
        if value is None or isinstance(value, (str, int, float, bool)):
            safe[str(key)] = value
        elif isinstance(value, (list, dict)):
            safe[str(key)] = json.dumps(value, sort_keys=True, default=str)[:MAX_MLFLOW_PARAM_VALUE_CHARS]
        else:
            safe[str(key)] = str(value)[:MAX_MLFLOW_PARAM_VALUE_CHARS]
    return safe


def normalize_model_insights(payload: dict, default_kind: str = "") -> dict:
    if not isinstance(payload, dict):
        return {}

    kind = str(payload.get("kind") or default_kind or "feature_importance")
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        feature_importance = payload.get("feature_importance")
        coefficients = payload.get("coefficients")
        if isinstance(feature_importance, dict):
            kind = "feature_importance"
            raw_items = [{"name": name, "value": value} for name, value in feature_importance.items()]
        elif isinstance(coefficients, dict):
            kind = "coefficients"
            raw_items = [{"name": name, "value": value} for name, value in coefficients.items()]
        else:
            raw_items = []

    items = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("feature") or "").strip()
        if not name:
            continue
        value = item.get("value", item.get("importance", item.get("coefficient")))
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        normalized = {
            "name": name,
            "value": float(value),
            "abs_value": float(abs(value)),
        }
        class_name = item.get("class_name", item.get("class"))
        if class_name is not None:
            normalized["class_name"] = str(class_name)
        items.append(normalized)

    items = sorted(items, key=lambda entry: entry["abs_value"], reverse=True)[:MAX_MODEL_INSIGHT_ITEMS]
    for rank, item in enumerate(items, start=1):
        item["rank"] = rank

    if not items:
        return {}

    try:
        feature_count = int(payload.get("feature_count") or len(items))
    except (TypeError, ValueError):
        feature_count = len(items)

    return {
        "schema_version": "model-insights-v1",
        "kind": kind,
        "source": str(payload.get("source") or "training_artifact"),
        "feature_count": feature_count,
        "items": items,
    }


def compute_deployability(manifest: list[dict]) -> tuple[str, str]:
    if not manifest:
        return "invalid", "Training artifact is empty or unreadable."

    paths = [item.get("path", "") for item in manifest if item.get("path")]
    names = [Path(path).name for path in paths]
    suffixes = [Path(path).suffix.lower() for path in paths]

    if "MLmodel" in names:
        return "deployable", "Artifact contains an MLflow MLmodel serving contract."

    model_files = sorted(path for path in paths if Path(path).suffix.lower() in MODEL_EXTENSIONS)
    if model_files:
        preferred = ["model.pkl", "model.joblib", "model.xgb"]
        for preferred_name in preferred:
            for path in model_files:
                if Path(path).name == preferred_name:
                    return "deployable", f"Artifact contains supported model file: {path}."
        return "deployable", f"Artifact contains supported model file: {model_files[0]}."

    if any(suffix in CHECKPOINT_EXTENSIONS for suffix in suffixes):
        return "track_only", "Artifact contains checkpoints or weights but no supported serving contract."

    return "track_only", "Artifact contains metadata/log files but no supported deployable model file."


def _write_generated_mlops_bundle(mlops_dir: Path, training_job: TrainingJob, manifest: list[dict], warning: str) -> None:
    mlops_dir.mkdir(parents=True, exist_ok=True)
    summary = {
        "runner_version": "generated-by-control-plane",
        "entry_point": training_job.entry_point,
        "model_version": training_job.model_version,
        "training_job_id": str(training_job.id),
        "status": training_job.status,
        "metrics": {},
        "params": {},
        "artifact_count": len(manifest),
        "warnings_count": 1,
        "warning": warning,
    }
    (mlops_dir / "training_summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
    (mlops_dir / "metrics.json").write_text("{}", encoding="utf-8")
    (mlops_dir / "params.json").write_text("{}", encoding="utf-8")
    (mlops_dir / "model_insights.json").write_text("{}", encoding="utf-8")
    (mlops_dir / "artifact_manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    (mlops_dir / "warnings.json").write_text(
        json.dumps([{"code": "missing_mlops_bundle", "message": warning}], indent=2),
        encoding="utf-8",
    )
    (mlops_dir / "stdout.txt").write_text("", encoding="utf-8")
    (mlops_dir / "stderr.txt").write_text("", encoding="utf-8")
    (mlops_dir / "metric_events.jsonl").write_text("", encoding="utf-8")


def _log_to_mlflow(training_job: TrainingJob, mlops_dir: Path, metrics: dict, params: dict) -> dict:
    tracking_required = getattr(settings, "MLFLOW_TRACKING_REQUIRED", False)
    if not tracking_required:
        return {}

    tracking_uri = getattr(settings, "MLFLOW_TRACKING_URI", "http://mlflow:5000").strip()
    experiment_name = getattr(settings, "MLFLOW_EXPERIMENT_NAME", "mlops-paas-training").strip()
    if not tracking_uri:
        raise TrackingIngestionError("MLFLOW_TRACKING_URI is not configured.")

    mlflow.set_tracking_uri(tracking_uri)
    if not getattr(training_job, "model_api", None):
        raise TrackingIngestionError(
            "Training job is not linked to a model, so its MLflow artifact root cannot be resolved."
        )

    tenant_id = training_job.tenant.tenant_id
    model_hash_id = encode_model_id(training_job.model_api.id)
    bucket_name = getattr(settings, "AWS_STORAGE_BUCKET_NAME", "")
    mlflow_prefix = training_job_mlflow_prefix(tenant_id, model_hash_id, training_job.id)
    artifact_root = f"s3://{bucket_name}/{mlflow_prefix}"
    experiment_name = f"tenant-{tenant_id}-training-job-{training_job.id}"

    experiment = mlflow.get_experiment_by_name(experiment_name)
    if not experiment:
        experiment_id = mlflow.create_experiment(
            experiment_name,
            artifact_location=artifact_root,
        )
        experiment = mlflow.get_experiment(experiment_id)
    mlflow.set_experiment(experiment_name)
    run_name = training_job.mlflow_run_name or f"training-job-{training_job.id}-{training_job.name}"

    start_run_kwargs = {"run_name": run_name}
    if training_job.mlflow_run_id:
        start_run_kwargs["run_id"] = training_job.mlflow_run_id

    with mlflow.start_run(**start_run_kwargs) as run:
        mlflow.set_tags(
            {
                "tenant_id": training_job.tenant.tenant_id,
                "training_job_id": str(training_job.id),
                "model_name": training_job.name,
                "model_version": training_job.model_version,
                "training_backend": training_job.training_backend,
                "entry_point": training_job.entry_point,
                "model_artifact_uri": training_job.model_artifact_uri,
                "deployability_status": training_job.deployability_status,
                "mlflow_artifact_root": artifact_root,
            }
        )

        platform_params = {
            "training_backend": training_job.training_backend,
            "entry_point": training_job.entry_point,
            "model_version": training_job.model_version,
        }
        for key, value in {**_safe_params(params), **platform_params}.items():
            mlflow.log_param(key, str(value)[:MAX_MLFLOW_PARAM_VALUE_CHARS])

        for key, value in _numeric_metrics(metrics).items():
            mlflow.log_metric(key, float(value))

        if mlops_dir.exists():
            mlflow.log_artifacts(str(mlops_dir), artifact_path="_mlops")

        return {
            "run_id": run.info.run_id,
            "experiment_id": str(run.info.experiment_id or getattr(experiment, "experiment_id", "")),
            "experiment_name": experiment_name,
            "artifact_uri": mlflow.get_artifact_uri(),
            "tracking_uri": tracking_uri,
            "run_name": run_name,
        }


def _summary_response(training_job: TrainingJob) -> dict:
    return {
        "training_job_id": training_job.id,
        "tracking_status": training_job.tracking_status,
        "tracking_error": training_job.tracking_error,
        "tracking_ingested_at": training_job.tracking_ingested_at,
        "training_summary": training_job.training_summary,
        "metrics_summary": training_job.metrics_summary,
        "params_summary": training_job.params_summary,
        "model_insights_summary": training_job.model_insights_summary,
        "artifact_manifest": training_job.artifact_manifest,
        "deployability_status": training_job.deployability_status,
        "deployability_reason": training_job.deployability_reason,
        "mlflow_run_id": training_job.mlflow_run_id or "",
        "mlflow_experiment_id": training_job.mlflow_experiment_id or "",
        "mlflow_artifact_uri": training_job.mlflow_artifact_uri or "",
    }


def _sync_registered_versions(training_job: TrainingJob) -> None:
    for model_api in training_job.registered_model_apis.exclude(status="disabled"):
        sync_registry_version_from_model_api(model_api, training_job=training_job)


def ingest_training_job_tracking(training_job: TrainingJob, force: bool = False) -> dict:
    if training_job.status != "completed":
        training_job.tracking_status = "skipped"
        training_job.tracking_error = "Only completed training jobs are eligible for tracking ingestion."
        training_job.save(update_fields=["tracking_status", "tracking_error", "updated_at"])
        return _summary_response(training_job)

    if not training_job.model_artifact_uri:
        training_job.tracking_status = "failed"
        training_job.tracking_error = "Training job has no model_artifact_uri."
        training_job.deployability_status = "invalid"
        training_job.deployability_reason = "Training artifact is missing."
        training_job.save(
            update_fields=[
                "tracking_status",
                "tracking_error",
                "deployability_status",
                "deployability_reason",
                "updated_at",
            ]
        )
        return _summary_response(training_job)

    if training_job.tracking_status == "completed" and training_job.mlflow_run_id and not force:
        return _summary_response(training_job)

    training_job.tracking_status = "ingesting"
    training_job.tracking_error = ""
    training_job.save(update_fields=["tracking_status", "tracking_error", "updated_at"])

    with tempfile.TemporaryDirectory(prefix=f"tracking-ingest-{training_job.id}-") as temp_dir:
        workspace = Path(temp_dir)
        archive_path = workspace / "model.tar.gz"
        extracted_dir = workspace / "artifact"
        extracted_dir.mkdir(parents=True, exist_ok=True)

        try:
            _download_artifact(training_job.model_artifact_uri, archive_path)
            _safe_extract_tar(archive_path, extracted_dir)
        except Exception as exc:
            message = str(exc)
            training_job.tracking_status = "failed"
            training_job.tracking_error = message
            training_job.deployability_status = "invalid"
            training_job.deployability_reason = message
            training_job.tracking_ingested_at = timezone.now()
            training_job.save(
                update_fields=[
                    "tracking_status",
                    "tracking_error",
                    "tracking_ingested_at",
                    "deployability_status",
                    "deployability_reason",
                    "updated_at",
                ]
            )
            return _summary_response(training_job)

        mlops_dir = extracted_dir / "_mlops"
        manifest = _read_json_list(mlops_dir / "artifact_manifest.json") if mlops_dir.exists() else []
        if not manifest:
            manifest = _scan_artifact_manifest(extracted_dir)

        missing_mlops_warning = ""
        if not mlops_dir.exists():
            missing_mlops_warning = "Training artifact does not contain _mlops metadata; generated a basic manifest."
            _write_generated_mlops_bundle(mlops_dir, training_job, manifest, missing_mlops_warning)

        training_summary = _read_json_object(mlops_dir / "training_summary.json")
        metrics_summary = _numeric_metrics(_read_json_object(mlops_dir / "metrics.json"))
        params_summary = _read_json_object(mlops_dir / "params.json")
        model_insights_summary = normalize_model_insights(_read_json_object(mlops_dir / "model_insights.json"))
        if missing_mlops_warning:
            training_summary["warning"] = missing_mlops_warning

        deployability_status, deployability_reason = compute_deployability(manifest)

        training_job.training_summary = training_summary
        training_job.metrics_summary = metrics_summary
        training_job.params_summary = params_summary
        training_job.model_insights_summary = model_insights_summary
        training_job.artifact_manifest = manifest
        training_job.deployability_status = deployability_status
        training_job.deployability_reason = deployability_reason
        training_job.tracking_ingested_at = timezone.now()
        training_job.save(
            update_fields=[
                "training_summary",
                "metrics_summary",
                "params_summary",
                "model_insights_summary",
                "artifact_manifest",
                "deployability_status",
                "deployability_reason",
                "tracking_ingested_at",
                "updated_at",
            ]
        )

        tracking_required = getattr(settings, "MLFLOW_TRACKING_REQUIRED", False)
        if not tracking_required:
            training_job.tracking_status = "skipped"
            training_job.tracking_error = "MLflow tracking is disabled; metadata was ingested into Native Registry."
            training_job.tracking_ingested_at = timezone.now()
            training_job.save(
                update_fields=[
                    "tracking_status",
                    "tracking_error",
                    "tracking_ingested_at",
                    "updated_at",
                ]
            )
            _sync_registered_versions(training_job)
            return _summary_response(training_job)

        try:
            mlflow_info = _log_to_mlflow(training_job, mlops_dir, metrics_summary, params_summary)
        except Exception as exc:
            training_job.tracking_status = "failed"
            training_job.tracking_error = _mlflow_tracking_error_message(exc)
            training_job.save(update_fields=["tracking_status", "tracking_error", "updated_at"])
            _sync_registered_versions(training_job)
            return _summary_response(training_job)

        training_job.mlflow_run_id = mlflow_info.get("run_id", "")
        training_job.mlflow_experiment_id = mlflow_info.get("experiment_id", "")
        training_job.mlflow_artifact_uri = mlflow_info.get("artifact_uri", "")
        training_job.mlflow_tracking_uri = mlflow_info.get("tracking_uri", "")
        training_job.mlflow_experiment_name = mlflow_info.get(
            "experiment_name",
            getattr(settings, "MLFLOW_EXPERIMENT_NAME", "mlops-paas-training"),
        )
        training_job.mlflow_run_name = mlflow_info.get("run_name", "")
        training_job.tracking_status = "completed"
        training_job.tracking_error = ""
        training_job.tracking_ingested_at = timezone.now()
        training_job.save(
            update_fields=[
                "mlflow_run_id",
                "mlflow_experiment_id",
                "mlflow_artifact_uri",
                "mlflow_tracking_uri",
                "mlflow_experiment_name",
                "mlflow_run_name",
                "tracking_status",
                "tracking_error",
                "tracking_ingested_at",
                "updated_at",
            ]
        )

        _sync_registered_versions(training_job)
        return _summary_response(training_job)


def serialize_training_tracking_summary(training_job: TrainingJob) -> dict:
    payload = _summary_response(training_job)
    mlflow_ui_url = getattr(settings, "MLFLOW_UI_URL", "").rstrip("/")
    payload["mlflow_run_url"] = (
        f"{mlflow_ui_url}/#/experiments/{training_job.mlflow_experiment_id}/runs/{training_job.mlflow_run_id}"
        if mlflow_ui_url and training_job.mlflow_experiment_id and training_job.mlflow_run_id
        else ""
    )
    return payload
