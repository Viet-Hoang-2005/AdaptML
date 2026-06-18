from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.conf import settings
from django.core.files.storage import FileSystemStorage
import uuid
import secrets
import os
from django.core.cache import cache


class TrainingUploadStorage(FileSystemStorage):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("location", os.path.join(settings.BASE_DIR, "media", "training_uploads"))
        kwargs.setdefault("base_url", "/media/training_uploads/")
        super().__init__(*args, **kwargs)


training_upload_storage = TrainingUploadStorage()


def user_avatar_path(instance, filename):
    # Lấy username từ email (phần trước @) để tạo thư mục
    email_prefix = instance.email.split('@')[0]
    return f'{email_prefix}/avatar/{filename}'

def user_avatar_history_path(instance, filename):
    email_prefix = instance.user.email.split('@')[0]
    return f'{email_prefix}/avatar/{filename}'

def model_artifact_path(instance, filename):
    return f'{instance.tenant.tenant_id}/models/{instance.id or "new"}/{filename}'

def model_source_artifact_path(instance, filename):
    return f'{instance.tenant.tenant_id}/models/{instance.id or "new"}/source/{filename}'

def training_source_zip_path(instance, filename):
    return f'{instance.tenant.tenant_id}/training-jobs/{instance.id or "new"}/source/{filename}'

def training_requirements_path(instance, filename):
    return f'{instance.tenant.tenant_id}/training-jobs/{instance.id or "new"}/source/{filename}'

def training_data_path(instance, filename):
    return f'{instance.tenant.tenant_id}/training-jobs/{instance.id or "new"}/data/{filename}'

class CustomUserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('Email is required')
        email = self.normalize_email(email)
        
        # Tự động cấp tenant_id nếu chưa có
        if 'tenant_id' not in extra_fields or not extra_fields['tenant_id']:
            extra_fields['tenant_id'] = f"T-{uuid.uuid4().hex[:8].upper()}"
            
        user = self.model(email=email, **extra_fields)
        
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password() # Dành cho luồng OAuth
            
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
    
    # Quan trọng cho AI PaaS Multi-tenant
    tenant_id = models.CharField(max_length=50, unique=True, db_index=True)
    
    # API Key dùng cho FastAPI xác thực từ code Python
    api_key = models.CharField(max_length=64, unique=True, null=True, blank=True, db_index=True)
    
    # Provider đăng ký ban đầu
    auth_provider = models.CharField(max_length=20, choices=AUTH_PROVIDER_CHOICES, default='email')
    
    # Trạng thái tài khoản (Soft Delete sẽ dùng cờ này)
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

        # Tạo API Key tự động nếu chưa có
        if not self.api_key:
            self.api_key = f"sk_live_{secrets.token_urlsafe(32)}"
            
        super().save(*args, **kwargs)
        
        try:
            # Đẩy/Cập nhật API Key lên Redis
            if self.is_active and self.api_key:
                cache.set(f"api_key:{self.api_key}", self.tenant_id, timeout=None)
            elif not self.is_active and self.api_key:
                # Thu hồi ngay lập tức nếu tài khoản bị khóa
                cache.delete(f"api_key:{self.api_key}")
        except Exception as e:
            print(f"Failed to update API key in Redis: {e}")
            # Dù Redis lỗi thì vẫn lưu user bình thường

    def __str__(self):
        return f"{self.email} ({self.tenant_id})"


class UserAPIKey(models.Model):
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="api_keys")
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
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
    ACCESS_MODE_CHOICES = (
        ("private", "Private"),
        ("public", "Public"),
    )
    STATUS_CHOICES = (
        ("ready", "Ready"),
        ("uploading", "Uploading"),
        ("error", "Error"),
        ("disabled", "Disabled"),
    )
    BUILD_STATUS_CHOICES = (
        ("not_started", "Not Started"),
        ("building", "Building"),
        ("ready", "Ready"),
        ("error", "Error"),
    )

    tenant = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="model_apis")
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    model_info = models.TextField(blank=True)
    access_mode = models.CharField(max_length=20, choices=ACCESS_MODE_CHOICES, default="private")
    source_artifact = models.FileField(upload_to=model_source_artifact_path, blank=True, null=True)
    flavor = models.CharField(max_length=40, blank=True)
    requirements_text = models.TextField(blank=True)
    package_manifest = models.JSONField(default=dict, blank=True)
    package_preview_tree = models.JSONField(default=list, blank=True)
    build_status = models.CharField(max_length=20, choices=BUILD_STATUS_CHOICES, default="not_started")
    build_error = models.TextField(blank=True)
    artifact = models.FileField(upload_to=model_artifact_path, blank=True, null=True)
    model_uri = models.CharField(max_length=1024, blank=True)
    endpoint_url = models.CharField(max_length=1024, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="ready")
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="authenticat_tenant__dcb6f3_idx"),
            models.Index(fields=["tenant", "access_mode"], name="authenticat_tenant__e54007_idx"),
        ]

    def __str__(self):
        return f"{self.name} ({self.tenant.tenant_id})"


class TrainingJob(models.Model):
    BACKEND_CHOICES = (
        ("sagemaker", "SageMaker"),
        ("local", "Local"),
        ("aws_batch", "AWS Batch"),
    )
    STATUS_CHOICES = (
        ("pending", "Pending"),
        ("uploading", "Uploading"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
    )

    tenant = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="training_jobs")
    name = models.CharField(max_length=160)
    model_version = models.CharField(max_length=80)
    entry_point = models.CharField(max_length=160, default="train.py")
    training_backend = models.CharField(max_length=20, choices=BACKEND_CHOICES, default="sagemaker")
    source_zip = models.FileField(upload_to=training_source_zip_path, storage=training_upload_storage)
    requirements_file = models.FileField(upload_to=training_requirements_path, storage=training_upload_storage, blank=True, null=True)
    training_data = models.FileField(upload_to=training_data_path, storage=training_upload_storage)
    s3_source_uri = models.CharField(max_length=1024, blank=True)
    s3_training_data_uri = models.CharField(max_length=1024, blank=True)
    sagemaker_job_name = models.CharField(max_length=160, blank=True)
    external_job_id = models.CharField(max_length=160, blank=True)
    output_s3_uri = models.CharField(max_length=1024, blank=True)
    model_artifact_uri = models.CharField(max_length=1024, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    error_message = models.TextField(blank=True)
    training_logs = models.TextField(blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
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
