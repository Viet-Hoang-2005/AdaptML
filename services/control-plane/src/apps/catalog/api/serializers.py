from common.api.exceptions import Conflict
from rest_framework import serializers

from apps.catalog.artifact_types import ARTIFACT_FORMATS, validate_source_artifact
from apps.catalog.models import ModelBuildInputAsset, ModelProject, WorkspaceAsset


class ModelProjectSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="public_id", read_only=True)
    flavor = serializers.SerializerMethodField()
    build_metadata_revision = serializers.SerializerMethodField()
    lifecycle_status = serializers.SerializerMethodField()

    class Meta:
        model = ModelProject
        fields = (
            "id",
            "name",
            "description",
            "access_mode",
            "model_type",
            "requirements_text",
            "flavor",
            "build_metadata_revision",
            "lifecycle_status",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("is_active", "created_at", "updated_at")

    def validate_name(self, value):
        request = self.context.get("request")
        queryset = ModelProject.objects.filter(owner=request.user, name=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if request and queryset.exists():
            raise Conflict(f"A model project named {value} already exists.")
        return value

    def get_flavor(self, instance):
        metadata = getattr(instance, "build_metadata", None)
        return metadata.flavor if metadata else ""

    def get_build_metadata_revision(self, instance):
        metadata = getattr(instance, "build_metadata", None)
        return metadata.revision if metadata else None

    def get_lifecycle_status(self, instance):
        """Return the current user-facing lifecycle state for the management list."""
        versions = instance.versions.all()
        builds = [build for version in versions for build in version.builds.all()]
        deployments = [deployment for version in versions for deployment in version.deployments.all()]

        if any(deployment.status in {"pending", "deploying", "healthy", "unhealthy"} for deployment in deployments):
            return "deployed"
        if any(build.status == "ready" for build in builds):
            return "image_ready"
        return "metadata"


class WorkspaceAssetSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="public_id", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = WorkspaceAsset
        fields = (
            "id",
            "kind",
            "relative_path",
            "s3_uri",
            "download_url",
            "checksum",
            "size_bytes",
            "content_type",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("kind", "s3_uri", "checksum", "size_bytes", "content_type", "created_at", "updated_at")

    def get_download_url(self, instance):
        from infrastructure.storage import S3Storage

        return S3Storage().presigned_get(instance.s3_uri, 900)


class WorkspaceUploadSerializer(serializers.Serializer):
    file = serializers.FileField()
    relative_path = serializers.CharField(max_length=512)


class ModelBuildInputAssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModelBuildInputAsset
        fields = ("kind", "name", "checksum", "size_bytes", "content_type", "updated_at")


class BuildMetadataWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=160)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    access_mode = serializers.ChoiceField(choices=ModelProject.ACCESS_MODES, default="public")
    flavor = serializers.ChoiceField(choices=("sklearn", "xgboost", "pytorch", "tensorflow"))
    artifact_format = serializers.ChoiceField(choices=ARTIFACT_FORMATS, required=False)
    requirements_text = serializers.CharField(required=False, allow_blank=True, default="")
    source_artifact = serializers.FileField(required=False)
    label_mapping_file = serializers.FileField(required=False)
    metrics_file = serializers.FileField(required=False)
    params_file = serializers.FileField(required=False)
    model_insights_file = serializers.FileField(required=False)
    feature_importance_file = serializers.FileField(required=False)
    input_schema_file = serializers.FileField(required=False)
    source_code_file = serializers.FileField(required=False)
    reference_data_file = serializers.FileField(required=False)

    def validate(self, attrs):
        source_artifact = attrs.get("source_artifact")
        artifact_format = attrs.get("artifact_format", "raw")
        if source_artifact:
            validate_source_artifact(
                filename=source_artifact.name,
                flavor=attrs["flavor"],
                artifact_format=artifact_format,
            )
        if artifact_format == "mlflow_zip":
            package_only_files = (
                "label_mapping_file",
                "metrics_file",
                "params_file",
                "model_insights_file",
                "feature_importance_file",
                "input_schema_file",
            )
            supplied = [field for field in package_only_files if attrs.get(field)]
            if supplied:
                raise serializers.ValidationError(
                    {field: "Include this file inside the model package ZIP instead." for field in supplied}
                )
        return attrs


class BuildMetadataReadSerializer(serializers.Serializer):
    id = serializers.UUIDField(source="public_id", read_only=True)
    name = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)
    access_mode = serializers.CharField(read_only=True)
    requirements_text = serializers.CharField(read_only=True)
    flavor = serializers.SerializerMethodField()
    artifact_format = serializers.SerializerMethodField()
    revision = serializers.SerializerMethodField()
    assets = serializers.SerializerMethodField()

    def get_flavor(self, project):
        return project.build_metadata.flavor

    def get_artifact_format(self, project):
        return project.build_metadata.artifact_format

    def get_revision(self, project):
        return project.build_metadata.revision

    def get_assets(self, project):
        return ModelBuildInputAssetSerializer(project.build_input_assets.all(), many=True).data
