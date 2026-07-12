from rest_framework import serializers

from apps.deployment.models import Build, Deployment, Endpoint
from apps.registry.models import ModelVersion


class BuildSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="public_id", read_only=True)
    version_id = serializers.UUIDField(source="version.public_id", read_only=True)
    version = serializers.SlugRelatedField(
        slug_field="public_id", queryset=ModelVersion.objects.none(), write_only=True
    )

    class Meta:
        model = Build
        fields = (
            "id",
            "version",
            "version_id",
            "backend",
            "status",
            "celery_task_id",
            "external_build_id",
            "image_uri",
            "package_uri",
            "logs",
            "error_message",
            "started_at",
            "completed_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "backend",
            "status",
            "celery_task_id",
            "external_build_id",
            "image_uri",
            "package_uri",
            "logs",
            "error_message",
            "started_at",
            "completed_at",
            "created_at",
            "updated_at",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            self.fields["version"].queryset = ModelVersion.objects.filter(project__owner=request.user)


class DeploymentSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="public_id", read_only=True)
    version_id = serializers.UUIDField(source="version.public_id", read_only=True)
    build = serializers.SlugRelatedField(slug_field="public_id", queryset=Build.objects.none(), write_only=True)
    build_id = serializers.UUIDField(source="build.public_id", read_only=True)

    class Meta:
        model = Deployment
        fields = (
            "id",
            "version_id",
            "build",
            "build_id",
            "backend",
            "status",
            "celery_task_id",
            "external_deployment_id",
            "error_message",
            "deployed_at",
            "stopped_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "version_id",
            "backend",
            "status",
            "celery_task_id",
            "external_deployment_id",
            "error_message",
            "deployed_at",
            "stopped_at",
            "created_at",
            "updated_at",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            self.fields["build"].queryset = Build.objects.filter(version__project__owner=request.user, status="ready")


class EndpointSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="public_id", read_only=True)
    deployment_id = serializers.UUIDField(source="deployment.public_id", read_only=True)
    version_id = serializers.UUIDField(source="deployment.version.public_id", read_only=True)

    class Meta:
        model = Endpoint
        fields = (
            "id",
            "deployment_id",
            "version_id",
            "public_url",
            "internal_url",
            "runtime_name",
            "runtime_namespace",
            "health_status",
            "last_checked_at",
            "metadata",
            "created_at",
            "updated_at",
        )
