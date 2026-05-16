from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
import uuid
import secrets
from django.core.cache import cache

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
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
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
