from rest_framework import serializers

from apps.catalog.models import ModelProject
from apps.training.models import TrainingJob, TrainingJobEvent, TrainingOutput


class TrainingOutputSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="public_id", read_only=True)

    class Meta:
        model = TrainingOutput
        fields = (
            "id",
            "kind",
            "relative_path",
            "s3_uri",
            "checksum",
            "size_bytes",
            "content_type",
            "metadata",
            "created_at",
        )


class TrainingJobEventSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="public_id", read_only=True)

    class Meta:
        model = TrainingJobEvent
        fields = ("id", "event_type", "message", "metadata", "created_at")


class TrainingJobSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="public_id", read_only=True)
    project_id = serializers.UUIDField(source="project.public_id", read_only=True)
    project = serializers.SlugRelatedField(
        slug_field="public_id", queryset=ModelProject.objects.none(), write_only=True
    )
    outputs = TrainingOutputSerializer(many=True, read_only=True)
    source_zip = serializers.FileField(write_only=True, required=False)
    training_data = serializers.FileField(write_only=True, required=False)
    output_available = serializers.SerializerMethodField()
    registration_build = serializers.SerializerMethodField()

    class Meta:
        model = TrainingJob
        fields = (
            "id",
            "project",
            "project_id",
            "name",
            "model_flavor",
            "entry_point",
            "requirements_text",
            "source_zip",
            "training_data",
            "code_snapshot_uri",
            "data_snapshot_uri",
            "output_uri",
            "mlflow_artifact_uri",
            "mlflow_run_id",
            "backend",
            "external_job_id",
            "celery_task_id",
            "status",
            "vcpu",
            "memory_mb",
            "max_runtime_seconds",
            "accelerator_type",
            "accelerator_count",
            "tracking",
            "error_message",
            "started_at",
            "completed_at",
            "runtime_seconds",
            "outputs_purged_at",
            "output_available",
            "registration_build",
            "outputs",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "backend",
            "code_snapshot_uri",
            "data_snapshot_uri",
            "output_uri",
            "mlflow_artifact_uri",
            "external_job_id",
            "celery_task_id",
            "status",
            "tracking",
            "error_message",
            "started_at",
            "completed_at",
            "runtime_seconds",
            "outputs_purged_at",
            "created_at",
            "updated_at",
        )
        extra_kwargs = {"requirements_text": {"required": False, "allow_blank": True}}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            self.fields["project"].queryset = ModelProject.objects.filter(owner=request.user, is_active=True)

    @staticmethod
    def get_output_available(instance):
        return instance.outputs_purged_at is None and instance.outputs.filter(kind="model").exists()

    @staticmethod
    def get_registration_build(instance):
        build = instance.builds.order_by("-created_at").first()
        if not build:
            return None
        return TrainingBuildSerializer(build).data


class TrainingBuildSerializer(serializers.Serializer):
    id = serializers.UUIDField(source="public_id", read_only=True)
    project_id = serializers.UUIDField(source="project.public_id", read_only=True)
    source_job_id = serializers.UUIDField(source="source_job.public_id", read_only=True)
    version_id = serializers.UUIDField(source="version.public_id", allow_null=True, read_only=True)
    version_number = serializers.CharField(source="version.version", allow_null=True, read_only=True)
    flavor = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    image_uri = serializers.CharField(read_only=True)
    image_digest = serializers.CharField(read_only=True)
    error_message = serializers.CharField(read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)
