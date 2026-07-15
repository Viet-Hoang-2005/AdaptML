from common.api.exceptions import Conflict
from django.conf import settings
from django.db import IntegrityError, transaction
from rest_framework import generics, status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import ModelProject
from apps.catalog.selectors import project_for_user
from apps.catalog.services.build_metadata import save_build_metadata
from apps.catalog.services.workspace import save_workspace_file
from apps.deployment.services.builds import request_build
from apps.registry.services.versions import version_for_manual_build

from .serializers import (
    BuildMetadataReadSerializer,
    BuildMetadataWriteSerializer,
    ModelProjectSerializer,
    WorkspaceAssetSerializer,
    WorkspaceUploadSerializer,
)


class ModelProjectListCreateEndpoint(generics.ListCreateAPIView):
    serializer_class = ModelProjectSerializer

    def get_queryset(self):
        return (
            ModelProject.objects.filter(owner=self.request.user, is_active=True)
            .select_related("build_metadata")
            .prefetch_related("versions__builds", "versions__deployments")
        )

    def perform_create(self, serializer):
        try:
            with transaction.atomic():
                serializer.save(owner=self.request.user)
        except IntegrityError as exc:
            if "project_owner_name_unique" in str(exc):
                name = serializer.validated_data["name"]
                raise Conflict(f"A model project named {name} already exists.") from exc
            raise


class ModelProjectDetailEndpoint(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ModelProjectSerializer
    lookup_field = "public_id"
    lookup_url_kwarg = "project_id"

    def get_queryset(self):
        return (
            ModelProject.objects.filter(owner=self.request.user, is_active=True)
            .select_related("build_metadata")
            .prefetch_related("versions__builds", "versions__deployments")
        )

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])


class WorkspaceFilesEndpoint(APIView):
    def get(self, request, project_id, kind):
        project = project_for_user(request.user, project_id)
        return Response(WorkspaceAssetSerializer(project.workspace_assets.filter(kind=kind), many=True).data)

    def post(self, request, project_id, kind):
        project = project_for_user(request.user, project_id)
        serializer = WorkspaceUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        asset = save_workspace_file(
            project=project,
            kind=kind,
            relative_path=serializer.validated_data["relative_path"],
            uploaded_file=serializer.validated_data["file"],
        )
        return Response(WorkspaceAssetSerializer(asset).data, status=status.HTTP_201_CREATED)

    def delete(self, request, project_id, kind):
        from infrastructure.storage import S3Storage

        project = project_for_user(request.user, project_id)
        relative_path = str(request.data.get("relative_path", ""))
        asset = project.workspace_assets.filter(kind=kind, relative_path=relative_path).first()
        if not asset:
            return Response(status=status.HTTP_204_NO_CONTENT)
        S3Storage().delete(asset.s3_uri)
        asset.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class RequirementsEndpoint(APIView):
    def get(self, request, project_id):
        project = project_for_user(request.user, project_id)
        return Response({"requirements_text": project.requirements_text})

    def put(self, request, project_id):
        project = project_for_user(request.user, project_id)
        project.requirements_text = str(request.data.get("requirements_text", ""))
        project.save(update_fields=["requirements_text", "updated_at"])
        return Response({"requirements_text": project.requirements_text})


class ModelDraftCreateEndpoint(APIView):
    def post(self, request):
        serializer = BuildMetadataWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = save_build_metadata(actor=request.user, validated_data=serializer.validated_data)
        return Response(BuildMetadataReadSerializer(project).data, status=status.HTTP_201_CREATED)


class BuildMetadataEndpoint(APIView):
    def _project(self, request, project_id):
        project = project_for_user(request.user, project_id)
        if not hasattr(project, "build_metadata"):
            raise NotFound("This project has no manually uploaded build metadata.")
        return project

    def get(self, request, project_id):
        return Response(BuildMetadataReadSerializer(self._project(request, project_id)).data)

    def put(self, request, project_id):
        project = self._project(request, project_id)
        serializer = BuildMetadataWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = save_build_metadata(
            actor=request.user,
            project=project,
            validated_data=serializer.validated_data,
        )
        return Response(BuildMetadataReadSerializer(project).data)


class ProjectBuildEndpoint(APIView):
    def post(self, request, project_id):
        project = project_for_user(request.user, project_id)
        version = version_for_manual_build(project=project, actor=request.user)
        build = request_build(version, settings.BUILD_BACKEND)
        from apps.deployment.api.serializers import BuildSerializer

        return Response(BuildSerializer(build).data, status=status.HTTP_201_CREATED)
