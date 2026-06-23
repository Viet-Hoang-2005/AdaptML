import base64
import json
import logging
import zipfile

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.text import slugify
from django.utils.text import slugify
import requests
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from django.core.cache import cache

from authentication.models import ModelAPI
from .build_adapter import get_build_adapter, DockerBuildAdapter
from .deploy_adapter import DockerDeployAdapter

logger = logging.getLogger(__name__)

MAX_MODEL_ARTIFACT_SIZE_BYTES = 512 * 1024 * 1024
SUPPORTED_BUILD_FLAVORS = {"sklearn", "xgboost"}
SUPPORTED_SOURCE_EXTENSIONS = {".pkl", ".joblib", ".xgb"}


def get_model_server_public_url():
    return getattr(settings, "MODEL_SERVER_PUBLIC_URL", "http://localhost:5000").rstrip("/")


def get_model_packager_url():
    return getattr(settings, "MODEL_PACKAGER_URL", "http://model-packager:7000").rstrip("/")


def serialize_model_api(model_api):
    return {
        "id": model_api.id,
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
        "health_url": f"{get_model_server_public_url()}/models/{model_api.id}/health",
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
    safe_model_name = model_api.name.replace(' ', '') if model_api.name else 'UnnamedModel'
    version = (model_api.version or "v1").strip().strip("/") or "v1"
    return f"{get_model_server_public_url()}/{model_api.tenant.tenant_id}/models/{safe_model_name}/{version}/predict"


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
        if source_code_file:
            model_api.source_code_file = source_code_file
        if reference_data_file:
            model_api.reference_data_file = reference_data_file

        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.save(update_fields=["artifact", "source_code_file", "reference_data_file", "endpoint_url", "updated_at"])

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
        if source_code_file:
            model_api.source_code_file = source_code_file
        if reference_data_file:
            model_api.reference_data_file = reference_data_file

        label_mapping_file = request.FILES.get("label_mapping_file")
        if label_mapping_file:
            model_api.label_mapping_file = label_mapping_file

        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.save(update_fields=["source_artifact", "source_code_file", "reference_data_file", "label_mapping_file", "endpoint_url", "updated_at"])

        # Gọi adapter chạy ngầm
        safe_name = slugify(name) or "model"
        package_filename = f"{safe_name}-mlflow-package.zip"

        # Đường dẫn dự kiến lưu file artifact sau khi build xong
        from authentication.models import model_artifact_path
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
        if source_code_file:
            model_api.source_code_file = source_code_file
        if reference_data_file:
            model_api.reference_data_file = reference_data_file

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
        model_api.save(update_fields=["model_uri", "endpoint_url", "source_code_file", "reference_data_file", "updated_at"])

        if model_api.artifact:
            DockerDeployAdapter().deploy_model(
                model_id=model_api.id,
                tenant_id=model_api.tenant.tenant_id,
                model_name=model_api.name,
                version=model_api.version or "v1"
            )

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
            DockerDeployAdapter().remove_model(model_api.id)
            
            # Delete all files under the model's folder on S3
            from django.core.files.storage import default_storage
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

        DockerDeployAdapter().remove_model(model_api.id)
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

        log_key = f"build_logs:{model_id}"

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
        if model_api.source_type != "training_job":
            return Response(
                {"error": "This endpoint only builds models registered from training jobs."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not model_api.source_artifact_uri:
            return Response(
                {"error": "Registered training model does not have a source artifact URI."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if model_api.flavor not in SUPPORTED_BUILD_FLAVORS:
            return Response({"error": "Flavor must be sklearn or xgboost."}, status=status.HTTP_400_BAD_REQUEST)

        safe_name = slugify(model_api.name) or "model"
        package_filename = f"{safe_name}-mlflow-package.zip"
        from authentication.models import model_artifact_path
        output_key = model_artifact_path(model_api, package_filename)

        model_api.status = "uploading"
        model_api.build_status = "building"
        model_api.build_error = ""
        model_api.error_message = ""
        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.save(update_fields=["status", "build_status", "build_error", "error_message", "endpoint_url", "updated_at"])

        try:
            get_build_adapter().trigger_build(
                model_id=str(model_api.id),
                flavor=model_api.flavor,
                requirements_text=model_api.requirements_text,
                source_key="",
                output_key=output_key,
                training_artifact_uri=model_api.source_artifact_uri,
            )
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
        webhook_secret = getattr(settings, "MODEL_BUILD_WEBHOOK_SECRET", "")
        if webhook_secret:
            provided_secret = request.headers.get("X-Build-Webhook-Secret", "")
            if provided_secret != webhook_secret:
                logger.warning("Rejected build webhook for model %s due to invalid secret.", model_id)
                return Response({"error": "Invalid build webhook secret."}, status=status.HTTP_403_FORBIDDEN)
        else:
            logger.warning("MODEL_BUILD_WEBHOOK_SECRET is not configured. Build webhook is insecure.")

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

            # Giả định packager đã upload file lên output_key (model_api.artifact.name)
            # Chúng ta cần đảm bảo model_uri / url map đúng với S3 bucket.
            # Ở bước trước adapter đã tính output_key.
            from authentication.models import model_artifact_path
            from django.utils.text import slugify
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

            DockerDeployAdapter().deploy_model(
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
        DockerDeployAdapter().remove_model(model_api.id)
        model_api.status = "ready" if model_api.build_status == "ready" else model_api.status
        model_api.endpoint_status = "stopped"
        model_api.endpoint_error = ""
        from django.utils import timezone
        model_api.endpoint_last_checked_at = timezone.now()
        model_api.save(update_fields=["status", "endpoint_status", "endpoint_error", "endpoint_last_checked_at", "updated_at"])
        return Response(serialize_model_api(model_api), status=status.HTTP_200_OK)


class ModelAPICheckHealthView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, model_id):
        model_api = ModelAPI.objects.filter(pk=model_id, tenant=request.user).exclude(status="disabled").first()
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)
        healthy, payload = DockerDeployAdapter().check_health(model_api.id)
        from django.utils import timezone
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
            logs = DockerDeployAdapter().endpoint_logs(model_api.id, tail=tail)
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
        removed = DockerDeployAdapter().cleanup_model(model_api.id, remove_images=remove_images)
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
