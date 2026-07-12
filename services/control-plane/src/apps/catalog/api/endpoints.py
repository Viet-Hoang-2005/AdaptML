from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import ModelProject
from apps.catalog.selectors import project_for_user
from apps.catalog.services.workspace import save_workspace_file

from .serializers import ModelProjectSerializer, WorkspaceAssetSerializer, WorkspaceUploadSerializer


class ModelProjectListCreateEndpoint(generics.ListCreateAPIView):
    serializer_class = ModelProjectSerializer

    def get_queryset(self):
        return ModelProject.objects.filter(owner=self.request.user, is_active=True)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


class ModelProjectDetailEndpoint(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ModelProjectSerializer
    lookup_field = "public_id"
    lookup_url_kwarg = "project_id"

    def get_queryset(self):
        return ModelProject.objects.filter(owner=self.request.user, is_active=True)

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
