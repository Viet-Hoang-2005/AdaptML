import uuid

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .otp_service import normalize_email, request_otp, verify_otp
from .serializers import CustomTokenObtainPairSerializer

User = get_user_model()


class RequestOTPView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = normalize_email(request.data.get("email"))
        if not email:
            return Response({"error": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)

        existing_user = User.objects.filter(email=email).first()
        if (
            existing_user
            and existing_user.is_active
            and existing_user.has_usable_password()
        ):
            return Response(
                {"error": "An active account already exists for this email."},
                status=status.HTTP_409_CONFLICT,
            )

        try:
            sent, message = request_otp(email)
            if not sent:
                return Response({"error": message}, status=status.HTTP_429_TOO_MANY_REQUESTS)

            return Response({"message": f"OTP has been sent to {email}."}, status=status.HTTP_200_OK)
        except Exception as exc:
            return Response(
                {"error": f"Unable to send OTP email: {str(exc)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class VerifyOTPView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = normalize_email(request.data.get("email"))
        otp_code = request.data.get("otp_code")

        if not email or not otp_code:
            return Response(
                {"error": "Email and OTP code are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not verify_otp(email, otp_code):
            return Response(
                {"error": "OTP is invalid, expired, or has too many failed attempts."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        registration_token = str(uuid.uuid4())
        cache.set(f"register_token:{registration_token}", email, timeout=600)

        return Response(
            {
                "message": "OTP verified successfully.",
                "registration_token": registration_token,
            },
            status=status.HTTP_200_OK,
        )


class CompleteRegistrationView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        token = request.data.get("registration_token")
        if not token:
            return Response(
                {"error": "registration_token is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email = cache.get(f"register_token:{token}")
        if not email:
            return Response(
                {"error": "Registration token is invalid or expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        password = request.data.get("password")
        if not password:
            return Response({"error": "Password is required."}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email=email).first()
        created = user is None

        if user and user.is_active and user.has_usable_password():
            return Response(
                {"error": "An active account already exists for this email."},
                status=status.HTTP_409_CONFLICT,
            )

        if created:
            user = User(email=email, auth_provider="email")

        if not user.is_active:
            user.is_active = True
            user.deleted_at = None

        user.full_name = request.data.get("full_name", "")
        user.avatar = request.data.get("avatar", "")
        user.field_of_work = request.data.get("field_of_work", "")
        user.country = request.data.get("country", "")
        user.set_password(password)
        user.save()

        cache.delete(f"register_token:{token}")

        refresh_token = CustomTokenObtainPairSerializer.get_token(user)

        return Response(
            {
                "message": "Registration completed successfully.",
                "access": str(refresh_token.access_token),
                "refresh": str(refresh_token),
                "tenant_id": user.tenant_id,
            },
            status=status.HTTP_201_CREATED,
        )
