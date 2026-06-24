import json
import secrets

from django.contrib.auth.hashers import make_password
from django.utils import timezone
from django_redis import get_redis_connection

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.models import ModelAPI, UserAPIKey
from integrations.hashid_utils import decode_model_id, encode_model_id

class APIKeyManagementView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        keys = user.api_keys.filter(revoked_at__isnull=True).prefetch_related("allowed_models")
        return Response({
            "tenant_id": user.tenant_id,
            "api_keys": [
                {
                    "id": key.id,
                    "name": key.name,
                    "description": key.description,
                    "scope": key.scope,
                    "allowed_models": [encode_model_id(mid) for mid in key.allowed_models.values_list("id", flat=True)],
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
        
        decoded_model_ids = []
        for mid in allowed_models_ids:
            try:
                decoded = decode_model_id(mid)
                if decoded is not None:
                    decoded_model_ids.append(decoded)
            except Exception:
                pass

        api_key = UserAPIKey.objects.create(
            user=user,
            name=name,
            description=description,
            scope=scope,
            key_prefix=key_prefix,
            key_hash=make_password(raw_key),
        )

        if scope == "specific" and decoded_model_ids:
            models = ModelAPI.objects.filter(id__in=decoded_model_ids, tenant=user)
            api_key.allowed_models.set(models)

        allowed_model_ids_list = list(api_key.allowed_models.values_list("id", flat=True))
        payload = {
            "tenant_id": user.tenant_id,
            "scope": scope,
            "allowed_models": allowed_model_ids_list,
        }
        redis_client = get_redis_connection("default")
        redis_client.set(f":1:api_key:{raw_key}", json.dumps(payload))
        redis_client.set(f":1:api_key_reverse:{api_key.id}", raw_key)

        return Response({
            "message": "API key has been created. Store it now because it will only be shown once.",
            "api_key": raw_key,
            "key_prefix": key_prefix,
            "id": api_key.id,
            "name": api_key.name,
            "description": api_key.description,
            "scope": api_key.scope,
            "allowed_models": [encode_model_id(mid) for mid in allowed_model_ids_list],
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

        decoded_model_ids = []
        for mid in allowed_models_ids:
            try:
                decoded = decode_model_id(mid)
                if decoded is not None:
                    decoded_model_ids.append(decoded)
            except Exception:
                pass

        if scope == "specific":
            models = ModelAPI.objects.filter(id__in=decoded_model_ids, tenant=request.user)
            api_key.allowed_models.set(models)
        else:
            api_key.allowed_models.clear()

        allowed_model_ids_list = list(api_key.allowed_models.values_list("id", flat=True))

        redis_client = get_redis_connection("default")
        raw_key = redis_client.get(f":1:api_key_reverse:{api_key.id}")
        if raw_key:
            if isinstance(raw_key, bytes):
                raw_key = raw_key.decode("utf-8")
            payload = {
                "tenant_id": request.user.tenant_id,
                "scope": scope,
                "allowed_models": allowed_model_ids_list,
            }
            redis_client.set(f":1:api_key:{raw_key}", json.dumps(payload))

        return Response({
            "message": "API key updated successfully.",
            "id": api_key.id,
            "name": api_key.name,
            "description": api_key.description,
            "scope": api_key.scope,
            "allowed_models": [encode_model_id(mid) for mid in allowed_model_ids_list],
            "key_prefix": api_key.key_prefix,
            "created_at": api_key.created_at,
        }, status=status.HTTP_200_OK)

    def delete(self, request, key_id):
        api_key = UserAPIKey.objects.filter(id=key_id, user=request.user, revoked_at__isnull=True).first()
        if not api_key:
            return Response({"error": "API key not found."}, status=status.HTTP_404_NOT_FOUND)

        api_key.revoked_at = timezone.now()
        api_key.save(update_fields=["revoked_at"])
        
        redis_client = get_redis_connection("default")
        raw_key = redis_client.get(f":1:api_key_reverse:{api_key.id}")
        if raw_key:
            if isinstance(raw_key, bytes):
                raw_key = raw_key.decode("utf-8")
            redis_client.delete(f":1:api_key:{raw_key}")
            redis_client.delete(f":1:api_key_reverse:{api_key.id}")

        return Response({"message": "API key deleted successfully."}, status=status.HTTP_200_OK)


class APIKeyRegenerateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, key_id):
        api_key = UserAPIKey.objects.filter(id=key_id, user=request.user, revoked_at__isnull=True).first()
        if not api_key:
            return Response({"error": "API key not found."}, status=status.HTTP_404_NOT_FOUND)

        redis_client = get_redis_connection("default")
        old_raw_key = redis_client.get(f":1:api_key_reverse:{api_key.id}")
        if old_raw_key:
            if isinstance(old_raw_key, bytes):
                old_raw_key = old_raw_key.decode("utf-8")
            redis_client.delete(f":1:api_key:{old_raw_key}")

        raw_key = f"sk_live_{secrets.token_urlsafe(32)}"
        api_key.key_prefix = raw_key[:16]
        api_key.key_hash = make_password(raw_key)
        api_key.save(update_fields=["key_prefix", "key_hash"])

        allowed_model_ids_list = list(api_key.allowed_models.values_list("id", flat=True))
        payload = {
            "tenant_id": request.user.tenant_id,
            "scope": api_key.scope,
            "allowed_models": allowed_model_ids_list,
        }
        redis_client.set(f":1:api_key:{raw_key}", json.dumps(payload))
        redis_client.set(f":1:api_key_reverse:{api_key.id}", raw_key)

        return Response({
            "message": "API key regenerated. Store it now because it will only be shown once.",
            "api_key": raw_key,
            "id": api_key.id,
            "name": api_key.name,
            "description": api_key.description,
            "scope": api_key.scope,
            "allowed_models": [encode_model_id(mid) for mid in allowed_model_ids_list],
            "key_prefix": api_key.key_prefix,
        }, status=status.HTTP_200_OK)
