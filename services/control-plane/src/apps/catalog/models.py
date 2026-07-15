import uuid

from django.conf import settings
from django.db import models


class ModelProject(models.Model):
    ACCESS_MODES = (("private", "Private"), ("public", "Public"))
    MODEL_TYPES = (("ml", "Machine Learning"), ("dl", "Deep Learning"))
    DELETION_STATES = (
        ("active", "Active"),
        ("deleting", "Deleting"),
        ("deleted", "Deleted"),
        ("delete_failed", "Delete Failed"),
    )

    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="model_projects")
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    access_mode = models.CharField(max_length=20, choices=ACCESS_MODES, default="private")
    model_type = models.CharField(max_length=10, choices=MODEL_TYPES, default="ml")
    requirements_text = models.TextField(blank=True)
    next_version_number = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    deletion_state = models.CharField(max_length=20, choices=DELETION_STATES, default="active")
    deletion_error = models.TextField(blank=True)
    deletion_task_id = models.CharField(max_length=255, blank=True, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [models.UniqueConstraint(fields=["owner", "name"], name="project_owner_name_unique")]
        indexes = [models.Index(fields=["owner", "is_active"], name="project_owner_active_idx")]

    def __str__(self):
        return f"{self.name} ({self.public_id})"


class WorkspaceAsset(models.Model):
    KINDS = (("code", "Code"), ("data", "Data"))

    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    project = models.ForeignKey(ModelProject, on_delete=models.CASCADE, related_name="workspace_assets")
    kind = models.CharField(max_length=20, choices=KINDS)
    relative_path = models.CharField(max_length=512)
    s3_uri = models.CharField(max_length=1024)
    checksum = models.CharField(max_length=128, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    content_type = models.CharField(max_length=160, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["kind", "relative_path"]
        constraints = [
            models.UniqueConstraint(fields=["project", "kind", "relative_path"], name="workspace_asset_path_unique")
        ]

    def __str__(self):
        return f"{self.project.name}/{self.kind}/{self.relative_path}"


class ModelBuildMetadata(models.Model):
    """Mutable package configuration for a manually uploaded model project."""

    project = models.OneToOneField(ModelProject, on_delete=models.CASCADE, related_name="build_metadata")
    flavor = models.CharField(max_length=80)
    artifact_format = models.CharField(max_length=20, default="raw")
    revision = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.project.name} build metadata r{self.revision}"


class ModelBuildInputAsset(models.Model):
    KINDS = (
        ("source_artifact", "Source Artifact"),
        ("label_mapping", "Label Mapping"),
        ("metrics", "Metrics"),
        ("params", "Parameters"),
        ("model_insights", "Model Insights"),
        ("feature_importance", "Feature Importance"),
        ("input_schema", "Input Schema"),
    )

    project = models.ForeignKey(ModelProject, on_delete=models.CASCADE, related_name="build_input_assets")
    kind = models.CharField(max_length=40, choices=KINDS)
    name = models.CharField(max_length=255)
    s3_uri = models.CharField(max_length=1024)
    checksum = models.CharField(max_length=128, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    content_type = models.CharField(max_length=160, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["project", "kind"], name="build_input_project_kind_unique")]

    def __str__(self):
        return f"{self.project.name}/{self.kind}/{self.name}"
