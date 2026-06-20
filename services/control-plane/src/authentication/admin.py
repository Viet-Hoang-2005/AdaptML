from django.contrib import admin
from .models import CustomUser, ModelAPI, UserAPIKey

@admin.register(CustomUser)
class CustomUserAdmin(admin.ModelAdmin):
    list_display = ("email", "tenant_id", "auth_provider", "is_active", "is_staff", "date_joined")
    search_fields = ("email", "tenant_id")
    list_filter = ("auth_provider", "is_active", "is_staff")
    readonly_fields = ("tenant_id", "api_key", "date_joined")

@admin.register(UserAPIKey)
class UserAPIKeyAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "key_prefix", "created_at", "revoked_at")
    search_fields = ("name", "key_prefix", "user__email")
    list_filter = ("created_at", "revoked_at")
    readonly_fields = ("key_prefix", "key_hash", "created_at")

@admin.register(ModelAPI)
class ModelAPIAdmin(admin.ModelAdmin):
    list_display = ("name", "tenant", "access_mode", "status", "updated_at")
    search_fields = ("name", "tenant__email", "tenant__tenant_id")
    list_filter = ("access_mode", "status", "created_at")
    readonly_fields = ("model_uri", "endpoint_url", "created_at", "updated_at")
