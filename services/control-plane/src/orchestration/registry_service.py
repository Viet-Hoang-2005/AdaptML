"""
registry_service.py
-------------------
Idempotent helpers for the Model Evolution / Registry layer.

All functions are designed to be called from within existing lifecycle views
(model_api_views.py, training_job_views.py) and management commands without
breaking the existing Train → Register → Build → Deploy → Predict flow.

Key rules:
- No function replaces or deletes existing ModelAPI rows.
- All writes are non-destructive / idempotent.
- Metrics are parsed from METRIC_JSON lines in TrainingJob.training_logs.
- No real MLflow Model Registry API is called (we use the package format only).
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

from authentication.models import (
    ModelAPI,
    ModelDeploymentHistory,
    ModelFamily,
    ModelMetric,
    ModelVersion,
    TrainingJob,
)

# ─── Regex used by training_job_views.py to parse METRIC_JSON lines ──────────
_METRIC_JSON_RE = re.compile(r"METRIC_JSON:\s*(\{.+\})")


# ─── Core sync helpers ────────────────────────────────────────────────────────

def sync_model_registry_for_model_api(
    model_api: ModelAPI,
    actor: str = "",
) -> tuple[ModelFamily, ModelVersion]:
    """
    Idempotently create / fetch the ModelFamily and ModelVersion that correspond
    to the given ModelAPI record.

    Returns (family, version).  Safe to call multiple times — never duplicates.
    """
    # 1. Family — keyed by (tenant, model name)
    family, _ = ModelFamily.objects.get_or_create(
        tenant=model_api.tenant,
        name=model_api.name,
        defaults={
            "display_name": model_api.name,
            "description": model_api.description or "",
            "is_active": True,
        },
    )

    # 2. Version — keyed by (family, version string)
    version_str = (model_api.version or "v1").strip() or "v1"

    # Determine source_type from ModelAPI.source_type
    raw_source = getattr(model_api, "source_type", "manual_upload") or "manual_upload"
    if raw_source == "training_job":
        source_type = "training_job"
    else:
        source_type = "manual_upload"

    # Build snapshot values from the current ModelAPI state.
    artifact_uri = ""
    if model_api.model_uri:
        artifact_uri = model_api.model_uri
    image_name = model_api.endpoint_image_name or ""
    endpoint_url = model_api.endpoint_url or ""

    version_obj, created = ModelVersion.objects.get_or_create(
        family=family,
        version=version_str,
        defaults={
            "tenant": model_api.tenant,
            "model_api": model_api,
            "source_type": source_type,
            "artifact_uri": artifact_uri,
            "image_name": image_name,
            "endpoint_url": endpoint_url,
            "stage": "none",
        },
    )

    if not created:
        # Sync mutable snapshot fields in case they changed.
        updated_fields = []
        if version_obj.model_api_id != model_api.pk:
            version_obj.model_api = model_api
            updated_fields.append("model_api")
        if artifact_uri and version_obj.artifact_uri != artifact_uri:
            version_obj.artifact_uri = artifact_uri
            updated_fields.append("artifact_uri")
        if image_name and version_obj.image_name != image_name:
            version_obj.image_name = image_name
            updated_fields.append("image_name")
        if endpoint_url and version_obj.endpoint_url != endpoint_url:
            version_obj.endpoint_url = endpoint_url
            updated_fields.append("endpoint_url")
        if updated_fields:
            updated_fields.append("updated_at")
            version_obj.save(update_fields=updated_fields)

    # Attach source_training_job if the ModelAPI was registered from a TrainingJob
    if source_type == "training_job" and model_api.source_training_job_id and not version_obj.source_training_job_id:
        version_obj.source_training_job_id = model_api.source_training_job_id
        version_obj.save(update_fields=["source_training_job", "updated_at"])

    return family, version_obj


# ─── History recording ────────────────────────────────────────────────────────

def record_history(
    model_version: ModelVersion,
    action: str,
    status: str = "success",
    message: str = "",
    extra: Optional[Dict[str, Any]] = None,
    actor: str = "",
    from_stage: Optional[str] = None,
    to_stage: Optional[str] = None,
) -> ModelDeploymentHistory:
    """
    Append a single immutable history event.  Always creates a new row — history
    is append-only and must never be updated.
    """
    return ModelDeploymentHistory.objects.create(
        tenant=model_version.tenant,
        family=model_version.family,
        model_version=model_version,
        model_api=model_version.model_api,
        action=action,
        status=status,
        from_stage=from_stage or model_version.stage,
        to_stage=to_stage or model_version.stage,
        message=message,
        extra=extra or {},
        actor=actor,
    )


# ─── Metrics sync ────────────────────────────────────────────────────────────

def _parse_metrics_from_logs(logs: str) -> list[dict]:
    """
    Parse METRIC_JSON lines from a TrainingJob.training_logs string.

    Expected format per line:
        METRIC_JSON: {"metric_name": <str>, "metric_value": <float>, "step": <int|null>}
    or as emitted by the training runner:
        METRIC_JSON: {"accuracy": 0.95, "loss": 0.12}   (dict of name→value, step implied 0)
    """
    parsed = []
    for match in _METRIC_JSON_RE.finditer(logs):
        try:
            obj = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue

        if isinstance(obj, dict):
            # Structured format: {"metric_name": ..., "metric_value": ..., "step": ...}
            if "metric_name" in obj and "metric_value" in obj:
                try:
                    parsed.append({
                        "metric_name": str(obj["metric_name"]),
                        "metric_value": float(obj["metric_value"]),
                        "step": int(obj.get("step") or 0),
                    })
                except (ValueError, TypeError):
                    pass
            else:
                # Flat dict format: {"accuracy": 0.95, "loss": 0.12}
                step = int(obj.pop("step", 0) or 0)
                for k, v in obj.items():
                    if k.startswith("_"):
                        continue
                    try:
                        parsed.append({
                            "metric_name": str(k),
                            "metric_value": float(v),
                            "step": step,
                        })
                    except (ValueError, TypeError):
                        pass
    return parsed


def sync_metrics_for_version(model_version: ModelVersion) -> int:
    """
    Parse METRIC_JSON lines from the linked TrainingJob and bulk-create ModelMetric
    rows.  Uses get_or_create to avoid duplicates (idempotent).

    Returns the count of newly created metric rows.
    """
    job: Optional[TrainingJob] = model_version.source_training_job
    if job is None:
        return 0

    logs = job.training_logs or ""
    if not logs:
        return 0

    metrics = _parse_metrics_from_logs(logs)
    created_count = 0

    for m in metrics:
        _, created = ModelMetric.objects.get_or_create(
            model_version=model_version,
            metric_name=m["metric_name"],
            step=m["step"],
            defaults={
                "tenant": model_version.tenant,
                "family": model_version.family,
                "metric_value": m["metric_value"],
                "source": "training_log",
            },
        )
        if created:
            created_count += 1

    return created_count


# ─── Promotion / Rollback ─────────────────────────────────────────────────────

def promote_version(
    family: ModelFamily,
    version_obj: ModelVersion,
    actor: str = "",
    message: str = "",
) -> ModelVersion:
    """
    Registry-level promotion: marks the given version as 'production' and demotes
    the previous production version to 'staging'.  Does NOT touch Traefik routes.
    """
    prev = family.current_production_version

    if prev and prev.pk != version_obj.pk:
        old_stage = prev.stage
        prev.stage = "staging"
        prev.save(update_fields=["stage", "updated_at"])
        record_history(prev, "archived", actor=actor, from_stage=old_stage, to_stage="staging",
                       message="Demoted to staging by promotion of a newer version.")

    old_stage = version_obj.stage
    version_obj.stage = "production"
    version_obj.save(update_fields=["stage", "updated_at"])

    family.current_production_version = version_obj
    family.save(update_fields=["current_production_version", "updated_at"])

    record_history(version_obj, "promoted", actor=actor, from_stage=old_stage, to_stage="production",
                   message=message or "Promoted to production.")
    return version_obj


def rollback_family(
    family: ModelFamily,
    target_version: ModelVersion,
    actor: str = "",
    message: str = "",
) -> ModelVersion:
    """
    Registry-level rollback: set target_version as the production version.
    Records rollback history.  Does NOT touch Traefik routes.
    """
    current = family.current_production_version

    if current and current.pk != target_version.pk:
        old_stage = current.stage
        current.stage = "staging"
        current.save(update_fields=["stage", "updated_at"])
        record_history(current, "archived", actor=actor, from_stage=old_stage, to_stage="staging",
                       message="Demoted to staging by rollback.")

    old_stage = target_version.stage
    target_version.stage = "production"
    target_version.save(update_fields=["stage", "updated_at"])

    family.current_production_version = target_version
    family.save(update_fields=["current_production_version", "updated_at"])

    record_history(target_version, "rolled_back", actor=actor, from_stage=old_stage, to_stage="production",
                   message=message or "Rolled back to this version.")
    return target_version
