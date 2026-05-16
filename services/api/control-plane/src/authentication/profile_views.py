from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from .otp_service import request_otp, verify_otp
from django.utils import timezone
from django.core.cache import cache
from confluent_kafka import Producer
import os
import json
import secrets

class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        return Response({
            "email": user.email,
            "full_name": user.full_name,
            "avatar": user.avatar,
            "field_of_work": user.field_of_work,
            "country": user.country,
            "tenant_id": user.tenant_id,
            "auth_provider": user.auth_provider,
            "date_joined": user.date_joined
        })

    def put(self, request):
        user = request.user
        user.full_name = request.data.get('full_name', user.full_name)
        
        # Hỗ trợ nhận file ảnh từ Form-Data (request.FILES) hoặc URL (request.data)
        avatar_file = request.FILES.get('avatar') or request.data.get('avatar')
        if avatar_file:
            user.avatar = avatar_file
            
        user.field_of_work = request.data.get('field_of_work', user.field_of_work)
        user.country = request.data.get('country', user.country)
        user.save()
        
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
        except Exception as e:
            return Response({"error": f"Unable to send email: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class PasswordChangeCompleteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        otp_code = request.data.get('otp_code')
        new_password = request.data.get('new_password')
        
        if not otp_code or not new_password:
            return Response({"error": "Missing OTP code or new password."}, status=status.HTTP_400_BAD_REQUEST)
            
        if verify_otp(user.email, otp_code):
            user.set_password(new_password)
            user.save()
            return Response({"message": "Password set successfully! You can now log in using Base Auth."}, status=status.HTTP_200_OK)
            
        return Response({"error": "The OTP code is invalid or has expired."}, status=status.HTTP_400_BAD_REQUEST)

class AccountDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request):
        user = request.user
        # 1. Soft delete tại Django
        user.is_active = False
        user.deleted_at = timezone.now()
        user.save()
        
        # 2. Gửi sự kiện lên Redpanda để FastAPI scale replicas xuống 0
        try:
            redpanda_brokers = os.environ.get('REDPANDA_BROKERS', 'localhost:19092')
            producer = Producer({'bootstrap.servers': redpanda_brokers})
            
            event_payload = {
                "event": "TENANT_SUSPENDED",
                "tenant_id": user.tenant_id,
                "action": "scale_to_zero"
            }
            
            producer.produce(
                'ai_paas_control_events', 
                key=user.tenant_id, 
                value=json.dumps(event_payload)
            )
            producer.flush(timeout=2.0)
            
        except Exception as e:
            print(f"Failed to publish event to Redpanda: {e}")
            # Dù Redpanda lỗi thì vẫn trả về 200 vì acc đã bị khóa ở Django
            pass
            
        return Response({"message": "Your account has been disabled! API models will be paused."}, status=status.HTTP_200_OK)

class APIKeyManagementView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Lấy API Key hiện tại."""
        user = request.user
        return Response({
            "api_key": user.api_key,
            "tenant_id": user.tenant_id
        }, status=status.HTTP_200_OK)

    def post(self, request):
        """Rotate (Tạo lại) API Key mới và thu hồi Key cũ."""
        user = request.user
        
        # Xóa key cũ trên Redis
        if user.api_key:
            cache.delete(f"api_key:{user.api_key}")
            
        # Sinh key mới
        new_key = f"sk_live_{secrets.token_urlsafe(32)}"
        user.api_key = new_key
        user.save() # save() sẽ tự động cập nhật key mới lên Redis
        
        return Response({
            "message": "API key has been successfully changed! The old key has been revoked.",
            "api_key": new_key
        }, status=status.HTTP_200_OK)
