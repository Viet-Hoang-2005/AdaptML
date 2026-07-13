from common.api.exceptions import Conflict
from rest_framework import serializers

from apps.catalog.models import ModelProject, WorkspaceAsset


class ModelProjectSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="public_id", read_only=True)

    class Meta:
        model = ModelProject
        fields = (
            "id",
            "name",
            "description",
            "access_mode",
            "model_type",
            "requirements_text",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("is_active", "created_at", "updated_at")

    def validate_name(self, value):
        request = self.context.get("request")
        if request and ModelProject.objects.filter(owner=request.user, name=value).exists():
            raise Conflict(f"A model project named {value} already exists.")
        return value


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
