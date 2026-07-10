from django.conf import settings

from integrations.hashid_utils import encode_model_id
from authentication.models import DriftMonitoringJob, ModelRoutingAlias
from registry.services.runtime import build_alias_endpoint_url, get_model_server_public_url

def _serialize_routing_alias(alias, version=None):
    return {
        "alias_name": alias.alias_name,
        "is_target": bool(version and alias.target_version_id == version.id),
        "endpoint_url": alias.endpoint_url or build_alias_endpoint_url(alias.family_id, alias.alias_name),
        "status": alias.status,
        "promoted_at": alias.promoted_at,
        "family_id": alias.family_id,
        "target_version_id": alias.target_version_id,
        "target_model_api_id": alias.target_model_api_id,
    }


def serialize_model_api(model_api):
    encoded_id = encode_model_id(model_api.id)
    return {
        "id": encoded_id,
        "name": model_api.name,
        "version": model_api.version or "v1",
        "description": model_api.description,
        "model_info": model_api.model_info,
        "access_mode": model_api.access_mode,
        "source_type": model_api.source_type,
        "source_training_job": model_api.source_training_job_id,
        "source_artifact_uri": model_api.source_artifact_uri,
        "model_uri": model_api.model_uri,
        "endpoint_url": model_api.endpoint_url,
        "health_url": f"{get_model_server_public_url()}/models/{encoded_id}/health",
        "status": model_api.status,
        "error_message": model_api.error_message,
        "endpoint_status": model_api.endpoint_status,
        "endpoint_error": model_api.endpoint_error,
        "endpoint_last_checked_at": model_api.endpoint_last_checked_at,
        "endpoint_container_name": model_api.endpoint_container_name,
        "endpoint_image_name": model_api.endpoint_image_name,
        "endpoint_public_path": model_api.endpoint_public_path,
        "endpoint_internal_path": model_api.endpoint_internal_path,
        "source_artifact": model_api.source_artifact.url if model_api.source_artifact else "",
        "source_code_file": model_api.source_code_file.url if model_api.source_code_file else "",
        "reference_data_file": model_api.reference_data_file.url if model_api.reference_data_file else "",
        "flavor": model_api.flavor,
        "requirements_text": model_api.requirements_text,
        "package_manifest": model_api.package_manifest,
        "package_preview_tree": model_api.package_preview_tree,
        "build_status": model_api.build_status,
        "build_error": model_api.build_error,
        "metrics_summary": model_api.metrics_summary or {},
        "params_summary": model_api.params_summary or {},
        "model_insights_summary": model_api.model_insights_summary or {},
        "has_model_insights": bool((model_api.model_insights_summary or {}).get("items")),
        "created_at": model_api.created_at,
        "updated_at": model_api.updated_at,
    }


def serialize_registry_metric(metric):
    return {
        "id": metric.id,
        "metric_name": metric.metric_name,
        "name": metric.metric_name,
        "metric_value": metric.metric_value,
        "value": metric.metric_value,
        "step": metric.step,
        "source": metric.source,
        "extra": metric.extra,
        "timestamp": metric.created_at,
        "created_at": metric.created_at,
    }


def _primary_metrics(metrics_summary):
    if not isinstance(metrics_summary, dict):
        return {}
    primary = {}
    for key, value in metrics_summary.items():
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            primary[key] = value
        if len(primary) >= 6:
            break
    return primary


def _version_action_state(version):
    model_api = version.model_api
    deployable = (version.deployability_status or "unknown") == "deployable"
    deployability_reason = version.deployability_reason or "Deployment is available only for versions with a supported serving artifact."
    build_disabled_reason = ""
    deploy_disabled_reason = ""

    if not deployable:
        build_disabled_reason = deployability_reason
        deploy_disabled_reason = deployability_reason
    elif not model_api:
        build_disabled_reason = "This registry version is not linked to a deployable ModelAPI record."
        deploy_disabled_reason = build_disabled_reason
    elif model_api.build_status != "ready":
        deploy_disabled_reason = "Build package before deploying this version."

    return {
        "can_build": deployable and bool(model_api),
        "can_deploy": deployable and bool(model_api) and model_api.build_status == "ready",
        "build_disabled_reason": build_disabled_reason,
        "deploy_disabled_reason": deploy_disabled_reason,
        "deployment_status": model_api.endpoint_status if model_api else "not_deployed",
        "build_status": model_api.build_status if model_api else "",
        "build_error": model_api.build_error if model_api else "",
        "endpoint_status": model_api.endpoint_status if model_api else "not_deployed",
        "endpoint_error": model_api.endpoint_error if model_api else "",
        "endpoint_last_checked_at": model_api.endpoint_last_checked_at if model_api else None,
    }


def _build_drift_summary(version):
    """Return a lightweight drift summary for a ModelVersion.

    Traverses: ModelVersion -> model_api -> drift_job -> latest DriftMonitoringResult.
    No DB migration needed. Reads existing drift models only.
    """
    model_api = version.model_api if version.model_api_id else None
    model_api_hashid = encode_model_id(version.model_api_id) if version.model_api_id else None
    drift_page_url = f"/dashboard/drift-monitoring/{model_api_hashid}" if model_api_hashid else "/dashboard/drift-monitoring"

    # Base skeleton — returned when no drift job exists
    base = {
        "configured": False,
        "status": "not_configured",
        "drift_percent": None,
        "drift_score": None,
        "dataset_drift": None,
        "latest_result_id": None,
        "drift_job_id": None,
        "report_url": None,
        "report_page_url": drift_page_url,
        "last_checked_at": None,
        "drifted_features_count": None,
        "total_features": None,
        "message": "No drift report is available for this version yet.",
    }

    if not model_api:
        return base

    # Resolve drift job — DriftMonitoringJob has OneToOneField on model_api
    try:
        drift_job = model_api.drift_job
    except (DriftMonitoringJob.DoesNotExist, AttributeError):
        return base

    # Resolve latest result (ordered by -run_at)
    latest_result = drift_job.results.first()
    if not latest_result:
        # Job configured but no results yet
        return {
            **base,
            "configured": True,
            "drift_job_id": drift_job.id,
            "message": "Drift monitoring is configured but no report has been run yet.",
        }

    # Compute drift_percent
    raw_score = latest_result.drift_score
    if raw_score is not None:
        if 0.0 <= raw_score <= 1.0:
            drift_percent = round(raw_score * 100, 2)
        elif 1.0 < raw_score <= 100.0:
            drift_percent = round(raw_score, 2)
        else:
            drift_percent = None
    else:
        drift_percent = None

    # Determine status
    if latest_result.dataset_drift is True:
        drift_status = "drift_detected"
        message = f"Latest drift check detected {drift_percent}% drift." if drift_percent is not None else "Drift detected."
    elif latest_result.dataset_drift is False:
        drift_status = "healthy"
        message = f"No drift detected. Latest drift score: {drift_percent}%." if drift_percent is not None else "No drift detected."
    elif drift_percent is not None:
        # dataset_drift flag missing but score present
        drift_status = "unknown"
        message = f"Drift score available ({drift_percent}%) but drift flag is not set."
    else:
        drift_status = "unknown"
        message = "Drift status is unknown."

    # If no report URL, override status (only when dataset_drift is non-null)
    report_url = latest_result.report_url or None
    if not report_url and drift_status in ("healthy", "drift_detected"):
        drift_status = "report_unavailable"
        message = f"{message} Report link is unavailable."

    return {
        "configured": True,
        "status": drift_status,
        "drift_percent": drift_percent,
        "drift_score": raw_score,
        "dataset_drift": latest_result.dataset_drift,
        "latest_result_id": latest_result.id,
        "drift_job_id": drift_job.id,
        "report_url": report_url,
        "report_page_url": drift_page_url,
        "last_checked_at": latest_result.run_at,
        "drifted_features_count": latest_result.drifted_features_count,
        "total_features": latest_result.total_features,
        "message": message,
    }


def serialize_registry_version(version, include_metrics=False):
    source_job = version.source_training_job
    model_api = version.model_api
    endpoint_url = (model_api.endpoint_url if model_api else "") or version.endpoint_url
    payload = {
        "id": version.id,
        "family": version.family_id,
        "family_id": version.family_id,
        "family_name": version.family.name if version.family_id else "",
        "version": version.version,
        "stage": version.stage,
        "source_type": version.source_type,
        "source_training_job": source_job.id if source_job else None,
        "source_training_job_id": source_job.id if source_job else None,
        "source_training_job_name": source_job.name if source_job else "",
        "source_training_job_status": source_job.status if source_job else "",
        "source_training_job_backend": source_job.training_backend if source_job else "",
        "artifact_uri": version.artifact_uri,
        "image_name": version.image_name,
        "endpoint_url": version.endpoint_url,
        "model_api": encode_model_id(version.model_api_id) if version.model_api_id else None,
        "training_summary": version.training_summary or {},
        "metrics_summary": version.metrics_summary or {},
        "params_summary": version.params_summary or {},
        "model_insights_summary": version.model_insights_summary or {},
        "has_model_insights": bool((version.model_insights_summary or {}).get("items")),
        "model_insights_kind": (version.model_insights_summary or {}).get("kind", ""),
        "model_insights_item_count": len((version.model_insights_summary or {}).get("items", [])),
        "artifact_manifest": version.artifact_manifest or [],
        "tracking_status": version.tracking_status or "",
        "tracking_error": version.tracking_error or "",
        "tracking_ingested_at": version.tracking_ingested_at,
        "deployability_status": version.deployability_status or "unknown",
        "deployability_reason": version.deployability_reason or "",
        "primary_metrics": _primary_metrics(version.metrics_summary or {}),
        **_version_action_state(version),
        "routing_alias_enabled": True,
        "can_promote": bool(model_api and endpoint_url),
        "routing_aliases": [
            _serialize_routing_alias(alias, version=version)
            for alias in version.routing_alias_targets.all()
        ],
        "mlflow_run_id": version.mlflow_run_id or "",
        "mlflow_experiment_id": version.mlflow_experiment_id or "",
        "mlflow_run_url": (
            f"{(getattr(settings, 'MLFLOW_UI_URL', '') or getattr(settings, 'MLFLOW_PUBLIC_URL', '')).rstrip('/')}"
            f"/#/experiments/{version.mlflow_experiment_id}/runs/{version.mlflow_run_id}"
            if version.mlflow_experiment_id
            and version.mlflow_run_id
            and (getattr(settings, "MLFLOW_UI_URL", "") or getattr(settings, "MLFLOW_PUBLIC_URL", ""))
            else ""
        ),
        "mlflow_model_uri": version.mlflow_model_uri or "",
        "mlflow_artifact_uri": version.mlflow_artifact_uri or "",
        "created_at": version.created_at,
        "updated_at": version.updated_at,
        "drift_summary": _build_drift_summary(version),
    }
    if include_metrics:
        payload["metrics"] = [serialize_registry_metric(metric) for metric in version.metrics.all()]
    return payload


def serialize_registry_family(family):
    latest_version = family.versions.order_by("-created_at").first()
    production_version = family.current_production_version or family.versions.filter(stage="production").order_by("-created_at").first()
    version_count = getattr(family, "version_count", None)
    if version_count is None:
        version_count = family.versions.count()
    aliases = {
        alias.alias_name: alias.target_version_id
        for alias in family.routing_aliases.filter(alias_name__in=ModelRoutingAlias.ALLOWED_ALIASES, status="active")
    }

    return {
        "id": family.id,
        "name": family.name,
        "display_name": family.display_name,
        "description": family.description,
        "is_active": family.is_active,
        "version_count": version_count,
        "versions_count": version_count,
        "latest_version": serialize_registry_version(latest_version) if latest_version else None,
        "production_version": serialize_registry_version(production_version) if production_version else None,
        "current_production_version": serialize_registry_version(production_version) if production_version else None,
        "production_alias_version_id": aliases.get("production"),
        "latest_alias_version_id": aliases.get("latest"),
        "champion_alias_version_id": aliases.get("champion"),
        "created_at": family.created_at,
        "updated_at": family.updated_at,
    }


def serialize_registry_history(event):
    version = event.model_version
    return {
        "id": event.id,
        "action": event.action,
        "status": event.status,
        "version": version.version if version else "",
        "version_id": version.id if version else None,
        "family": event.family_id,
        "from_stage": event.from_stage,
        "to_stage": event.to_stage,
        "message": event.message,
        "extra": event.extra,
        "actor": event.actor,
        "created_at": event.created_at,
    }


def _group_metrics(metrics):
    grouped = {}
    for metric in metrics:
        grouped.setdefault(metric.metric_name, []).append(serialize_registry_metric(metric))
    return grouped


