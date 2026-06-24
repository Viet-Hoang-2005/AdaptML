import json
import os
import uuid

from confluent_kafka import Producer
from django.core.cache import cache
from django.utils import timezone
from PIL import Image, UnidentifiedImageError
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.models import UserAvatar
from authentication.profiles.utils import avatar_url
from authentication.registration.otp_service import request_otp, verify_otp

PASSWORD_CHANGE_TOKEN_TTL_SECONDS = 600
MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024


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
