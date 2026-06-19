import base64
import json
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

from .models import ModelAPI
from .build_adapter import get_build_adapter

MAX_MODEL_ARTIFACT_SIZE_BYTES = 512 * 1024 * 1024
SUPPORTED_BUILD_FLAVORS = {"sklearn", "xgboost"}
SUPPORTED_SOURCE_EXTENSIONS = {".pkl", ".joblib", ".xgb"}


def get_model_server_public_url():
    return getattr(settings, "MODEL_SERVER_PUBLIC_URL", "http://localhost:5000").rstrip("/")


def get_model_packager_url():
    return getattr(settings, "MODEL_PACKAGER_URL", "http://model_packager:7000").rstrip("/")


def serialize_model_api(model_api):
    return {
        "id": model_api.id,
        "name": model_api.name,
        "description": model_api.description,
        "model_info": model_api.model_info,
        "access_mode": model_api.access_mode,
        "model_uri": model_api.model_uri,
        "endpoint_url": model_api.endpoint_url,
        "health_url": f"{get_model_server_public_url()}/models/{model_api.id}/health",
        "status": model_api.status,
        "error_message": model_api.error_message,
        "source_artifact": model_api.source_artifact.url if model_api.source_artifact else "",
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
    return f"{get_model_server_public_url()}/models/{model_api.id}/predict"


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
        artifact_file = request.FILES.get("artifact")

        if not name:
            return Response({"error": "Model name is required."}, status=status.HTTP_400_BAD_REQUEST)

        if access_mode not in {"private", "public"}:
            return Response({"error": "Access mode must be private or public."}, status=status.HTTP_400_BAD_REQUEST)

        if not artifact_file:
            return Response({"error": "Model artifact is required."}, status=status.HTTP_400_BAD_REQUEST)

        artifact_error = validate_model_artifact(artifact_file)
        if artifact_error:
            return Response({"error": artifact_error}, status=status.HTTP_400_BAD_REQUEST)

        model_api = ModelAPI.objects.create(
            tenant=request.user,
            name=name,
            description=description,
            model_info=model_info,
            access_mode=access_mode,
            status="ready",
        )
        model_api.artifact = artifact_file
        model_api.save(update_fields=["artifact", "updated_at"])

        model_api.model_uri = model_api.artifact.url
        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.save(update_fields=["model_uri", "endpoint_url", "updated_at"])

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
        source_artifact = request.FILES.get("source_artifact")

        if not name:
            return Response({"error": "Model name is required."}, status=status.HTTP_400_BAD_REQUEST)

        if access_mode not in {"private", "public"}:
            return Response({"error": "Access mode must be private or public."}, status=status.HTTP_400_BAD_REQUEST)

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
            description=description,
            model_info=model_info,
            access_mode=access_mode,
            flavor=flavor,
            requirements_text=requirements_text,
            status="uploading",
            build_status="building",
        )
        model_api.source_artifact = source_artifact
        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.save(update_fields=["source_artifact", "endpoint_url", "updated_at"])

        # Gọi adapter chạy ngầm
        safe_name = slugify(name) or "model"
        package_filename = f"{safe_name}-mlflow-package.zip"
        
        # Đường dẫn dự kiến lưu file artifact sau khi build xong
        from .models import model_artifact_path
        output_key = model_artifact_path(model_api, package_filename)
        
        try:
            adapter = get_build_adapter()
            adapter.trigger_build(
                model_id=str(model_api.id),
                flavor=flavor,
                requirements_text=requirements_text,
                source_key=model_api.source_artifact.name,
                output_key=output_key
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
        artifact_file = request.FILES.get("artifact")

        if not name:
            return Response({"error": "Model name is required."}, status=status.HTTP_400_BAD_REQUEST)

        if access_mode not in {"private", "public"}:
            return Response({"error": "Access mode must be private or public."}, status=status.HTTP_400_BAD_REQUEST)

        if artifact_file:
            artifact_error = validate_model_artifact(artifact_file)
            if artifact_error:
                return Response({"error": artifact_error}, status=status.HTTP_400_BAD_REQUEST)
            model_api.artifact = artifact_file

        model_api.name = name
        model_api.description = description
        model_api.model_info = model_info
        model_api.access_mode = access_mode
        model_api.status = "ready"
        model_api.error_message = ""
        model_api.save()

        if model_api.artifact:
            model_api.model_uri = model_api.artifact.url
        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.save(update_fields=["model_uri", "endpoint_url", "updated_at"])

        return Response(serialize_model_api(model_api), status=status.HTTP_200_OK)

    def delete(self, request, model_id):
        model_api = self.get_model(request, model_id)
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)

        force = request.query_params.get("force", "").lower() == "true"
        if force:
            from .build_adapter import DockerBuildAdapter
            # Kill build process if running
            DockerBuildAdapter().cancel_build(model_id)
            # Delete file from S3 if exists
            if model_api.artifact:
                model_api.artifact.delete(save=False)
            # Physically delete from database
            model_api.delete()
            return Response({"message": "Model API has been completely destroyed."}, status=status.HTTP_200_OK)

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


class ModelAPIBuildWebhookView(APIView):
    permission_classes = [AllowAny] # Nội bộ gọi hoặc được bảo mật bằng secret token

    def post(self, request, model_id):
        # Xác thực Webhook Secret nếu cần... (có thể dùng request.headers.get("X-Webhook-Secret"))
        model_api = ModelAPI.objects.filter(id=model_id).first()
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)

        data = request.data
        status_val = data.get("status")
        
        if status_val == "success":
            model_api.status = "ready"
            model_api.build_status = "ready"
            model_api.package_manifest = data.get("package_manifest", {})
            model_api.package_preview_tree = data.get("package_preview_tree", [])
            
            # Giả định packager đã upload file lên output_key (model_api.artifact.name)
            # Chúng ta cần đảm bảo model_uri / url map đúng với S3 bucket.
            # Ở bước trước adapter đã tính output_key.
            from .models import model_artifact_path
            from django.utils.text import slugify
            safe_name = slugify(model_api.name) or "model"
            package_filename = f"{safe_name}-mlflow-package.zip"
            model_api.artifact.name = model_artifact_path(model_api, package_filename)
            model_api.model_uri = model_api.artifact.url
            model_api.endpoint_url = build_endpoint_url(model_api)
        else:
            model_api.status = "error"
            model_api.build_status = "error"
            model_api.error_message = "Model build failed."
            model_api.build_error = data.get("error_message", "Unknown error")
            
        model_api.save()
        return Response({"message": "Webhook received successfully"}, status=status.HTTP_200_OK)

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
