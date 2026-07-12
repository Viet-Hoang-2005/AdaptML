import uuid

from django.db import models


class Build(models.Model):
    STATUSES = tuple(
        (value, value.replace("_", " ").title())
        for value in ("pending", "queued", "building", "ready", "failed", "cancelled")
    )
    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    version = models.ForeignKey("registry.ModelVersion", on_delete=models.CASCADE, related_name="builds")
    backend = models.CharField(max_length=30, default="docker")
    status = models.CharField(max_length=30, choices=STATUSES, default="pending")
    celery_task_id = models.CharField(max_length=255, blank=True, db_index=True)
    external_build_id = models.CharField(max_length=255, blank=True)
    image_uri = models.CharField(max_length=1024, blank=True)
    package_uri = models.CharField(max_length=1024, blank=True)
    logs = models.TextField(blank=True)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["version", "status"], name="build_version_status_idx")]

    def __str__(self):
        return f"Build {self.public_id} ({self.status})"


class Deployment(models.Model):
    STATUSES = tuple(
        (value, value.replace("_", " ").title())
        for value in ("pending", "deploying", "healthy", "unhealthy", "failed", "stopped")
    )
    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    version = models.ForeignKey("registry.ModelVersion", on_delete=models.PROTECT, related_name="deployments")
    build = models.ForeignKey(Build, on_delete=models.PROTECT, related_name="deployments")
    backend = models.CharField(max_length=30, default="docker")
    status = models.CharField(max_length=30, choices=STATUSES, default="pending")
    celery_task_id = models.CharField(max_length=255, blank=True, db_index=True)
    external_deployment_id = models.CharField(max_length=255, blank=True)
    error_message = models.TextField(blank=True)
    deployed_at = models.DateTimeField(null=True, blank=True)
    stopped_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Deployment {self.public_id} ({self.status})"


class Endpoint(models.Model):
    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    deployment = models.OneToOneField(Deployment, on_delete=models.CASCADE, related_name="endpoint")
    public_url = models.CharField(max_length=1024)
    internal_url = models.CharField(max_length=1024, blank=True)
    runtime_name = models.CharField(max_length=255, blank=True)
    runtime_namespace = models.CharField(max_length=255, blank=True)
    health_status = models.CharField(max_length=30, default="unknown")
    last_checked_at = models.DateTimeField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.public_url
