import base64
import json
import zipfile

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.text import slugify
import requests
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ModelAPI

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

        try:
            model_api.source_artifact.open("rb")
            files = {
                "artifact": (
                    source_artifact.name,
                    model_api.source_artifact.file,
                    source_artifact.content_type or "application/octet-stream",
                )
            }
            data = {
                "flavor": flavor,
                "requirements_text": requirements_text,
                "package_name": "model",
            }
            response = requests.post(
                f"{get_model_packager_url()}/build",
                data=data,
                files=files,
                timeout=300,
            )
        except requests.RequestException as exc:
            model_api.status = "error"
            model_api.build_status = "error"
            model_api.error_message = "Unable to reach model packager service."
            model_api.build_error = str(exc)
            model_api.save()
            return Response(serialize_model_api(model_api), status=status.HTTP_502_BAD_GATEWAY)
        finally:
            try:
                model_api.source_artifact.close()
            except Exception:
                pass

        if response.status_code != 200:
            try:
                detail = response.json().get("detail") or response.json().get("error")
            except ValueError:
                detail = response.text
            model_api.status = "error"
            model_api.build_status = "error"
            model_api.error_message = "Unable to build MLflow package."
            model_api.build_error = detail or "Model packager returned an error."
            model_api.save()
            return Response(serialize_model_api(model_api), status=status.HTTP_400_BAD_REQUEST)

        safe_name = slugify(name) or "model"
        package_filename = f"{safe_name}-mlflow-package.zip"
        model_api.artifact.save(package_filename, ContentFile(response.content), save=False)
        model_api.model_uri = model_api.artifact.url
        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.status = "ready"
        model_api.build_status = "ready"
        model_api.error_message = ""
        model_api.build_error = ""
        model_api.package_preview_tree = decode_header_json(
            response.headers.get("X-Package-Preview-Tree"),
            [],
        )
        model_api.package_manifest = decode_header_json(
            response.headers.get("X-Package-Manifest"),
            {},
        )
        model_api.save()

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

        model_api.status = "disabled"
        model_api.save(update_fields=["status", "updated_at"])
        return Response({"message": "Model API has been disabled."}, status=status.HTTP_200_OK)
