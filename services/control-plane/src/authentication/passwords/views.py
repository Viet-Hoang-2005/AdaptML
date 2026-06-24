import uuid

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.registration.otp_service import normalize_email, request_otp, verify_otp

User = get_user_model()
PASSWORD_RESET_TOKEN_TTL_SECONDS = 600

class PasswordResetRequestOTPView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = normalize_email(request.data.get("email"))
        if not email:
            return Response({"error": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email=email, is_active=True).first()
        if not user:
            return Response({"error": "No active account exists for this email."}, status=status.HTTP_404_NOT_FOUND)

        try:
            sent, message = request_otp(email)
            if not sent:
                return Response({"error": message}, status=status.HTTP_429_TOO_MANY_REQUESTS)

            return Response({"message": f"OTP has been sent to {email}.", "email": email}, status=status.HTTP_200_OK)
        except Exception as exc:
            return Response(
                {"error": f"Unable to send OTP email: {str(exc)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class PasswordResetVerifyOTPView(APIView):
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

        user = User.objects.filter(email=email, is_active=True).first()
        if not user:
            return Response({"error": "No active account exists for this email."}, status=status.HTTP_404_NOT_FOUND)

        if not verify_otp(email, otp_code):
            return Response(
                {"error": "OTP is invalid, expired, or has too many failed attempts."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reset_token = str(uuid.uuid4())
        cache.set(f"password_reset_token:{reset_token}", email, timeout=PASSWORD_RESET_TOKEN_TTL_SECONDS)

        return Response(
            {"message": "OTP verified successfully.", "reset_token": reset_token},
            status=status.HTTP_200_OK,
        )


class PasswordResetCompleteView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        reset_token = request.data.get("reset_token")
        new_password = request.data.get("new_password")

        if not reset_token or not new_password:
            return Response(
                {"error": "reset_token and new_password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(new_password) < 8:
            return Response(
                {"error": "Password must be at least 8 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email = cache.get(f"password_reset_token:{reset_token}")
        if not email:
            return Response(
                {"error": "Password reset token is invalid or expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.filter(email=email, is_active=True).first()
        if not user:
            return Response({"error": "No active account exists for this email."}, status=status.HTTP_404_NOT_FOUND)

        user.set_password(new_password)
        user.save()
        cache.delete(f"password_reset_token:{reset_token}")

        return Response({"message": "Password reset successfully."}, status=status.HTTP_200_OK)
