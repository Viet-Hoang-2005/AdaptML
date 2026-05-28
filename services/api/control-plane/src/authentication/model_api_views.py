import zipfile

from django.conf import settings
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ModelAPI

MAX_MODEL_ARTIFACT_SIZE_BYTES = 512 * 1024 * 1024


def get_model_server_public_url():
    return getattr(settings, "MODEL_SERVER_PUBLIC_URL", "http://localhost:5000").rstrip("/")


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
        model_api.endpoint_url = f"{get_model_server_public_url()}/models/{model_api.id}/predict"
        model_api.save(update_fields=["model_uri", "endpoint_url", "updated_at"])

        return Response(serialize_model_api(model_api), status=status.HTTP_201_CREATED)


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
        model_api.endpoint_url = f"{get_model_server_public_url()}/models/{model_api.id}/predict"
        model_api.save(update_fields=["model_uri", "endpoint_url", "updated_at"])

        return Response(serialize_model_api(model_api), status=status.HTTP_200_OK)

    def delete(self, request, model_id):
        model_api = self.get_model(request, model_id)
        if not model_api:
            return Response({"error": "Model API not found."}, status=status.HTTP_404_NOT_FOUND)

        model_api.status = "disabled"
        model_api.save(update_fields=["status", "updated_at"])
        return Response({"message": "Model API has been disabled."}, status=status.HTTP_200_OK)
