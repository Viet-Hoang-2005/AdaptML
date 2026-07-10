import os
import logging
import time

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
    ModelFamily,
    ModelMetric,
    ModelRoutingAlias,
    ModelVersion,
    model_artifact_path,
)
from integrations.s3_zip_utils import upload_single_file_to_s3, get_s3_file_list, handle_upload_to_s3, delete_s3_path
from registry.serializers import (
    _group_metrics,
    serialize_model_api,
    serialize_registry_family,
    serialize_registry_history,
    serialize_registry_metric,
    serialize_registry_version,
)
from registry.services.metadata import (
    SUPPORTED_BUILD_FLAVORS,
    _apply_manual_metadata_to_model_api,
    _auto_detect_flavor,
    combine_requirements_text,
    decode_header_json,
    parse_manual_upload_metadata,
    validate_model_artifact,
    validate_source_artifact,
)
from registry.services.runtime import (
    endpoint_issue_payload,
    endpoint_payload_message,
    get_model_packager_url,
    get_model_server_internal_url,
    model_api_auth_headers,
    model_artifact_uri,
    resolve_smoke_test_url,
    build_endpoint_url,
)
from registry.services.versioning import (
    _create_registry_history,
    _deployability_error,
    _get_registry_version_for_action,
    _require_model_api,
    _sync_version_runtime_fields,
    sync_registry_version_from_model_api,
    validate_unique_model_version,
)

logger = logging.getLogger(__name__)

class RegistryFamilyListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        families = (
            ModelFamily.objects.filter(tenant=request.user, is_active=True)
            .select_related("current_production_version", "current_production_version__source_training_job")
            .prefetch_related("routing_aliases")
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
            ).prefetch_related("routing_aliases").annotate(version_count=Count("versions")),
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
            .prefetch_related("routing_alias_targets")
            .order_by("-created_at")
        )
        return Response([serialize_registry_version(version) for version in versions])


class RegistryVersionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, version_id):
        version = get_object_or_404(
            ModelVersion.objects.select_related("family", "model_api", "source_training_job").prefetch_related("metrics", "routing_alias_targets"),
            id=version_id,
            tenant=request.user,
        )
        return Response(serialize_registry_version(version, include_metrics=True))


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
            if version.model_api.build_status == "ready" and (version.model_api.model_uri or version.model_api.artifact):
                _sync_version_runtime_fields(version)
                return Response(serialize_registry_version(version), status=status.HTTP_200_OK)
            if version.source_type == "training_job":
                _trigger_training_model_build(version.model_api)
            elif version.source_type == "manual_upload":
                _trigger_manual_model_build(version.model_api)
            else:
                return Response(
                    {"error": f"Build package is not supported for source_type={version.source_type}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
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


class RegistryVersionPromoteView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def post(self, request, family_id, version_id):
        alias_name = (request.data.get("alias") or "production").strip().lower()
        if alias_name not in ModelRoutingAlias.ALLOWED_ALIASES:
            return Response(
                {
                    "success": False,
                    "reason_code": "INVALID_ALIAS",
                    "message": "Alias must be one of: production, latest, champion.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        family = get_object_or_404(ModelFamily, id=family_id, tenant=request.user)
        version = get_object_or_404(
            ModelVersion.objects.select_related("family", "model_api"),
            id=version_id,
            family=family,
            tenant=request.user,
        )
        model_response = _require_model_api(version)
        if model_response:
            return model_response

        model_api = version.model_api
        endpoint_url = model_api.endpoint_url or version.endpoint_url
        if not endpoint_url:
            return Response(
                {
                    "success": False,
                    "reason_code": "VERSION_NOT_DEPLOYED",
                    "message": "Deploy this version before promoting it to an alias.",
                },
                status=status.HTTP_409_CONFLICT,
            )

        alias_endpoint_url = build_alias_endpoint_url(family.id, alias_name)
        alias, _ = ModelRoutingAlias.objects.update_or_create(
            tenant=request.user,
            family=family,
            alias_name=alias_name,
            defaults={
                "target_version": version,
                "target_model_api": model_api,
                "endpoint_url": alias_endpoint_url,
                "status": "active",
                "promoted_by": request.user,
                "promoted_at": timezone.now(),
            },
        )

        if alias_name == "production":
            family.current_production_version = version
            family.save(update_fields=["current_production_version", "updated_at"])

        warning = ""
        if getattr(model_api, "endpoint_status", "") != "healthy":
            warning = "Endpoint has not been confirmed healthy yet. Run health check before production use."

        _create_registry_history(
            version,
            "promoted",
            "success",
            f"Version promoted to {alias_name} alias.",
            {
                "alias": alias_name,
                "alias_endpoint_url": alias_endpoint_url,
                "warning": warning,
            },
            actor=request.user.email,
        )

        response = {
            "success": True,
            "message": f"Version promoted to {alias_name} alias.",
            "alias": _serialize_routing_alias(alias, version=version),
        }
        if warning:
            response["warning"] = warning
        return Response(response, status=status.HTTP_200_OK)


class RegistryAliasResolveView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def post(self, request, family_id, alias_name):
        alias_name = alias_name.strip().lower()
        if alias_name not in ModelRoutingAlias.ALLOWED_ALIASES:
            return Response(
                {
                    "success": False,
                    "reason_code": "INVALID_ALIAS",
                    "message": "Alias must be one of: production, latest, champion.",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        family = get_object_or_404(ModelFamily, id=family_id, tenant=request.user)
        alias = get_object_or_404(
            ModelRoutingAlias.objects.select_related("target_version", "target_model_api"),
            tenant=request.user,
            family=family,
            alias_name=alias_name,
            status="active",
        )
        target_version = alias.target_version
        model_api = alias.target_model_api or target_version.model_api
        endpoint_url = (model_api.endpoint_url if model_api else "") or target_version.endpoint_url
        if not endpoint_url:
            return Response(
                {
                    "success": False,
                    "reason_code": "ALIAS_TARGET_NOT_DEPLOYED",
                    "message": "Alias target version does not have a deployed endpoint.",
                    "alias": _serialize_routing_alias(alias),
                },
                status=status.HTTP_409_CONFLICT,
            )

        target_url = resolve_smoke_test_url(endpoint_url)
        try:
            prediction_response = requests.post(
                target_url,
                json=request.data,
                headers=model_api_auth_headers(model_api),
                timeout=15,
            )
            try:
                payload = prediction_response.json()
            except ValueError:
                payload = {"raw": prediction_response.text}
            return Response(payload, status=prediction_response.status_code)
        except requests.exceptions.RequestException as exc:
            payload = endpoint_issue_payload(
                exc,
                endpoint_url=endpoint_url,
                internal_url=target_url,
                action="alias prediction",
            )
            payload["reason_code"] = "ALIAS_TARGET_UNREACHABLE"
            payload["message"] = "Alias target endpoint is currently unreachable."
            payload["alias"] = _serialize_routing_alias(alias)
            return Response(payload, status=status.HTTP_502_BAD_GATEWAY)


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
            raise ValueError("Flavor must be one of: xgboost, scikit-learn (sklearn), pytorch, keras.")

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


def _trigger_manual_model_build(model_api):
    if model_api.source_type != "manual_upload":
        raise ValueError("This endpoint only builds manually uploaded model artifacts.")
    if not model_api.source_artifact:
        raise ValueError("Manual upload model is missing its source artifact.")
    if model_api.flavor not in SUPPORTED_BUILD_FLAVORS:
        raise ValueError("Flavor must be one of: xgboost, scikit-learn (sklearn), pytorch, keras.")

    safe_name = slugify(model_api.name) or "model"
    package_filename = f"{safe_name}-mlflow-package.zip"
    output_key = model_artifact_path(model_api, package_filename)
    label_mapping_key = model_api.label_mapping_file.name if model_api.label_mapping_file else None

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
        source_key=model_api.source_artifact.name,
        output_key=output_key,
        label_mapping_key=label_mapping_key,
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

        tenant_id = request.user.tenant_id
        model_hash_id = encode_model_id(model_api.id)
        safe_version = version.replace(' ', '') or "v1"

        try:
            if source_code_file:
                code_prefix = f"users/{tenant_id}/models/{model_hash_id}/{safe_version}/code/"
                handle_upload_to_s3(source_code_file, code_prefix)
            if reference_data_file:
                ref_prefix = f"users/{tenant_id}/models/{model_hash_id}/{safe_version}/references/"
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
        metadata = parse_manual_upload_metadata(request)

        if not name:
            return Response({"error": "Model name is required."}, status=status.HTTP_400_BAD_REQUEST)

        if access_mode not in {"private", "public"}:
            return Response({"error": "Access mode must be private or public."}, status=status.HTTP_400_BAD_REQUEST)
        duplicate_error = validate_unique_model_version(request.user, name, version)
        if duplicate_error:
            return Response({"error": duplicate_error}, status=status.HTTP_400_BAD_REQUEST)

        if flavor not in SUPPORTED_BUILD_FLAVORS:
            return Response({"error": "Flavor must be one of: xgboost, scikit-learn (sklearn), pytorch, keras."}, status=status.HTTP_400_BAD_REQUEST)

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
            metrics_summary=metadata.get("metrics_summary") or {},
            params_summary=metadata.get("params_summary") or {},
            model_insights_summary=metadata.get("model_insights_summary") or {},
            status="uploading",
            build_status="building",
        )
        _apply_manual_metadata_to_model_api(model_api, metadata)
        model_api.source_artifact = source_artifact

        tenant_id = request.user.tenant_id
        model_hash_id = encode_model_id(model_api.id)
        safe_version = version.replace(' ', '') or "v1"

        try:
            if source_code_file:
                code_prefix = f"users/{tenant_id}/models/{model_hash_id}/{safe_version}/code/"
                handle_upload_to_s3(source_code_file, code_prefix)
            if reference_data_file:
                ref_prefix = f"users/{tenant_id}/models/{model_hash_id}/{safe_version}/references/"
                handle_upload_to_s3(reference_data_file, ref_prefix)
        except Exception as e:
            model_api.delete()
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        label_mapping_file = request.FILES.get("label_mapping_file")
        if label_mapping_file:
            model_api.label_mapping_file = label_mapping_file

        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.save(update_fields=[
            "source_artifact",
            "label_mapping_file",
            "endpoint_url",
            "metrics_summary",
            "params_summary",
            "model_insights_summary",
            "updated_at",
        ])
        sync_registry_version_from_model_api(model_api)

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
            payload = serialize_model_api(model_api)
            payload["metadata_warnings"] = metadata["warnings"]
            return Response(payload, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        payload = serialize_model_api(model_api)
        payload["metadata_warnings"] = metadata["warnings"]
        return Response(payload, status=status.HTTP_201_CREATED)


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

        previous_version = model_api.version or "v1"
        name = (request.data.get("name") or model_api.name).strip()
        description = (request.data.get("description") or "").strip()
        model_info = (request.data.get("model_info") or "").strip()
        access_mode = (request.data.get("access_mode") or model_api.access_mode).strip().lower()
        version = (request.data.get("version") or model_api.version or "v1").strip() or "v1"
        artifact_file = request.FILES.get("artifact")
        source_code_file = request.FILES.get("source_code_file")
        reference_data_file = request.FILES.get("reference_data_file")
        endpoint_route_changed = version != previous_version
        endpoint_artifact_changed = bool(artifact_file)

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

        tenant_id = request.user.tenant_id
        model_hash_id = encode_model_id(model_api.id)
        safe_version = version.replace(' ', '') or "v1"

        try:
            if source_code_file:
                code_prefix = f"users/{tenant_id}/models/{model_hash_id}/{safe_version}/code/"
                handle_upload_to_s3(source_code_file, code_prefix)
            if reference_data_file:
                ref_prefix = f"users/{tenant_id}/models/{model_hash_id}/{safe_version}/references/"
                handle_upload_to_s3(reference_data_file, ref_prefix)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        model_api.name = name
        model_api.description = description
        model_api.model_info = model_info
        model_api.access_mode = access_mode
        model_api.version = version
        if endpoint_artifact_changed:
            model_api.status = "ready"
            model_api.error_message = ""
        model_api.save()

        update_fields = ["endpoint_url", "updated_at"]

        if endpoint_artifact_changed:
            model_api.model_uri = model_artifact_uri(model_api)
            update_fields.append("model_uri")
        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.save(update_fields=update_fields)

        if endpoint_artifact_changed or endpoint_route_changed:
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
            tenant_id = model_api.tenant.tenant_id
            model_hash_id = encode_model_id(model_api.id)
            model_prefix = f'users/{tenant_id}/models/{model_hash_id}/'

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
            try:
                get_deploy_adapter().cleanup_model(model_api.id, remove_images=True)
            except Exception as e:
                logging.getLogger(__name__).error(f"Failed to cleanup model image: {e}")
            
            get_deploy_adapter().wait_for_removal(model_api.id)
            model_api.delete()
            return Response({"message": "Model API has been completely destroyed."}, status=status.HTTP_200_OK)

        get_deploy_adapter().remove_model(model_api.id)
        get_deploy_adapter().cleanup_model(model_api.id, remove_images=True)
        get_deploy_adapter().wait_for_removal(model_api.id)
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
        
        try:
            client = cache.client.get_client()
            logs = client.lrange(f"build_logs:{hashid_str}", offset, offset + limit - 1)
            if not logs:
                logs = client.lrange(f"build_logs:{model_id}", offset, offset + limit - 1)
                
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
            if task_type == "TEST_ZIP":
                model_api.model_uri = model_artifact_uri(model_api)
            else:
                model_api.artifact.name = model_artifact_path(model_api, package_filename)
                model_api.model_uri = model_artifact_uri(model_api)
            model_api.endpoint_url = build_endpoint_url(model_api)
            harbor_url = os.environ.get("HARBOR_REGISTRY_URL", "registry.mlops-nids-nt114.id.vn").strip().rstrip("/")
            harbor_project = getattr(settings, "HARBOR_USER_PROJECT", "user-images")
            custom_tag = f"{model_api.tenant.tenant_id.lower()}-model-{encode_model_id(model_api.id).lower()}:latest"
            model_api.endpoint_image_name = f"{harbor_url}/{harbor_project}/{custom_tag}"
            logger.info("Model %s build marked ready. Artifact key=%s", model_id, model_api.artifact.name)
        else:
            model_api.status = "error"
            model_api.build_status = "error"
            model_api.error_message = "Model build failed."
            model_api.build_error = data.get("error_message", "Unknown error")
            logger.warning("Model %s build marked error: %s", model_id, model_api.build_error)

        model_api.save()
        try:
            sync_registry_version_from_model_api(model_api)
        except Exception:
            logger.exception("Failed to sync registry version after build webhook for model %s.", model_id)
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
        
        tenant_id = request.user.tenant_id
        model_hash_id = encode_model_id(model_api.id)
        safe_version = model_api.version.replace(' ', '') if model_api.version else 'v1'
        prefix = f'users/{tenant_id}/models/{model_hash_id}/{safe_version}/code/'
        
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
            
        tenant_id = request.user.tenant_id
        model_hash_id = encode_model_id(model_api.id)
        safe_version = model_api.version.replace(' ', '') if model_api.version else 'v1'
        
        # Ensure file_path doesn't have leading slash
        if file_path.startswith('/'):
            file_path = file_path[1:]
            
        key = f'users/{tenant_id}/models/{model_hash_id}/{safe_version}/code/{file_path}'
        
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
            
        tenant_id = request.user.tenant_id
        model_hash_id = encode_model_id(model_api.id)
        safe_version = model_api.version.replace(' ', '') if model_api.version else 'v1'
        
        if file_path.startswith('/'):
            file_path = file_path[1:]
            
        key = f'users/{tenant_id}/models/{model_hash_id}/{safe_version}/code/{file_path}'
        try:
            delete_s3_path(key)
            return Response({"message": "Deleted successfully"})
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
