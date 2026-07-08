import uuid
import secrets
import os
import json

from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.utils import timezone
from django_redis import get_redis_connection
from django.core.cache import cache
from integrations.hashid_utils import encode_model_id

class TrainingUploadStorage(FileSystemStorage):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("location", os.path.join(settings.BASE_DIR, "media", "training_uploads"))
        kwargs.setdefault("base_url", "/media/training_uploads/")
        super().__init__(*args, **kwargs)

training_upload_storage = TrainingUploadStorage()

def user_avatar_path(instance, filename):
    return f'users/{instance.tenant_id}/avatar/{filename}'

def user_avatar_history_path(instance, filename):
    return f'users/{instance.user.tenant_id}/avatar/{filename}'

def get_user_prefix(instance):
    if hasattr(instance, 'tenant') and instance.tenant:
        return instance.tenant.tenant_id
    elif hasattr(instance, 'user') and instance.user:
        return instance.user.tenant_id
    return 'unknown_user'

def get_model_hash_id(instance):
    if hasattr(instance, 'model_api_id') and instance.model_api_id:
        model_id = instance.model_api_id
    else:
        model_id = instance.id
        
    if not model_id:
        return 'temp-id'
    return encode_model_id(model_id)

def model_artifact_path(instance, filename):
    safe_version = instance.version.replace(' ', '') if instance.version else 'v1'
    return f'users/{get_user_prefix(instance)}/models/{get_model_hash_id(instance)}/{safe_version}/artifacts/{filename}'

def model_source_artifact_path(instance, filename):
    safe_version = instance.version.replace(' ', '') if instance.version else 'v1'
    return f'users/{get_user_prefix(instance)}/models/{get_model_hash_id(instance)}/{safe_version}/source/{filename}'

def label_mapping_path(instance, filename):
    safe_version = instance.version.replace(' ', '') if instance.version else 'v1'
    return f'users/{get_user_prefix(instance)}/models/{get_model_hash_id(instance)}/{safe_version}/mapping/{filename}'

def model_source_code_path(instance, filename):
    safe_version = instance.version.replace(' ', '') if instance.version else 'v1'
    return f'users/{get_user_prefix(instance)}/models/{get_model_hash_id(instance)}/{safe_version}/code/{filename}'

def model_reference_data_path(instance, filename):
    safe_version = instance.version.replace(' ', '') if instance.version else 'v1'
    return f'users/{get_user_prefix(instance)}/models/{get_model_hash_id(instance)}/{safe_version}/references/{filename}'

class CustomUserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('Email is required')
        email = self.normalize_email(email)
        
        if 'tenant_id' not in extra_fields or not extra_fields['tenant_id']:
            extra_fields['tenant_id'] = f"T-{uuid.uuid4().hex[:8].upper()}"
            
        user = self.model(email=email, **extra_fields)
        
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
            
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('is_staff', True)
        extra_fields.setdefault('is_superuser', True)
        return self.create_user(email, password, **extra_fields)

class CustomUser(AbstractBaseUser, PermissionsMixin):
    AUTH_PROVIDER_CHOICES = (
        ('email', 'Email'),
        ('google', 'Google'),
        ('github', 'GitHub'),
    )

    email = models.EmailField(unique=True, db_index=True)
    full_name = models.CharField(max_length=255, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    pronouns = models.CharField(max_length=30, blank=True, null=True)
    company = models.CharField(max_length=150, blank=True, null=True)
    avatar = models.ImageField(upload_to=user_avatar_path, blank=True, null=True)
    field_of_work = models.CharField(max_length=100, blank=True, null=True)
    country = models.CharField(max_length=100, blank=True, null=True)
    
    tenant_id = models.CharField(max_length=50, unique=True, db_index=True)    
    api_key = models.CharField(max_length=64, unique=True, null=True, blank=True, db_index=True)
    auth_provider = models.CharField(max_length=20, choices=AUTH_PROVIDER_CHOICES, default='email')
    
    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    is_staff = models.BooleanField(default=False)    
    date_joined = models.DateTimeField(auto_now_add=True)

    objects = CustomUserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    def save(self, *args, **kwargs):
        if not self.tenant_id:
            self.tenant_id = f"T-{uuid.uuid4().hex[:8].upper()}"

        if not self.api_key:
            self.api_key = f"sk_live_{secrets.token_urlsafe(32)}"
            
        super().save(*args, **kwargs)
        
        try:
            if self.is_active and self.api_key:
                payload = json.dumps({"tenant_id": self.tenant_id, "scope": "all", "allowed_models": []})
                redis_client = get_redis_connection("default")
                redis_client.set(f":1:api_key:{self.api_key}", payload)
            elif not self.is_active and self.api_key:
                redis_client = get_redis_connection("default")
                redis_client.delete(f":1:api_key:{self.api_key}")
        except Exception as e:
            print(f"Failed to update API key in Redis: {e}")

    def __str__(self):
        return f"{self.email} ({self.tenant_id})"

class UserAPIKey(models.Model):
    SCOPE_CHOICES = (
        ("all", "All Models"),
        ("specific", "Specific Models"),
    )
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="api_keys")
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    scope = models.CharField(max_length=20, choices=SCOPE_CHOICES, default="all")
    allowed_models = models.ManyToManyField('authentication.ModelAPI', related_name="api_keys", blank=True)
    key_prefix = models.CharField(max_length=24, db_index=True)
    key_hash = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.key_prefix})"


class UserAvatar(models.Model):
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="avatar_history")
    image = models.ImageField(upload_to=user_avatar_history_path)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.email} avatar {self.id}"

class ModelAPI(models.Model):
    SOURCE_TYPE_CHOICES = (
        ("manual_upload", "Manual Upload"),
        ("training_job", "Training Job"),
    )
    ACCESS_MODE_CHOICES = (
        ("private", "Private"),
        ("public", "Public"),
    )
    STATUS_CHOICES = (
        ("registered", "Registered"),
        ("ready", "Ready"),
        ("uploading", "Uploading"),
        ("deploying", "Deploying"),
        ("deployed", "Deployed"),
        ("unhealthy", "Unhealthy"),
        ("deploy_failed", "Deploy Failed"),
        ("stopped", "Stopped"),
        ("archived", "Archived"),
        ("error", "Error"),
        ("disabled", "Disabled"),
    )
    ENDPOINT_STATUS_CHOICES = (
        ("not_deployed", "Not Deployed"),
        ("deploying", "Deploying"),
        ("healthy", "Healthy"),
        ("unhealthy", "Unhealthy"),
        ("deploy_failed", "Deploy Failed"),
        ("stopped", "Stopped"),
    )
    BUILD_STATUS_CHOICES = (
        ("not_started", "Not Started"),
        ("building", "Building"),
        ("ready", "Ready"),
        ("error", "Error"),
    )
    MODEL_TYPE_CHOICES = (
        ("ml", "Machine Learning"),
        ("dl", "Deep Learning"),
    )

    tenant = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="model_apis")
    name = models.CharField(max_length=160)
    version = models.CharField(max_length=80, default="v1")
    description = models.TextField(blank=True)
    model_info = models.TextField(blank=True)
    access_mode = models.CharField(max_length=20, choices=ACCESS_MODE_CHOICES, default="private")
    source_type = models.CharField(max_length=30, choices=SOURCE_TYPE_CHOICES, default="manual_upload")
    model_type = models.CharField(max_length=10, choices=MODEL_TYPE_CHOICES, default="ml")
    source_training_job = models.ForeignKey(
        "TrainingJob",
        on_delete=models.SET_NULL,
        related_name="registered_model_apis",
        blank=True,
        null=True,
    )
    source_artifact_uri = models.CharField(max_length=1024, blank=True)
    source_artifact = models.FileField(upload_to=model_source_artifact_path, max_length=1024, blank=True, null=True)
    source_code_file = models.FileField(upload_to=model_source_code_path, max_length=1024, blank=True, null=True)
    reference_data_file = models.FileField(upload_to=model_reference_data_path, max_length=1024, blank=True, null=True)
    label_mapping_file = models.FileField(upload_to=label_mapping_path, max_length=1024, blank=True, null=True)
    flavor = models.CharField(max_length=40, blank=True)
    requirements_text = models.TextField(blank=True)
    metrics_summary = models.JSONField(default=dict, blank=True)
    params_summary = models.JSONField(default=dict, blank=True)
    model_insights_summary = models.JSONField(default=dict, blank=True)
    package_manifest = models.JSONField(default=dict, blank=True)
    package_preview_tree = models.JSONField(default=list, blank=True)
    build_status = models.CharField(max_length=20, choices=BUILD_STATUS_CHOICES, default="not_started")
    build_error = models.TextField(blank=True)
    artifact = models.FileField(upload_to=model_artifact_path, max_length=1024, blank=True, null=True)
    model_uri = models.CharField(max_length=1024, blank=True)
    endpoint_url = models.CharField(max_length=1024, blank=True)
    endpoint_status = models.CharField(
        max_length=30,
        choices=ENDPOINT_STATUS_CHOICES,
        default="not_deployed",
    )
    endpoint_error = models.TextField(blank=True)
    endpoint_last_checked_at = models.DateTimeField(blank=True, null=True)
    endpoint_container_name = models.CharField(max_length=160, blank=True)
    endpoint_image_name = models.CharField(max_length=200, blank=True)
    endpoint_public_path = models.CharField(max_length=512, blank=True)
    endpoint_internal_path = models.CharField(max_length=160, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="ready")
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="authenticat_tenant__dcb6f3_idx"),
            models.Index(fields=["tenant", "access_mode"], name="authenticat_tenant__e54007_idx"),
            models.Index(fields=["tenant", "name", "version"], name="authenticat_model_v_lookup_idx"),
        ]

    def __str__(self):
        return f"{self.name} ({self.tenant.tenant_id})"

    def detect_and_set_model_type(self):
        text_to_check = f"{self.flavor} {self.name} {self.model_info} {self.requirements_text}".lower()
        if any(kw in text_to_check for kw in ["tensorflow", "keras", "pytorch", "torch", "onnx", "dl", "bentoml", "transformers", "huggingface"]):
            self.model_type = "dl"
        elif any(kw in text_to_check for kw in ["xgboost", "scikit-learn", "sklearn", "lightgbm", "lgbm", "ml"]):
            self.model_type = "ml"

    def save(self, *args, **kwargs):
        self.detect_and_set_model_type()
        update_fields = kwargs.get("update_fields")
        if update_fields is not None and isinstance(update_fields, (list, tuple, set)):
            if "model_type" not in update_fields:
                kwargs["update_fields"] = list(update_fields) + ["model_type"]
        super().save(*args, **kwargs)



class TrainingJob(models.Model):
    BACKEND_CHOICES = (
        ("kubeflow", "Kubeflow (Karpenter Autoscaled)"),
        ("local", "Local"),
    )
    ACCELERATOR_CHOICES = (
        ("none", "None"),
        ("gpu", "GPU"),
        ("tpu", "TPU"),
        ("trainium", "Trainium"),
    )
    STATUS_CHOICES = (
        ("pending", "Pending"),
        ("uploading", "Uploading"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    )
    TRACKING_STATUS_CHOICES = (
        ("pending", "Pending"),
        ("ingesting", "Ingesting"),
        ("completed", "Completed"),
        ("failed", "Failed"),
        ("skipped", "Skipped"),
    )
    DEPLOYABILITY_STATUS_CHOICES = (
        ("unknown", "Unknown"),
        ("deployable", "Deployable"),
        ("track_only", "Track Only"),
        ("invalid", "Invalid"),
    )

    tenant = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="training_jobs")
    name = models.CharField(max_length=160)
    model_version = models.CharField(max_length=80)
    entry_point = models.CharField(max_length=160, default="train.py")
    training_backend = models.CharField(max_length=20, choices=BACKEND_CHOICES, default="kubeflow")
    vcpu = models.PositiveIntegerField(default=2)
    memory = models.PositiveIntegerField(default=4096)
    max_runtime_seconds = models.PositiveIntegerField(default=3600)
    accelerator_type = models.CharField(max_length=20, choices=ACCELERATOR_CHOICES, default="none")
    accelerator_count = models.PositiveIntegerField(default=0)
    retry_of = models.ForeignKey("self", on_delete=models.SET_NULL, related_name="retries", blank=True, null=True)
    model_api = models.ForeignKey("ModelAPI", on_delete=models.SET_NULL, related_name="training_jobs", blank=True, null=True)
    s3_source_uri = models.CharField(max_length=1024, blank=True)
    s3_training_data_uri = models.CharField(max_length=1024, blank=True)
    sagemaker_job_name = models.CharField(max_length=160, blank=True)
    external_job_id = models.CharField(max_length=160, blank=True)
    output_s3_uri = models.CharField(max_length=1024, blank=True)
    model_artifact_uri = models.CharField(max_length=1024, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    error_message = models.TextField(blank=True)
    training_logs = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    runtime_seconds = models.PositiveIntegerField(default=0)
    stop_reason = models.TextField(blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    mlflow_tracking_uri = models.CharField(max_length=512, blank=True, null=True)
    mlflow_experiment_id = models.CharField(max_length=255, blank=True, null=True)
    mlflow_experiment_name = models.CharField(max_length=255, blank=True, null=True)
    mlflow_run_id = models.CharField(max_length=255, blank=True, null=True, db_index=True)
    mlflow_run_name = models.CharField(max_length=255, blank=True, null=True)
    mlflow_model_uri = models.CharField(max_length=1024, blank=True, null=True)
    mlflow_artifact_uri = models.CharField(max_length=1024, blank=True, null=True)
    tracking_status = models.CharField(max_length=30, choices=TRACKING_STATUS_CHOICES, default="pending")
    tracking_error = models.TextField(blank=True)
    tracking_ingested_at = models.DateTimeField(null=True, blank=True)
    training_summary = models.JSONField(default=dict, blank=True)
    metrics_summary = models.JSONField(default=dict, blank=True)
    params_summary = models.JSONField(default=dict, blank=True)
    model_insights_summary = models.JSONField(default=dict, blank=True)
    artifact_manifest = models.JSONField(default=list, blank=True)
    deployability_status = models.CharField(
        max_length=30,
        choices=DEPLOYABILITY_STATUS_CHOICES,
        default="unknown",
    )
    deployability_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="authenticat_trainin_57fd0f_idx"),
            models.Index(fields=["tenant", "model_version"], name="authenticat_trainin_5cba8b_idx"),
            models.Index(fields=["tenant", "deleted_at"], name="authenticat_trainin_6a33d7_idx"),
        ]

    def __str__(self):
        return f"{self.name} {self.model_version} ({self.tenant.tenant_id})"

    def mark_started(self, save=True):
        if not self.started_at:
            self.started_at = timezone.now()
            if save:
                self.save(update_fields=["started_at", "updated_at"])

    def mark_finished(self, stop_reason="", save=True):
        if not self.completed_at:
            self.completed_at = timezone.now()
        if not self.started_at:
            self.started_at = self.created_at or self.completed_at

        if self.started_at and self.completed_at:
            elapsed = int((self.completed_at - self.started_at).total_seconds())
            self.runtime_seconds = max(elapsed, 0)

        if stop_reason:
            self.stop_reason = stop_reason

        if save:
            self.save(update_fields=["started_at", "completed_at", "runtime_seconds", "stop_reason", "updated_at"])


class TrainingJobEvent(models.Model):
    training_job = models.ForeignKey(TrainingJob, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=40)
    message = models.CharField(max_length=500)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["training_job", "created_at"], name="authenticat_tjevent_4b0b_idx"),
        ]

    def __str__(self):
        return f"{self.event_type} - {self.training_job_id}"


class ModelFamily(models.Model):
    """Groups all versions of a logical model under a single named family."""
    tenant = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="model_families")
    name = models.CharField(max_length=160)
    display_name = models.CharField(max_length=200, blank=True)
    description = models.TextField(blank=True)
    current_production_version = models.ForeignKey(
        "ModelVersion",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="production_for_families",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("tenant", "name")]
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["tenant", "is_active"], name="reg_family_tenant_active_idx"),
        ]

    def __str__(self):
        return f"{self.name} ({self.tenant.tenant_id})"


class ModelVersion(models.Model):
    """A single version within a ModelFamily, linked to an existing ModelAPI row."""
    STAGE_CHOICES = (
        ("none", "None"),
        ("candidate", "Candidate"),
        ("staging", "Staging"),
        ("production", "Production"),
        ("archived", "Archived"),
    )
    SOURCE_TYPE_CHOICES = (
        ("manual_upload", "Manual Upload"),
        ("training_job", "Training Job"),
        ("imported", "Imported"),
    )

    tenant = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="model_versions")
    family = models.ForeignKey(ModelFamily, on_delete=models.CASCADE, related_name="versions")
    version = models.CharField(max_length=80)
    model_api = models.OneToOneField(
        "ModelAPI",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="registry_version",
    )
    source_training_job = models.ForeignKey(
        "TrainingJob",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="registry_versions",
    )
    source_type = models.CharField(max_length=30, choices=SOURCE_TYPE_CHOICES, default="manual_upload")
    artifact_uri = models.CharField(max_length=1024, blank=True)
    image_name = models.CharField(max_length=200, blank=True)
    endpoint_url = models.CharField(max_length=1024, blank=True)
    stage = models.CharField(max_length=20, choices=STAGE_CHOICES, default="none")
    mlflow_run_id = models.CharField(max_length=255, blank=True, null=True, db_index=True)
    mlflow_experiment_id = models.CharField(max_length=255, blank=True, null=True)
    mlflow_model_uri = models.CharField(max_length=1024, blank=True, null=True)
    mlflow_artifact_uri = models.CharField(max_length=1024, blank=True, null=True)
    training_summary = models.JSONField(default=dict, blank=True)
    metrics_summary = models.JSONField(default=dict, blank=True)
    params_summary = models.JSONField(default=dict, blank=True)
    model_insights_summary = models.JSONField(default=dict, blank=True)
    artifact_manifest = models.JSONField(default=list, blank=True)
    tracking_status = models.CharField(max_length=30, blank=True, default="")
    tracking_error = models.TextField(blank=True)
    tracking_ingested_at = models.DateTimeField(null=True, blank=True)
    deployability_status = models.CharField(max_length=30, blank=True, default="unknown")
    deployability_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("family", "version")]
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "stage"], name="reg_version_tenant_stage_idx"),
            models.Index(fields=["family", "version"], name="reg_version_family_ver_idx"),
        ]

    def __str__(self):
        return f"{self.family.name}@{self.version} [{self.stage}]"


class ModelDeploymentHistory(models.Model):
    """Immutable audit log of every lifecycle action taken on a ModelVersion."""
    ACTION_CHOICES = (
        ("registered", "Registered"),
        ("built", "Built"),
        ("deployed", "Deployed"),
        ("health_checked", "Health Checked"),
        ("stopped", "Stopped"),
        ("redeployed", "Redeployed"),
        ("promoted", "Promoted"),
        ("rolled_back", "Rolled Back"),
        ("archived", "Archived"),
        ("failed", "Failed"),
    )
    STATUS_CHOICES = (
        ("success", "Success"),
        ("failed", "Failed"),
        ("running", "Running"),
    )

    tenant = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="deployment_history")
    family = models.ForeignKey(ModelFamily, on_delete=models.CASCADE, related_name="history")
    model_version = models.ForeignKey(ModelVersion, on_delete=models.CASCADE, related_name="history")
    model_api = models.ForeignKey(
        "ModelAPI",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="history_events",
    )
    action = models.CharField(max_length=30, choices=ACTION_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="success")
    from_stage = models.CharField(max_length=20, blank=True)
    to_stage = models.CharField(max_length=20, blank=True)
    message = models.TextField(blank=True)
    extra = models.JSONField(default=dict, blank=True)
    actor = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["family", "created_at"], name="reg_history_family_ts_idx"),
            models.Index(fields=["model_version", "action"], name="reg_history_ver_action_idx"),
        ]

    def __str__(self):
        return f"{self.action}/{self.status}"


class ModelMetric(models.Model):
    """Persisted scalar metrics for a ModelVersion."""
    SOURCE_CHOICES = (
        ("training_log", "Training Log"),
        ("mlflow", "MLflow"),
        ("production", "Production"),
        ("drift", "Drift"),
    )

    tenant = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="model_metrics")
    family = models.ForeignKey(ModelFamily, on_delete=models.CASCADE, related_name="metrics")
    model_version = models.ForeignKey(ModelVersion, on_delete=models.CASCADE, related_name="metrics")
    metric_name = models.CharField(max_length=80)
    metric_value = models.FloatField()
    step = models.IntegerField(default=0)
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default="training_log")
    extra = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("model_version", "metric_name", "step")]
        ordering = ["step", "metric_name"]
        indexes = [
            models.Index(fields=["model_version", "metric_name"], name="reg_metric_ver_name_idx"),
        ]

    def __str__(self):
        return f"{self.metric_name}={self.metric_value} step={self.step}"


class DriftMonitoringJob(models.Model):
    STATUS_CHOICES = (
        ("active", "Active"),
        ("inactive", "Inactive"),
    )
    
    tenant = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="drift_jobs")
    model_api = models.OneToOneField(ModelAPI, on_delete=models.CASCADE, related_name="drift_job")
    trigger_threshold = models.PositiveIntegerField(default=1000)
    reference_data_s3_path = models.CharField(max_length=1024, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"DriftJob {self.model_api.name} ({self.trigger_threshold})"

class DriftMonitoringResult(models.Model):
    job = models.ForeignKey(DriftMonitoringJob, on_delete=models.CASCADE, related_name="results")
    report_url = models.CharField(max_length=1024, blank=True)
    drift_score = models.FloatField(default=0.0)
    dataset_drift = models.BooleanField(default=False)
    drifted_features_count = models.PositiveIntegerField(default=0)
    total_features = models.PositiveIntegerField(default=0)
    run_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ["-run_at"]

    def __str__(self):
        return f"Result {self.id} for {self.job.model_api.name}"


class ModelRoutingAlias(models.Model):
    """Stable API-level alias pointing to a concrete ModelVersion."""

    ALLOWED_ALIASES = ("production", "latest", "champion")

    tenant = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="model_routing_aliases")
    family = models.ForeignKey(ModelFamily, on_delete=models.CASCADE, related_name="routing_aliases")
    alias_name = models.CharField(max_length=32)
    target_version = models.ForeignKey(
        ModelVersion,
        on_delete=models.CASCADE,
        related_name="routing_alias_targets",
    )
    target_model_api = models.ForeignKey(
        "ModelAPI",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="routing_alias_targets",
    )
    endpoint_url = models.TextField(blank=True, default="")
    status = models.CharField(max_length=32, default="active")
    promoted_by = models.ForeignKey(
        CustomUser,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    promoted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("tenant", "family", "alias_name")]
        ordering = ["alias_name"]
        indexes = [
            models.Index(fields=["tenant", "family", "alias_name"], name="routing_alias_lookup_idx"),
            models.Index(fields=["target_version", "status"], name="routing_alias_target_idx"),
        ]

    def __str__(self):
        return f"{self.family.name}:{self.alias_name} -> {self.target_version.version}"

