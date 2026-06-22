import json
import os
import secrets
import uuid

from confluent_kafka import Producer
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from PIL import Image, UnidentifiedImageError

from .models import UserAPIKey, UserAvatar, ModelAPI
from .otp_service import request_otp, verify_otp

PASSWORD_CHANGE_TOKEN_TTL_SECONDS = 600
MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024

def avatar_url(avatar):
    if not avatar:
        return ""
    try:
        return avatar.url
    except Exception:
        return str(avatar)

class ProfileView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        user = request.user

        return Response({
            "email": user.email,
            "full_name": user.full_name,
            "description": user.description,
            "pronouns": user.pronouns,
            "company": user.company,
            "avatar": avatar_url(user.avatar),
            "field_of_work": user.field_of_work,
            "country": user.country,
            "tenant_id": user.tenant_id,
            "auth_provider": user.auth_provider,
            "date_joined": user.date_joined,
        })

    def put(self, request):
        user = request.user
        user.full_name = request.data.get("full_name", user.full_name)
        user.description = request.data.get("description", user.description)
        user.pronouns = request.data.get("pronouns", user.pronouns)
        user.company = request.data.get("company", user.company)

        avatar_file = request.FILES.get("avatar") or request.data.get("avatar")
        remove_avatar = str(request.data.get("remove_avatar", "")).lower() in {"1", "true", "yes"}

        if remove_avatar and user.avatar:
            current_avatar_name = user.avatar.name
            avatar_record = UserAvatar.objects.filter(user=user, image=current_avatar_name).first()
            if avatar_record:
                avatar_record.image.delete(save=False)
                avatar_record.delete()
            else:
                user.avatar.delete(save=False)
            user.avatar = None

        if avatar_file:
            if avatar_file.size > MAX_AVATAR_SIZE_BYTES:
                return Response(
                    {"error": "Avatar image must be 5MB or smaller."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not getattr(avatar_file, "content_type", "").startswith("image/"):
                return Response(
                    {"error": "Avatar must be an image file."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                image = Image.open(avatar_file)
                image.verify()
                avatar_file.seek(0)
            except (UnidentifiedImageError, OSError):
                return Response(
                    {"error": "Avatar image is invalid or corrupted."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            user.avatar = avatar_file

        user.field_of_work = request.data.get("field_of_work", user.field_of_work)
        user.country = request.data.get("country", user.country)
        user.save()

        if avatar_file and user.avatar:
            UserAvatar.objects.create(user=user, image=user.avatar.name)

        return Response({"message": "Profile updated successfully."}, status=status.HTTP_200_OK)

class AvatarHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        current_avatar_name = user.avatar.name if user.avatar else ""
        avatars = user.avatar_history.all()
        return Response({
            "avatars": [
                {
                    "id": avatar.id,
                    "url": avatar_url(avatar.image),
                    "is_current": avatar.image.name == current_avatar_name,
                    "created_at": avatar.created_at,
                }
                for avatar in avatars
            ]
        }, status=status.HTTP_200_OK)

class AvatarSelectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, avatar_id):
        avatar = UserAvatar.objects.filter(id=avatar_id, user=request.user).first()
        if not avatar:
            return Response({"error": "Avatar not found."}, status=status.HTTP_404_NOT_FOUND)

        request.user.avatar = avatar.image.name
        request.user.save(update_fields=["avatar"])

        return Response({"message": "Avatar selected successfully."}, status=status.HTTP_200_OK)

class PasswordChangeRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        try:
            sent, message = request_otp(user.email)
            if not sent:
                return Response({"error": message}, status=status.HTTP_429_TOO_MANY_REQUESTS)
            return Response({"message": f"OTP code has been sent: {user.email}"}, status=status.HTTP_200_OK)
        except Exception as exc:
            return Response({"error": f"Unable to send email: {str(exc)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class PasswordChangeVerifyOTPView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        otp_code = request.data.get("otp_code")

        if not otp_code:
            return Response({"error": "Missing OTP code."}, status=status.HTTP_400_BAD_REQUEST)

        if not verify_otp(user.email, otp_code):
            return Response({"error": "The OTP code is invalid or has expired."}, status=status.HTTP_400_BAD_REQUEST)

        password_change_token = str(uuid.uuid4())
        cache.set(
            f"password_change_token:{password_change_token}",
            user.email,
            timeout=PASSWORD_CHANGE_TOKEN_TTL_SECONDS,
        )

        return Response({
            "message": "OTP verified successfully.",
            "password_change_token": password_change_token,
        }, status=status.HTTP_200_OK)

class PasswordChangeCompleteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        otp_code = request.data.get("otp_code")
        password_change_token = request.data.get("password_change_token")
        new_password = request.data.get("new_password")

        if not new_password:
            return Response({"error": "Missing new password."}, status=status.HTTP_400_BAD_REQUEST)

        token_key = f"password_change_token:{password_change_token}" if password_change_token else None
        token_email = cache.get(token_key) if token_key else None

        if (token_email and token_email == user.email) or (otp_code and verify_otp(user.email, otp_code)):
            user.set_password(new_password)
            user.save()
            if token_key:
                cache.delete(token_key)
            return Response({"message": "Password set successfully! You can now log in using Base Auth."}, status=status.HTTP_200_OK)

        return Response({"error": "The OTP code or password change token is invalid or has expired."}, status=status.HTTP_400_BAD_REQUEST)

class AccountDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request):
        user = request.user
        user.is_active = False
        user.deleted_at = timezone.now()
        user.save()

        try:
            redpanda_brokers = os.environ.get("REDPANDA_BROKERS", "localhost:19092")
            producer = Producer({"bootstrap.servers": redpanda_brokers})

            event_payload = {
                "event": "TENANT_SUSPENDED",
                "tenant_id": user.tenant_id,
                "action": "scale_to_zero",
            }

            producer.produce(
                "mlops_paas_control_events",
                key=user.tenant_id,
                value=json.dumps(event_payload),
            )
            producer.flush(timeout=2.0)

        except Exception as exc:
            print(f"Failed to publish event to Redpanda: {exc}")

        return Response({"message": "Your account has been disabled! API models will be paused."}, status=status.HTTP_200_OK)

class APIKeyManagementView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        keys = user.api_keys.filter(revoked_at__isnull=True).prefetch_related('allowed_models')
        return Response({
            "tenant_id": user.tenant_id,
            "api_keys": [
                {
                    "id": key.id,
                    "name": key.name,
                    "description": key.description,
                    "scope": key.scope,
                    "allowed_models": list(key.allowed_models.values_list('id', flat=True)),
                    "key_prefix": key.key_prefix,
                    "created_at": key.created_at,
                }
                for key in keys
            ],
        }, status=status.HTTP_200_OK)

    def post(self, request):
        user = request.user
        name = (request.data.get("name") or "").strip()
        description = (request.data.get("description") or "").strip()
        scope = request.data.get("scope", "all")
        allowed_models_ids = request.data.get("allowed_models", [])

        if not name:
            return Response({"error": "API key name is required."}, status=status.HTTP_400_BAD_REQUEST)

        raw_key = f"sk_live_{secrets.token_urlsafe(32)}"
        key_prefix = raw_key[:16]

        api_key = UserAPIKey.objects.create(
            user=user,
            name=name,
            description=description,
            scope=scope,
            key_prefix=key_prefix,
            key_hash=make_password(raw_key),
        )
        
        if scope == "specific" and allowed_models_ids:
            models = ModelAPI.objects.filter(id__in=allowed_models_ids, tenant=user)
            api_key.allowed_models.set(models)

        allowed_model_ids_list = list(api_key.allowed_models.values_list('id', flat=True))
        payload = {
            "tenant_id": user.tenant_id,
            "scope": scope,
            "allowed_models": allowed_model_ids_list
        }
        cache.set(f"api_key:{raw_key}", json.dumps(payload), timeout=None)
        cache.set(f"api_key_reverse:{api_key.id}", raw_key, timeout=None)

        return Response({
            "message": "API key has been created. Store it now because it will only be shown once.",
            "api_key": raw_key,
            "key_prefix": key_prefix,
            "id": api_key.id,
            "name": api_key.name,
            "description": api_key.description,
            "scope": api_key.scope,
            "allowed_models": allowed_model_ids_list,
        }, status=status.HTTP_201_CREATED)

class APIKeyDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, key_id):
        api_key = UserAPIKey.objects.filter(id=key_id, user=request.user, revoked_at__isnull=True).first()
        if not api_key:
            return Response({"error": "API key not found."}, status=status.HTTP_404_NOT_FOUND)

        name = (request.data.get("name") or "").strip()
        description = (request.data.get("description") or "").strip()
        scope = request.data.get("scope", api_key.scope)
        allowed_models_ids = request.data.get("allowed_models", [])

        if not name:
            return Response({"error": "API key name is required."}, status=status.HTTP_400_BAD_REQUEST)

        api_key.name = name
        api_key.description = description
        api_key.scope = scope
        api_key.save(update_fields=["name", "description", "scope"])
        
        if scope == "specific":
            models = ModelAPI.objects.filter(id__in=allowed_models_ids, tenant=request.user)
            api_key.allowed_models.set(models)
        else:
            api_key.allowed_models.clear()
            
        allowed_model_ids_list = list(api_key.allowed_models.values_list('id', flat=True))
        
        raw_key = cache.get(f"api_key_reverse:{api_key.id}")
        if raw_key:
            payload = {
                "tenant_id": request.user.tenant_id,
                "scope": scope,
                "allowed_models": allowed_model_ids_list
            }
            cache.set(f"api_key:{raw_key}", json.dumps(payload), timeout=None)

        return Response({
            "message": "API key updated successfully.",
            "id": api_key.id,
            "name": api_key.name,
            "description": api_key.description,
            "scope": api_key.scope,
            "allowed_models": allowed_model_ids_list,
            "key_prefix": api_key.key_prefix,
            "created_at": api_key.created_at,
        }, status=status.HTTP_200_OK)

    def delete(self, request, key_id):
        api_key = UserAPIKey.objects.filter(id=key_id, user=request.user, revoked_at__isnull=True).first()
        if not api_key:
            return Response({"error": "API key not found."}, status=status.HTTP_404_NOT_FOUND)

        api_key.revoked_at = timezone.now()
        api_key.save(update_fields=["revoked_at"])

        raw_key = cache.get(f"api_key_reverse:{api_key.id}")
        if raw_key:
            cache.delete(f"api_key:{raw_key}")
            cache.delete(f"api_key_reverse:{api_key.id}")

        return Response({"message": "API key deleted successfully."}, status=status.HTTP_200_OK)

class APIKeyRegenerateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, key_id):
        api_key = UserAPIKey.objects.filter(id=key_id, user=request.user, revoked_at__isnull=True).first()
        if not api_key:
            return Response({"error": "API key not found."}, status=status.HTTP_404_NOT_FOUND)

        old_raw_key = cache.get(f"api_key_reverse:{api_key.id}")
        if old_raw_key:
            cache.delete(f"api_key:{old_raw_key}")

        raw_key = f"sk_live_{secrets.token_urlsafe(32)}"
        api_key.key_prefix = raw_key[:16]
        api_key.key_hash = make_password(raw_key)
        api_key.save(update_fields=["key_prefix", "key_hash"])

        allowed_model_ids_list = list(api_key.allowed_models.values_list('id', flat=True))
        payload = {
            "tenant_id": request.user.tenant_id,
            "scope": api_key.scope,
            "allowed_models": allowed_model_ids_list
        }

        cache.set(f"api_key:{raw_key}", json.dumps(payload), timeout=None)
        cache.set(f"api_key_reverse:{api_key.id}", raw_key, timeout=None)

        return Response({
            "message": "API key regenerated. Store it now because it will only be shown once.",
            "api_key": raw_key,
            "id": api_key.id,
            "name": api_key.name,
            "description": api_key.description,
            "scope": api_key.scope,
            "allowed_models": allowed_model_ids_list,
            "key_prefix": api_key.key_prefix,
        }, status=status.HTTP_200_OK)
