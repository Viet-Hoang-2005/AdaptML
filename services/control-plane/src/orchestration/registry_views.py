from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.models import ModelDeploymentHistory, ModelFamily, ModelMetric, ModelVersion
from .mlflow_utils import build_mlflow_run_url
from .registry_service import promote_version, rollback_family


def serialize_model_version(version: ModelVersion):
    mlflow_run_url = build_mlflow_run_url(
        run_id=version.mlflow_run_id,
        experiment_id=version.mlflow_experiment_id,
    )
    return {
        "id": version.id,
        "version": version.version,
        "source_type": version.source_type,
        "source_training_job_id": version.source_training_job_id,
        "artifact_uri": version.artifact_uri,
        "image_name": version.image_name,
        "endpoint_url": version.endpoint_url,
        "stage": version.stage,
        "mlflow_run_id": version.mlflow_run_id or "",
        "mlflow_experiment_id": version.mlflow_experiment_id or "",
        "mlflow_run_url": mlflow_run_url or "",
        "mlflow_model_uri": version.mlflow_model_uri or "",
        "mlflow_artifact_uri": version.mlflow_artifact_uri or "",
        "created_at": version.created_at,
        "updated_at": version.updated_at,
    }



def serialize_model_family(family: ModelFamily):
    return {
        "id": family.id,
        "name": family.name,
        "display_name": family.display_name,
        "description": family.description,
        "is_active": family.is_active,
        "created_at": family.created_at,
        "updated_at": family.updated_at,
        "current_production_version": serialize_model_version(family.current_production_version)
        if family.current_production_version else None,
        "version_count": family.versions.count(),
    }


class RegistryFamilyListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        families = ModelFamily.objects.filter(tenant=request.user).order_by("-updated_at")
        return Response([serialize_model_family(f) for f in families], status=status.HTTP_200_OK)


class RegistryFamilyDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, family_id):
        family = get_object_or_404(ModelFamily, id=family_id, tenant=request.user)
        return Response(serialize_model_family(family), status=status.HTTP_200_OK)


class RegistryVersionListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, family_id):
        family = get_object_or_404(ModelFamily, id=family_id, tenant=request.user)
        versions = family.versions.all().order_by("-created_at")
        return Response([serialize_model_version(v) for v in versions], status=status.HTTP_200_OK)


class RegistryHistoryListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, family_id):
        family = get_object_or_404(ModelFamily, id=family_id, tenant=request.user)
        history = family.history.all().order_by("-created_at")
        return Response([
            {
                "id": h.id,
                "action": h.action,
                "status": h.status,
                "version": h.model_version.version,
                "from_stage": h.from_stage,
                "to_stage": h.to_stage,
                "message": h.message,
                "actor": h.actor,
                "created_at": h.created_at,
            }
            for h in history
        ], status=status.HTTP_200_OK)


class RegistryPromoteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, family_id, version_id):
        family = get_object_or_404(ModelFamily, id=family_id, tenant=request.user)
        version = get_object_or_404(ModelVersion, id=version_id, family=family)
        
        if version.stage == "production":
            return Response({"error": "Version is already in production."}, status=status.HTTP_400_BAD_REQUEST)
            
        promote_version(family, version, actor=request.user.email, message="Manual promotion from API")
        return Response(serialize_model_version(version), status=status.HTTP_200_OK)


class RegistryRollbackView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, family_id, version_id):
        family = get_object_or_404(ModelFamily, id=family_id, tenant=request.user)
        version = get_object_or_404(ModelVersion, id=version_id, family=family)
        
        if version.stage == "production":
            return Response({"error": "Cannot rollback to the current production version."}, status=status.HTTP_400_BAD_REQUEST)
            
        rollback_family(family, version, actor=request.user.email, message="Manual rollback from API")
        return Response(serialize_model_version(version), status=status.HTTP_200_OK)


class RegistryMetricListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, family_id, version_id):
        family = get_object_or_404(ModelFamily, id=family_id, tenant=request.user)
        version = get_object_or_404(ModelVersion, id=version_id, family=family)
        metrics = version.metrics.all().order_by("metric_name", "step")
        
        # Format as a dictionary grouped by metric_name
        grouped = {}
        for m in metrics:
            if m.metric_name not in grouped:
                grouped[m.metric_name] = []
            grouped[m.metric_name].append({
                "value": m.metric_value,
                "step": m.step,
                "source": m.source,
            })
            
        return Response(grouped, status=status.HTTP_200_OK)
