import os

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response

from authentication.models import ModelAPI, ModelDeploymentHistory, ModelFamily, ModelVersion

def _copy_model_api_metadata_to_version(version, model_api):
    version.metrics_summary = model_api.metrics_summary or {}
    version.params_summary = model_api.params_summary or {}
    version.model_insights_summary = model_api.model_insights_summary or {}
    version.tracking_status = "skipped"
    if model_api.source_artifact:
        version.artifact_manifest = [
            {
                "path": os.path.basename(model_api.source_artifact.name),
                "kind": "model",
                "size_bytes": getattr(model_api.source_artifact, "size", 0) or 0,
                "sha256": "",
            }
        ]
    version.deployability_status = "deployable"
    version.deployability_reason = "Manual upload contains a supported model artifact."


def _copy_training_tracking_fields(version, training_job):
    version.training_summary = training_job.training_summary or {}
    version.metrics_summary = training_job.metrics_summary or {}
    version.params_summary = training_job.params_summary or {}
    version.model_insights_summary = training_job.model_insights_summary or {}
    version.artifact_manifest = training_job.artifact_manifest or []
    version.tracking_status = training_job.tracking_status or ""
    version.tracking_error = training_job.tracking_error or ""
    version.tracking_ingested_at = training_job.tracking_ingested_at
    version.deployability_status = training_job.deployability_status or "unknown"
    version.deployability_reason = training_job.deployability_reason or ""

    for field in ("mlflow_run_id", "mlflow_experiment_id", "mlflow_model_uri", "mlflow_artifact_uri"):
        value = getattr(training_job, field, None)
        if value:
            setattr(version, field, value)


def sync_registry_version_from_model_api(model_api, training_job=None):
    """Create or update the Native Registry version row backing a ModelAPI."""
    family, _ = ModelFamily.objects.get_or_create(
        tenant=model_api.tenant,
        name=model_api.name,
        defaults={
            "display_name": model_api.name,
            "description": model_api.description or model_api.model_info or "",
        },
    )
    changed_family_fields = []
    if not family.display_name:
        family.display_name = model_api.name
        changed_family_fields.append("display_name")
    if model_api.description and family.description != model_api.description:
        family.description = model_api.description
        changed_family_fields.append("description")
    if changed_family_fields:
        changed_family_fields.append("updated_at")
        family.save(update_fields=changed_family_fields)

    version, _ = ModelVersion.objects.get_or_create(
        tenant=model_api.tenant,
        family=family,
        version=model_api.version or "v1",
        defaults={
            "model_api": model_api,
            "source_type": model_api.source_type or "manual_upload",
            "source_training_job": training_job or model_api.source_training_job,
            "artifact_uri": model_api.source_artifact_uri or model_api.model_uri or "",
            "image_name": model_api.endpoint_image_name or "",
            "endpoint_url": model_api.endpoint_url or "",
            "stage": "candidate",
        },
    )

    version.model_api = model_api
    version.source_type = model_api.source_type or version.source_type or "manual_upload"
    version.source_training_job = training_job or model_api.source_training_job or version.source_training_job
    version.artifact_uri = model_api.source_artifact_uri or model_api.model_uri or version.artifact_uri or ""
    version.image_name = model_api.endpoint_image_name or version.image_name or ""
    version.endpoint_url = model_api.endpoint_url or version.endpoint_url or ""
    if version.stage == "none":
        version.stage = "candidate"

    if training_job:
        _copy_training_tracking_fields(version, training_job)
    elif version.source_type == "manual_upload":
        _copy_model_api_metadata_to_version(version, model_api)

    version.save()
    return version


def validate_unique_model_version(tenant, name, version, exclude_model_id=None):
    queryset = ModelAPI.objects.filter(
        tenant=tenant,
        name=name,
        version=version or "v1",
    ).exclude(status="disabled")
    if exclude_model_id:
        queryset = queryset.exclude(id=exclude_model_id)
    if queryset.exists():
        return f"A model named '{name}' with version '{version or 'v1'}' already exists."
    return ""


def _get_registry_version_for_action(request, version_id):
    return get_object_or_404(
        ModelVersion.objects.select_related("family", "model_api", "source_training_job"),
        id=version_id,
        tenant=request.user,
    )


def _deployability_error(version, action):
    if (version.deployability_status or "unknown") == "deployable":
        return None
    return Response(
        {
            "error": f"This version cannot {action} because it is not deployable.",
            "message": "Deployment is available only for versions with a supported serving artifact. Track-only versions can still be reviewed and compared.",
            "deployability_status": version.deployability_status or "unknown",
            "deployability_reason": version.deployability_reason or "Deployability has not been computed for this version yet.",
        },
        status=status.HTTP_400_BAD_REQUEST,
    )


def _require_model_api(version):
    if version.model_api:
        return None
    return Response(
        {"error": "This registry version is not linked to a ModelAPI record."},
        status=status.HTTP_400_BAD_REQUEST,
    )


def _sync_version_runtime_fields(version):
    model_api = version.model_api
    if not model_api:
        return version
    version.artifact_uri = model_api.source_artifact_uri or model_api.model_uri or version.artifact_uri or ""
    version.image_name = model_api.endpoint_image_name or version.image_name or ""
    version.endpoint_url = model_api.endpoint_url or version.endpoint_url or ""
    version.save(update_fields=["artifact_uri", "image_name", "endpoint_url", "updated_at"])
    return version


def _create_registry_history(version, action, status_value="success", message="", extra=None, actor=""):
    if not version.family_id:
        return
    ModelDeploymentHistory.objects.create(
        tenant=version.tenant,
        family=version.family,
        model_version=version,
        model_api=version.model_api,
        action=action,
        status=status_value,
        message=message,
        extra=extra or {},
        actor=actor,
    )


