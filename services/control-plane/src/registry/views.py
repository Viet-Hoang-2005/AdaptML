import os
import base64
import json
import logging
import time
import zipfile

import requests
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db.models import Count
from django.utils import timezone
from django.utils.text import slugify

from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from django.core.cache import cache

from django.shortcuts import get_object_or_404
from deployment.build_adapter import get_build_adapter, DockerBuildAdapter
from deployment.deploy_adapter import get_deploy_adapter
from integrations.hashid_utils import encode_model_id, decode_model_id
from registry.compare_service import build_version_compare_payload

from authentication.models import (
    ModelAPI,
    ModelDeploymentHistory,
    ModelFamily,
    ModelMetric,
    ModelVersion,
    model_artifact_path,
)
from integrations.s3_zip_utils import upload_single_file_to_s3, get_s3_file_list, handle_upload_to_s3, delete_s3_path

logger = logging.getLogger(__name__)

MAX_MODEL_ARTIFACT_SIZE_BYTES = 512 * 1024 * 1024
SUPPORTED_BUILD_FLAVORS = {"sklearn", "xgboost"}
SUPPORTED_SOURCE_EXTENSIONS = {".pkl", ".joblib", ".xgb"}


def get_model_server_public_url():
    return getattr(settings, "MODEL_SERVER_PUBLIC_URL", "http://localhost:5000").rstrip("/")


def get_model_packager_url():
    return getattr(settings, "MODEL_PACKAGER_URL", "http://model-packager:7000").rstrip("/")


def get_model_server_internal_url():
    return getattr(settings, "MODEL_SERVER_INTERNAL_URL", "").rstrip("/")


def resolve_smoke_test_url(endpoint_url):
    internal_base = get_model_server_internal_url()
    public_base = get_model_server_public_url()
    if internal_base and endpoint_url.startswith(public_base):
        return endpoint_url.replace(public_base, internal_base, 1)
    return endpoint_url


def endpoint_issue_payload(exc, *, endpoint_url="", internal_url="", action="health check"):
    detail = str(exc)
    if isinstance(exc, requests.exceptions.Timeout):
        return {
            "success": False,
            "status": "timeout",
            "reason_code": "ENDPOINT_TIMEOUT",
            "message": f"The model endpoint did not respond before the {action} timeout.",
            "endpoint_url": endpoint_url,
            "internal_url": internal_url,
            "technical_detail": detail,
        }
    if "NameResolutionError" in detail or "Failed to resolve" in detail or "Temporary failure in name resolution" in detail:
        return {
            "success": False,
            "status": "not_running",
            "reason_code": "ENDPOINT_CONTAINER_NOT_FOUND",
            "message": (
                "The model endpoint container is not running in the local Docker network. "
                "Run deploy again or start the local model server runtime."
            ),
            "endpoint_url": endpoint_url,
            "internal_url": internal_url,
            "technical_detail": detail,
        }
    return {
        "success": False,
        "status": "not_reachable",
        "reason_code": "ENDPOINT_NOT_REACHABLE",
        "message": "The model endpoint is not reachable from the control-plane container.",
        "endpoint_url": endpoint_url,
        "internal_url": internal_url,
        "technical_detail": detail,
    }


def endpoint_payload_message(payload, fallback):
    if isinstance(payload, dict):
        return payload.get("message") or payload.get("error") or fallback
    return fallback


def model_api_auth_headers(model_api):
    api_key = getattr(getattr(model_api, "tenant", None), "api_key", "") if model_api else ""
    return {"X-API-Key": api_key} if api_key else {}


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


def serialize_registry_version(version, include_metrics=False):
    source_job = version.source_training_job
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
        "artifact_manifest": version.artifact_manifest or [],
        "tracking_status": version.tracking_status or "",
        "tracking_error": version.tracking_error or "",
        "tracking_ingested_at": version.tracking_ingested_at,
        "deployability_status": version.deployability_status or "unknown",
        "deployability_reason": version.deployability_reason or "",
        "primary_metrics": _primary_metrics(version.metrics_summary or {}),
        **_version_action_state(version),
        "mlflow_run_id": version.mlflow_run_id or "",
        "mlflow_experiment_id": version.mlflow_experiment_id or "",
        "mlflow_run_url": getattr(settings, "MLFLOW_PUBLIC_URL", "").rstrip("/") + f"/#/experiments/{version.mlflow_experiment_id}/runs/{version.mlflow_run_id}" if version.mlflow_experiment_id and version.mlflow_run_id and getattr(settings, "MLFLOW_PUBLIC_URL", "") else "",
        "mlflow_model_uri": version.mlflow_model_uri or "",
        "mlflow_artifact_uri": version.mlflow_artifact_uri or "",
        "created_at": version.created_at,
        "updated_at": version.updated_at,
    }
    if include_metrics:
        payload["metrics"] = [serialize_registry_metric(metric) for metric in version.metrics.all()]
    return payload


def _copy_training_tracking_fields(version, training_job):
    version.training_summary = training_job.training_summary or {}
    version.metrics_summary = training_job.metrics_summary or {}
    version.params_summary = training_job.params_summary or {}
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

    version.save()
    return version


def serialize_registry_family(family):
    latest_version = family.versions.order_by("-created_at").first()
    production_version = family.current_production_version or family.versions.filter(stage="production").order_by("-created_at").first()
    version_count = getattr(family, "version_count", None)
    if version_count is None:
        version_count = family.versions.count()

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


class RegistryFamilyListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        families = (
            ModelFamily.objects.filter(tenant=request.user, is_active=True)
            .select_related("current_production_version", "current_production_version__source_training_job")
            .annotate(version_count=Count("versions"))
            .order_by("-updated_at")
        )
        return Response([serialize_registry_family(family) for family in families])


class RegistryFamilyDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, family_id):
        family = get_object_or_404(
            ModelFamily.objects.select_related(
                "current_production_version",
                "current_production_version__source_training_job",
            ).annotate(version_count=Count("versions")),
            id=family_id,
            tenant=request.user,
        )
        return Response(serialize_registry_family(family))


class RegistryFamilyVersionsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, family_id):
        family = get_object_or_404(ModelFamily, id=family_id, tenant=request.user)
        versions = (
            ModelVersion.objects.filter(family=family, tenant=request.user)
            .select_related("family", "model_api", "source_training_job")
            .order_by("-created_at")
        )
        return Response([serialize_registry_version(version) for version in versions])


class RegistryVersionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, version_id):
        version = get_object_or_404(
            ModelVersion.objects.select_related("family", "model_api", "source_training_job").prefetch_related("metrics"),
            id=version_id,
            tenant=request.user,
        )
        return Response(serialize_registry_version(version, include_metrics=True))


def _group_metrics(metrics):
    grouped = {}
    for metric in metrics:
        grouped.setdefault(metric.metric_name, []).append(serialize_registry_metric(metric))
    return grouped


class RegistryVersionMetricsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, version_id, family_id=None):
        filters = {"id": version_id, "tenant": request.user}
        if family_id is not None:
            filters["family_id"] = family_id
        version = get_object_or_404(ModelVersion, **filters)
        metrics = version.metrics.filter(tenant=request.user).order_by("metric_name", "step", "created_at")
        return Response(_group_metrics(metrics))


class RegistryFamilyHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, family_id):
        family = get_object_or_404(ModelFamily, id=family_id, tenant=request.user)
        history = (
            ModelDeploymentHistory.objects.filter(family=family, tenant=request.user)
            .select_related("model_version", "model_api")
            .order_by("-created_at")
        )
        return Response([serialize_registry_history(event) for event in history])


class RegistryFamilyCompareView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, family_id):
        family = get_object_or_404(ModelFamily, id=family_id, tenant=request.user, is_active=True)
        left_id = request.query_params.get("left")
        right_id = request.query_params.get("right")
        if not left_id or not right_id:
            return Response({"error": "Both left and right version ids are required."}, status=status.HTTP_400_BAD_REQUEST)
        if left_id == right_id:
            return Response({"error": "Choose two different versions to compare."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            left_id_int = int(left_id)
            right_id_int = int(right_id)
        except (TypeError, ValueError):
            return Response({"error": "Version ids must be integers."}, status=status.HTTP_400_BAD_REQUEST)

        left_version = get_object_or_404(ModelVersion, id=left_id_int, family=family, tenant=request.user)
        right_version = get_object_or_404(ModelVersion, id=right_id_int, family=family, tenant=request.user)
        return Response(build_version_compare_payload(family, left_version, right_version), status=status.HTTP_200_OK)


class RegistryVersionHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, version_id):
        version = get_object_or_404(ModelVersion, id=version_id, tenant=request.user)
        history = (
            ModelDeploymentHistory.objects.filter(model_version=version, tenant=request.user)
            .select_related("model_version", "model_api")
            .order_by("-created_at")
        )
        return Response([serialize_registry_history(event) for event in history])


class RegistryVersionBuildPackageView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, version_id):
        version = _get_registry_version_for_action(request, version_id)
        deployability_response = _deployability_error(version, "build a deployment package")
        if deployability_response:
            return deployability_response
        model_response = _require_model_api(version)
        if model_response:
            return model_response

        try:
            _trigger_training_model_build(version.model_api)
            version.model_api.refresh_from_db()
            _sync_version_runtime_fields(version)
            _create_registry_history(
                version,
                "built",
                "running",
                "Build package requested from Model Evolution.",
                actor=request.user.email,
            )
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            version.model_api.status = "error"
            version.model_api.build_status = "error"
            version.model_api.error_message = "Unable to start build process."
            version.model_api.build_error = str(exc)
            version.model_api.save()
            _create_registry_history(
                version,
                "failed",
                "failed",
                f"Build package failed to start: {exc}",
                actor=request.user.email,
            )
            return Response(serialize_registry_version(version), status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(serialize_registry_version(version), status=status.HTTP_200_OK)


class RegistryVersionDeployView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, version_id):
        version = _get_registry_version_for_action(request, version_id)
        deployability_response = _deployability_error(version, "deploy")
        if deployability_response:
            return deployability_response
        model_response = _require_model_api(version)
        if model_response:
            return model_response
        model_api = version.model_api
        if model_api.build_status != "ready":
            return Response(
                {
                    "error": "Build package before deploying this version.",
                    "build_status": model_api.build_status,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        get_deploy_adapter().deploy_model(
            model_id=model_api.id,
            tenant_id=model_api.tenant.tenant_id,
            model_name=model_api.name,
            version=model_api.version or "v1",
        )
        model_api.refresh_from_db()
        _sync_version_runtime_fields(version)
        _create_registry_history(
            version,
            "deployed",
            "running",
            "Deploy endpoint requested from Model Evolution.",
            actor=request.user.email,
        )
        return Response(serialize_registry_version(version), status=status.HTTP_200_OK)


class RegistryVersionCheckHealthView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, version_id):
        version = _get_registry_version_for_action(request, version_id)
        model_response = _require_model_api(version)
        if model_response:
            return model_response
        model_api = version.model_api
        if not (model_api.endpoint_url or version.endpoint_url):
            return Response({"error": "This version does not have a deployed endpoint URL."}, status=status.HTTP_400_BAD_REQUEST)

        healthy, payload = get_deploy_adapter().check_health(model_api.id)
        model_api.endpoint_last_checked_at = timezone.now()
        if healthy:
            model_api.status = "deployed"
            model_api.endpoint_status = "healthy"
            model_api.endpoint_error = ""
            history_status = "success"
            message = "Endpoint health check passed."
        else:
            model_api.status = "unhealthy"
            model_api.endpoint_status = "unhealthy"
            model_api.endpoint_error = endpoint_payload_message(payload, "Endpoint health check failed.")
            history_status = "failed"
            message = model_api.endpoint_error
        model_api.save(update_fields=["status", "endpoint_status", "endpoint_error", "endpoint_last_checked_at", "updated_at"])
        _sync_version_runtime_fields(version)
        _create_registry_history(
            version,
            "health_checked",
            history_status,
            message,
            {"health": payload},
            actor=request.user.email,
        )
        response = serialize_registry_version(version)
        response["health"] = payload
        response["message"] = message
        if isinstance(payload, dict):
            response["reason_code"] = payload.get("reason_code", "")
            response["technical_detail"] = payload.get("technical_detail", "")
        return Response(response, status=status.HTTP_200_OK)


class RegistryVersionSmokeTestView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def post(self, request, version_id):
        version = _get_registry_version_for_action(request, version_id)
        model_response = _require_model_api(version)
        if model_response:
            return model_response
        endpoint_url = version.model_api.endpoint_url or version.endpoint_url
        if not endpoint_url:
            return Response({"error": "This version does not have a deployed endpoint URL."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(request.data, dict) or "features" not in request.data:
            return Response(
                {"error": "Smoke test request must include a features object.", "example": {"features": {"f1": 1, "f2": 2}}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        started = time.perf_counter()
        request_url = resolve_smoke_test_url(endpoint_url)
        try:
            prediction_response = requests.post(
                request_url,
                json=request.data,
                headers=model_api_auth_headers(version.model_api),
                timeout=15,
            )
            latency_ms = int((time.perf_counter() - started) * 1000)
            try:
                payload = prediction_response.json()
            except ValueError:
                payload = {"raw": prediction_response.text}
        except requests.exceptions.RequestException as exc:
            payload = endpoint_issue_payload(
                exc,
                endpoint_url=endpoint_url,
                internal_url=request_url,
                action="smoke-test",
            )
            _create_registry_history(
                version,
                "failed",
                "failed",
                payload["message"],
                {"reason_code": payload.get("reason_code"), "technical_detail": payload.get("technical_detail", "")},
                actor=request.user.email,
            )
            return Response(payload, status=status.HTTP_200_OK)

        success = 200 <= prediction_response.status_code < 300
        result = {
            "success": success,
            "endpoint_url": endpoint_url,
            "prediction": payload.get("prediction") if isinstance(payload, dict) else None,
            "confidence": payload.get("confidence") if isinstance(payload, dict) else None,
            "latency_ms": latency_ms,
            "status_code": prediction_response.status_code,
            "response": payload,
        }
        _create_registry_history(
            version,
            "health_checked",
            "success" if success else "failed",
            "Smoke test completed." if success else "Smoke test returned an error response.",
            {"status_code": prediction_response.status_code, "latency_ms": latency_ms},
            actor=request.user.email,
        )
        return Response(result, status=status.HTTP_200_OK if success else status.HTTP_400_BAD_REQUEST)


def validate_model_artifact(artifact_file):
    if artifact_file.size > MAX_MODEL_ARTIFACT_SIZE_BYTES:
        return "Model artifact must be 512MB or smaller."

    if not artifact_file.name.lower().endswith(".zip"):
        return "Model artifact must be a .zip package containing an MLmodel file."

    try:
        with zipfile.ZipFile(artifact_file) as archive:
            has_mlmodel = any(
                name.rstrip("/").endswith("MLmodel")
                for name in archive.namelist()
                if not name.endswith("/")
            )
    except zipfile.BadZipFile:
        return "Model artifact is not a valid zip file."
    finally:
        artifact_file.seek(0)

    if not has_mlmodel:
        return "Model artifact must contain an MLmodel file."

    return ""


def validate_source_artifact(artifact_file, flavor):
    if artifact_file.size > MAX_MODEL_ARTIFACT_SIZE_BYTES:
        return "Model artifact must be 512MB or smaller."

    filename = artifact_file.name.lower()
    if not any(filename.endswith(extension) for extension in SUPPORTED_SOURCE_EXTENSIONS):
        return "Raw model artifact must be .pkl, .joblib, or .xgb."

    if flavor == "sklearn" and not filename.endswith((".pkl", ".joblib")):
        return "Scikit-learn flavor requires a .pkl or .joblib artifact."

    if flavor == "xgboost" and not filename.endswith((".pkl", ".joblib", ".xgb")):
        return "XGBoost flavor requires a .xgb, .pkl, or .joblib artifact."

    return ""


def decode_header_json(encoded_value, fallback):
    if not encoded_value:
        return fallback

    try:
        raw = base64.urlsafe_b64decode(encoded_value.encode("ascii"))
        return json.loads(raw.decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return fallback


def combine_requirements_text(request):
    text = (request.data.get("requirements_text") or "").strip()
    requirements_file = request.FILES.get("requirements_file")

    if not requirements_file:
        return text

    try:
        file_text = requirements_file.read().decode("utf-8").strip()
    except UnicodeDecodeError:
        raise ValueError("requirements.txt must be UTF-8 text.")
    finally:
        requirements_file.seek(0)

    if text and file_text:
        return f"{text}\n{file_text}"
    return text or file_text


def build_endpoint_url(model_api):
    version = (model_api.version or "v1").strip().strip("/") or "v1"
    hashid_str = encode_model_id(model_api.id)
    return f"{get_model_server_public_url()}/{model_api.tenant.tenant_id}/models/{hashid_str}/{version}/predict"


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


def _auto_detect_flavor(model_api):
    """Infer build flavor from training job artifact_manifest when not explicitly set."""
    job = model_api.source_training_job
    if not job:
        return None
    manifest = job.artifact_manifest or []
    paths = [str(m.get("path", "") if isinstance(m, dict) else m).lower() for m in manifest]
    if any(p.endswith(".pkl") or p.endswith(".joblib") for p in paths):
        return "sklearn"
    if any(p.endswith(".xgb") or p.endswith(".bst") or p.endswith(".json") and "xgboost" in p for p in paths):
        return "xgboost"
    # Fallback: check training_summary for flavor hint
    summary = job.training_summary or {}
    flavor_hint = str(summary.get("flavor", "")).lower()
    if flavor_hint in SUPPORTED_BUILD_FLAVORS:
        return flavor_hint
    return None


def _trigger_training_model_build(model_api):
    if model_api.source_type != "training_job":
        raise ValueError("This endpoint only builds models registered from training jobs.")
    if not model_api.source_artifact_uri:
        raise ValueError("Registered training model does not have a source artifact URI.")
    # Auto-detect flavor from training job manifest if not set
    if model_api.flavor not in SUPPORTED_BUILD_FLAVORS:
        detected = _auto_detect_flavor(model_api)
        if detected:
            model_api.flavor = detected
            model_api.save(update_fields=["flavor", "updated_at"])
        else:
            raise ValueError("Flavor must be sklearn or xgboost.")

    safe_name = slugify(model_api.name) or "model"
    package_filename = f"{safe_name}-mlflow-package.zip"
    output_key = model_artifact_path(model_api, package_filename)

    model_api.status = "uploading"
    model_api.build_status = "building"
    model_api.build_error = ""
    model_api.error_message = ""
    model_api.endpoint_url = build_endpoint_url(model_api)
    model_api.save(update_fields=["status", "build_status", "build_error", "error_message", "endpoint_url", "updated_at"])

    get_build_adapter().trigger_build(
        model_id=str(model_api.id),
        flavor=model_api.flavor,
        requirements_text=model_api.requirements_text,
        source_key="",
        output_key=output_key,
        training_artifact_uri=model_api.source_artifact_uri,
    )
    return model_api


class ModelAPIListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        models = ModelAPI.objects.filter(tenant=request.user).exclude(status="disabled")
        return Response({"models": [serialize_model_api(model) for model in models]}, status=status.HTTP_200_OK)

    def post(self, request):
        name = (request.data.get("name") or "").strip()
        description = (request.data.get("description") or "").strip()
        model_info = (request.data.get("model_info") or "").strip()
        access_mode = (request.data.get("access_mode") or "private").strip().lower()
        version = (request.data.get("version") or "v1").strip() or "v1"
        artifact_file = request.FILES.get("artifact")
        source_code_file = request.FILES.get("source_code_file")
        reference_data_file = request.FILES.get("reference_data_file")

        if not name:
            return Response({"error": "Model name is required."}, status=status.HTTP_400_BAD_REQUEST)

        if access_mode not in {"private", "public"}:
            return Response({"error": "Access mode must be private or public."}, status=status.HTTP_400_BAD_REQUEST)
        duplicate_error = validate_unique_model_version(request.user, name, version)
        if duplicate_error:
            return Response({"error": duplicate_error}, status=status.HTTP_400_BAD_REQUEST)

        if not artifact_file:
            return Response({"error": "Model artifact is required."}, status=status.HTTP_400_BAD_REQUEST)

        artifact_error = validate_model_artifact(artifact_file)
        if artifact_error:
            return Response({"error": artifact_error}, status=status.HTTP_400_BAD_REQUEST)

        model_api = ModelAPI.objects.create(
            tenant=request.user,
            name=name,
            version=version,
            description=description,
            model_info=model_info,
            access_mode=access_mode,
            source_type="manual_upload",
            status="uploading",
            build_status="building",
        )
        model_api.artifact = artifact_file

        user_name = request.user.email.split('@')[0] if getattr(request.user, 'email', None) else request.user.tenant_id
        safe_name = name.replace(' ', '') or "UnnamedModel"
        safe_version = version.replace(' ', '') or "v1"

        try:
            if source_code_file:
                code_prefix = f"{user_name}/models/{safe_name}/{safe_version}/code/"
                handle_upload_to_s3(source_code_file, code_prefix)
            if reference_data_file:
                ref_prefix = f"{user_name}/models/{safe_name}/{safe_version}/references/"
                handle_upload_to_s3(reference_data_file, ref_prefix)
        except Exception as e:
            model_api.delete()
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.save(update_fields=["artifact", "endpoint_url", "updated_at"])

        try:
            get_build_adapter().trigger_build(
                model_id=str(model_api.id),
                flavor="advanced_zip",
                requirements_text="",
                source_key=model_api.artifact.name,
                output_key="",
                task_type="TEST_ZIP",
            )
        except Exception as exc:
            model_api.status = "error"
            model_api.build_status = "error"
            model_api.error_message = "Unable to start package validation."
            model_api.build_error = str(exc)
            model_api.save()
            return Response(serialize_model_api(model_api), status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(serialize_model_api(model_api), status=status.HTTP_201_CREATED)


class ModelAPIBuildView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        name = (request.data.get("name") or "").strip()
        description = (request.data.get("description") or "").strip()
        model_info = (request.data.get("model_info") or "").strip()
        access_mode = (request.data.get("access_mode") or "private").strip().lower()
        flavor = (request.data.get("flavor") or "").strip().lower()
        version = (request.data.get("version") or "v1").strip() or "v1"
        source_artifact = request.FILES.get("source_artifact")
        source_code_file = request.FILES.get("source_code_file")
        reference_data_file = request.FILES.get("reference_data_file")

        if not name:
            return Response({"error": "Model name is required."}, status=status.HTTP_400_BAD_REQUEST)

        if access_mode not in {"private", "public"}:
            return Response({"error": "Access mode must be private or public."}, status=status.HTTP_400_BAD_REQUEST)
        duplicate_error = validate_unique_model_version(request.user, name, version)
        if duplicate_error:
            return Response({"error": duplicate_error}, status=status.HTTP_400_BAD_REQUEST)

        if flavor not in SUPPORTED_BUILD_FLAVORS:
            return Response({"error": "Flavor must be sklearn or xgboost."}, status=status.HTTP_400_BAD_REQUEST)

        if not source_artifact:
            return Response({"error": "Raw model artifact is required."}, status=status.HTTP_400_BAD_REQUEST)

        artifact_error = validate_source_artifact(source_artifact, flavor)
        if artifact_error:
            return Response({"error": artifact_error}, status=status.HTTP_400_BAD_REQUEST)

        try:
            requirements_text = combine_requirements_text(request)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        model_api = ModelAPI.objects.create(
            tenant=request.user,
            name=name,
            version=version,
            description=description,
            model_info=model_info,
            access_mode=access_mode,
            source_type="manual_upload",
            flavor=flavor,
            requirements_text=requirements_text,
            status="uploading",
            build_status="building",
        )
        model_api.source_artifact = source_artifact

        user_name = request.user.email.split('@')[0] if getattr(request.user, 'email', None) else request.user.tenant_id
        safe_name = name.replace(' ', '') or "UnnamedModel"
        safe_version = version.replace(' ', '') or "v1"

        try:
            if source_code_file:
                code_prefix = f"{user_name}/models/{safe_name}/{safe_version}/code/"
                handle_upload_to_s3(source_code_file, code_prefix)
            if reference_data_file:
                ref_prefix = f"{user_name}/models/{safe_name}/{safe_version}/references/"
                handle_upload_to_s3(reference_data_file, ref_prefix)
        except Exception as e:
            model_api.delete()
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        label_mapping_file = request.FILES.get("label_mapping_file")
        if label_mapping_file:
            model_api.label_mapping_file = label_mapping_file

        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.save(update_fields=["source_artifact", "label_mapping_file", "endpoint_url", "updated_at"])

        # Gọi adapter chạy ngầm
        safe_name = slugify(name) or "model"
        package_filename = f"{safe_name}-mlflow-package.zip"

        # Đường dẫn dự kiến lưu file artifact sau khi build xong
        output_key = model_artifact_path(model_api, package_filename)

        try:
            adapter = get_build_adapter()
            label_mapping_key = model_api.label_mapping_file.name if model_api.label_mapping_file else None
            adapter.trigger_build(
                model_id=str(model_api.id),
                flavor=flavor,
                requirements_text=requirements_text,
                source_key=model_api.source_artifact.name,
                output_key=output_key,
                label_mapping_key=label_mapping_key
            )
        except Exception as exc:
            model_api.status = "error"
            model_api.build_status = "error"
            model_api.error_message = "Unable to start build process."
            model_api.build_error = str(exc)
            model_api.save()
            return Response(serialize_model_api(model_api), status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(serialize_model_api(model_api), status=status.HTTP_201_CREATED)


class ModelAPIPackagePreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, model_id):
        model_api = ModelAPI.objects.filter(id=model_id, tenant=request.user).exclude(status="disabled").first()
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response(
            {
                "model_id": model_api.id,
                "package_manifest": model_api.package_manifest,
                "package_preview_tree": model_api.package_preview_tree,
                "build_status": model_api.build_status,
                "build_error": model_api.build_error,
            },
            status=status.HTTP_200_OK,
        )


class ModelAPIDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_model(self, request, model_id):
        return ModelAPI.objects.filter(id=model_id, tenant=request.user).exclude(status="disabled").first()

    def get(self, request, model_id):
        model_api = self.get_model(request, model_id)
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(serialize_model_api(model_api), status=status.HTTP_200_OK)

    def put(self, request, model_id):
        model_api = self.get_model(request, model_id)
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)

        name = (request.data.get("name") or model_api.name).strip()
        description = (request.data.get("description") or "").strip()
        model_info = (request.data.get("model_info") or "").strip()
        access_mode = (request.data.get("access_mode") or model_api.access_mode).strip().lower()
        version = (request.data.get("version") or model_api.version or "v1").strip() or "v1"
        artifact_file = request.FILES.get("artifact")
        source_code_file = request.FILES.get("source_code_file")
        reference_data_file = request.FILES.get("reference_data_file")

        if not name:
            return Response({"error": "Model name is required."}, status=status.HTTP_400_BAD_REQUEST)

        if access_mode not in {"private", "public"}:
            return Response({"error": "Access mode must be private or public."}, status=status.HTTP_400_BAD_REQUEST)
        duplicate_error = validate_unique_model_version(request.user, name, version, exclude_model_id=model_api.id)
        if duplicate_error:
            return Response({"error": duplicate_error}, status=status.HTTP_400_BAD_REQUEST)

        if artifact_file:
            artifact_error = validate_model_artifact(artifact_file)
            if artifact_error:
                return Response({"error": artifact_error}, status=status.HTTP_400_BAD_REQUEST)
            model_api.artifact = artifact_file

        user_name = request.user.email.split('@')[0] if getattr(request.user, 'email', None) else request.user.tenant_id
        safe_name = name.replace(' ', '') or "UnnamedModel"
        safe_version = version.replace(' ', '') or "v1"

        try:
            if source_code_file:
                code_prefix = f"{user_name}/models/{safe_name}/{safe_version}/code/"
                handle_upload_to_s3(source_code_file, code_prefix)
            if reference_data_file:
                ref_prefix = f"{user_name}/models/{safe_name}/{safe_version}/references/"
                handle_upload_to_s3(reference_data_file, ref_prefix)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        model_api.name = name
        model_api.description = description
        model_api.model_info = model_info
        model_api.access_mode = access_mode
        model_api.version = version
        model_api.status = "ready"
        model_api.error_message = ""
        model_api.save()

        if model_api.artifact:
            model_api.model_uri = model_api.artifact.url
        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.save(update_fields=["model_uri", "endpoint_url", "updated_at"])

        if model_api.artifact:
            get_deploy_adapter().deploy_model(
                model_id=model_api.id,
                tenant_id=model_api.tenant.tenant_id,
                model_name=model_api.name,
                version=model_api.version or "v1"
            )

        return Response(serialize_model_api(model_api), status=status.HTTP_200_OK)

    def patch(self, request, model_id):
        """Partial update — only updates fields provided (e.g. requirements_text)."""
        model_api = self.get_model(request, model_id)
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)

        update_fields = ["updated_at"]

        if "requirements_text" in request.data:
            model_api.requirements_text = request.data.get("requirements_text") or ""
            update_fields.append("requirements_text")

        model_api.save(update_fields=update_fields)
        return Response(serialize_model_api(model_api), status=status.HTTP_200_OK)

    def delete(self, request, model_id):
        model_api = self.get_model(request, model_id)
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)

        force = request.query_params.get("force", "").lower() == "true"
        if force:
            # Kill build process if running
            DockerBuildAdapter().cancel_build(model_id)
            # Kill endpoint container
            get_deploy_adapter().remove_model(model_api.id)
            
            # Delete all files under the model's folder on S3
            email_prefix = model_api.tenant.email.split('@')[0]
            safe_model_name = model_api.name.replace(' ', '') if model_api.name else 'UnnamedModel'
            model_prefix = f'{email_prefix}/models/{safe_model_name}/'

            if hasattr(default_storage, 'bucket'):
                # S3 Storage: Delete all objects with the prefix
                bucket = default_storage.bucket
                bucket.objects.filter(Prefix=model_prefix).delete()
            else:
                # Fallback for local storage
                if model_api.artifact:
                    model_api.artifact.delete(save=False)
                if model_api.source_artifact:
                    model_api.source_artifact.delete(save=False)
                if model_api.source_code_file:
                    model_api.source_code_file.delete(save=False)
                if model_api.reference_data_file:
                    model_api.reference_data_file.delete(save=False)
                if model_api.label_mapping_file:
                    model_api.label_mapping_file.delete(save=False)

            # Physically delete from database
            model_api.delete()
            return Response({"message": "Model API has been completely destroyed."}, status=status.HTTP_200_OK)

        get_deploy_adapter().remove_model(model_api.id)
        model_api.status = "disabled"
        model_api.save(update_fields=["status", "updated_at"])
        return Response({"message": "Model API has been disabled."}, status=status.HTTP_200_OK)


class ModelAPIBuildLogsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, model_id):
        model_api = ModelAPI.objects.filter(id=model_id, tenant=request.user).first()
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)

        offset = int(request.query_params.get("offset", 0))
        limit = int(request.query_params.get("limit", 100))

        hashid_str = encode_model_id(model_id)
        log_key = f"build_logs:{hashid_str}"

        try:
            # Lấy logs từ Redis (lrange là O(N))
            logs = cache.client.get_client().lrange(log_key, offset, offset + limit - 1)
            # logs là list of bytes
            logs_str = [log.decode('utf-8') for log in logs]

            return Response({
                "logs": logs_str,
                "next_offset": offset + len(logs),
                "build_status": model_api.build_status,
                "build_error": model_api.build_error,
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": f"Failed to fetch logs: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ModelAPITriggerBuildView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, model_id):
        model_api = ModelAPI.objects.filter(id=model_id, tenant=request.user).exclude(status="disabled").first()
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            _trigger_training_model_build(model_api)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            model_api.status = "error"
            model_api.build_status = "error"
            model_api.error_message = "Unable to start build process."
            model_api.build_error = str(exc)
            model_api.save()
            return Response(serialize_model_api(model_api), status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(serialize_model_api(model_api), status=status.HTTP_200_OK)


class ModelAPIBuildWebhookView(APIView):
    permission_classes = [AllowAny] # Nội bộ gọi hoặc được bảo mật bằng secret token

    def post(self, request, model_id):
        # Xác thực Webhook Secret nếu cần... (có thể dùng request.headers.get("X-Webhook-Secret"))
        webhook_secret = getattr(settings, "CONTROL_PLANE_WEBHOOK_SECRET", "")
        if webhook_secret:
            provided_secret = request.headers.get("X-Build-Webhook-Secret", "") or request.headers.get("Authorization", "").replace("Bearer ", "")
            if provided_secret != webhook_secret:
                logger.warning("Rejected build webhook for model %s due to invalid secret.", model_id)
                return Response({"error": "Invalid build webhook secret."}, status=status.HTTP_403_FORBIDDEN)
        else:
            logger.warning("CONTROL_PLANE_WEBHOOK_SECRET is not configured. Build webhook is insecure.")

        model_api = ModelAPI.objects.filter(id=model_id).first()
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)

        data = request.data
        status_val = data.get("status")
        logger.info("Received build webhook for model %s with status=%s", model_id, status_val)

        if status_val == "success":
            task_type = data.get("task_type", "BUILD")
            model_api.status = "ready"
            model_api.build_status = "ready"
            model_api.build_error = ""
            model_api.error_message = ""
            model_api.package_manifest = data.get("package_manifest", {})
            model_api.package_preview_tree = data.get("package_preview_tree", [])

            safe_name = slugify(model_api.name) or "model"
            package_filename = f"{safe_name}-mlflow-package.zip"
            bucket_name = getattr(settings, "AWS_STORAGE_BUCKET_NAME", "") or getattr(settings, "AWS_BUCKET_NAME", "")
            if task_type == "TEST_ZIP":
                model_api.model_uri = (
                    f"s3://{bucket_name}/{model_api.artifact.name}"
                    if bucket_name and model_api.artifact
                    else model_api.artifact.url
                )
            else:
                model_api.artifact.name = model_artifact_path(model_api, package_filename)
                model_api.model_uri = (
                    f"s3://{bucket_name}/{model_api.artifact.name}"
                    if bucket_name
                    else model_api.artifact.url
                )
            model_api.endpoint_url = build_endpoint_url(model_api)
            harbor_url = os.environ.get("HARBOR_REGISTRY_URL", "harbor.mlops-nids-nt114.id.vn").strip().rstrip("/")
            custom_tag = f"{model_api.tenant.tenant_id.lower()}-model-{encode_model_id(model_api.id).lower()}:latest"
            model_api.endpoint_image_name = f"{harbor_url}/mlops-paas/{custom_tag}"
            logger.info("Model %s build marked ready. Artifact key=%s", model_id, model_api.artifact.name)
        else:
            model_api.status = "error"
            model_api.build_status = "error"
            model_api.error_message = "Model build failed."
            model_api.build_error = data.get("error_message", "Unknown error")
            logger.warning("Model %s build marked error: %s", model_id, model_api.build_error)

        model_api.save()
        return Response({"message": "Webhook received successfully"}, status=status.HTTP_200_OK)

class ModelAPIDeployView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, model_id):
        try:
            model_api = ModelAPI.objects.get(pk=model_id, tenant=request.user)
            if model_api.build_status and model_api.build_status != "ready":
                return Response({"error": "Model build is not ready yet."}, status=status.HTTP_400_BAD_REQUEST)

            get_deploy_adapter().deploy_model(
                model_id=model_api.id,
                tenant_id=model_api.tenant.tenant_id,
                model_name=model_api.name,
                version=model_api.version or "v1"
            )
            model_api.refresh_from_db()
            return Response(serialize_model_api(model_api), status=status.HTTP_200_OK)
        except ModelAPI.DoesNotExist:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)


class ModelAPIRedeployView(ModelAPIDeployView):
    pass


class ModelAPIStopEndpointView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, model_id):
        model_api = ModelAPI.objects.filter(pk=model_id, tenant=request.user).exclude(status="disabled").first()
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)
        get_deploy_adapter().remove_model(model_api.id)
        model_api.status = "ready" if model_api.build_status == "ready" else model_api.status
        model_api.endpoint_status = "stopped"
        model_api.endpoint_error = ""
        model_api.endpoint_last_checked_at = timezone.now()
        model_api.save(update_fields=["status", "endpoint_status", "endpoint_error", "endpoint_last_checked_at", "updated_at"])
        return Response(serialize_model_api(model_api), status=status.HTTP_200_OK)


class ModelAPICheckHealthView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, model_id):
        model_api = ModelAPI.objects.filter(pk=model_id, tenant=request.user).exclude(status="disabled").first()
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)
        healthy, payload = get_deploy_adapter().check_health(model_api.id)
        model_api.endpoint_last_checked_at = timezone.now()
        if healthy:
            model_api.status = "deployed"
            model_api.endpoint_status = "healthy"
            model_api.endpoint_error = ""
        else:
            model_api.status = "unhealthy"
            model_api.endpoint_status = "unhealthy"
            model_api.endpoint_error = str(payload)
        model_api.save(update_fields=["status", "endpoint_status", "endpoint_error", "endpoint_last_checked_at", "updated_at"])
        response = serialize_model_api(model_api)
        response["health"] = payload
        return Response(response, status=status.HTTP_200_OK)


class ModelAPIEndpointLogsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, model_id):
        model_api = ModelAPI.objects.filter(pk=model_id, tenant=request.user).exclude(status="disabled").first()
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)
        try:
            tail = min(max(int(request.query_params.get("tail", 300)), 1), 1000)
        except ValueError:
            tail = 300
        try:
            logs = get_deploy_adapter().endpoint_logs(model_api.id, tail=tail)
        except Exception as exc:
            return Response({"error": f"Unable to read endpoint logs: {exc}"}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "model_id": model_api.id,
                "container_name": model_api.endpoint_container_name or f"mlops_paas_model_endpoint_{model_api.id}",
                "logs": logs,
            },
            status=status.HTTP_200_OK,
        )


class ModelAPICleanupView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, model_id):
        model_api = ModelAPI.objects.filter(pk=model_id, tenant=request.user).exclude(status="disabled").first()
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)
        remove_images = bool(request.data.get("remove_images", False))
        removed = get_deploy_adapter().cleanup_model(model_api.id, remove_images=remove_images)
        if model_api.endpoint_status != "not_deployed":
            model_api.endpoint_status = "stopped"
            model_api.status = "ready" if model_api.build_status == "ready" else model_api.status
            model_api.save(update_fields=["endpoint_status", "status", "updated_at"])
        return Response({"removed": removed, "model": serialize_model_api(model_api)}, status=status.HTTP_200_OK)


class ModelAPICancelBuildView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, model_id):
        try:
            model_api = ModelAPI.objects.get(pk=model_id, tenant=request.user)
            adapter = get_build_adapter()
            adapter.cancel_build(str(model_api.id))

            # Delete the model so it doesn't clutter the UI since it was cancelled
            model_api.delete()
            return Response({"status": "cancelled and deleted"}, status=status.HTTP_200_OK)
        except ModelAPI.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

class SourceCodeFileListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, model_id):
        model_api = get_object_or_404(ModelAPI, id=model_id, tenant=request.user)
        
        user_name = request.user.email.split('@')[0] if getattr(request.user, 'email', None) else request.user.tenant_id
        safe_model_name = model_api.name.replace(' ', '') if model_api.name else 'UnnamedModel'
        safe_version = model_api.version.replace(' ', '') if model_api.version else 'v1'
        prefix = f'{user_name}/models/{safe_model_name}/{safe_version}/code/'
        
        files = get_s3_file_list(prefix)
            
        return Response(files)

class SourceCodeFileUploadView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, model_id):
        model_api = get_object_or_404(ModelAPI, id=model_id, tenant=request.user)
        
        file_obj = request.FILES.get('file')
        file_path = request.data.get('path') # The relative path of the file
        if not file_obj or not file_path:
            return Response({"error": "file and path are required"}, status=status.HTTP_400_BAD_REQUEST)
            
        user_name = request.user.email.split('@')[0] if getattr(request.user, 'email', None) else request.user.tenant_id
        safe_model_name = model_api.name.replace(' ', '') if model_api.name else 'UnnamedModel'
        safe_version = model_api.version.replace(' ', '') if model_api.version else 'v1'
        
        # Ensure file_path doesn't have leading slash
        if file_path.startswith('/'):
            file_path = file_path[1:]
            
        key = f'{user_name}/models/{safe_model_name}/{safe_version}/code/{file_path}'
        
        bucket_name = getattr(settings, 'AWS_STORAGE_BUCKET_NAME', 'mlops-paas-artifacts')
        
        try:
            upload_single_file_to_s3(file_obj, key)
            return Response({"message": "File updated successfully"})
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def delete(self, request, model_id):
        model_api = get_object_or_404(ModelAPI, id=model_id, tenant=request.user)
        
        file_path = request.data.get('path')
        if not file_path:
            return Response({"error": "path is required"}, status=status.HTTP_400_BAD_REQUEST)
            
        user_name = request.user.email.split('@')[0] if getattr(request.user, 'email', None) else request.user.tenant_id
        safe_model_name = model_api.name.replace(' ', '') if model_api.name else 'UnnamedModel'
        safe_version = model_api.version.replace(' ', '') if model_api.version else 'v1'
        
        if file_path.startswith('/'):
            file_path = file_path[1:]
            
        key = f'{user_name}/models/{safe_model_name}/{safe_version}/code/{file_path}'
        try:
            delete_s3_path(key)
            return Response({"message": "Deleted successfully"})
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
