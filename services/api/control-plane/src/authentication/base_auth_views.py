from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth import get_user_model
from .otp_service import request_otp, verify_otp
from .serializers import CustomTokenObtainPairSerializer
from django.core.cache import cache
import uuid

User = get_user_model()

class RequestOTPView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = request.data.get('email')
        if not email:
            return Response({"error": "Vui lòng cung cấp email."}, status=status.HTTP_400_BAD_REQUEST)
            
        # Gửi OTP (sẽ ghi đè nếu đã có)
        try:
            request_otp(email)
            return Response({"message": f"Mã OTP đã được gửi đến {email}"}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": f"Không thể gửi email: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class VerifyOTPView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        email = request.data.get('email')
        otp_code = request.data.get('otp_code')
        
        if not email or not otp_code:
            return Response({"error": "Thiếu email hoặc mã OTP."}, status=status.HTTP_400_BAD_REQUEST)
            
        is_valid = verify_otp(email, otp_code)
        if not is_valid:
            return Response({"error": "Mã OTP không hợp lệ hoặc đã hết hạn."}, status=status.HTTP_400_BAD_REQUEST)
            
        # Nếu hợp lệ, cấp một token tạm thời để cho phép đi tiếp sang màn hình cập nhật thông tin
        temp_token = str(uuid.uuid4())
        cache.set(f"register_token:{temp_token}", email, timeout=600) # 10 phút để điền form
        
        return Response({
            "message": "Xác thực OTP thành công.",
            "registration_token": temp_token
        }, status=status.HTTP_200_OK)

class CompleteRegistrationView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        token = request.data.get('registration_token')
        if not token:
            return Response({"error": "Thiếu registration_token."}, status=status.HTTP_400_BAD_REQUEST)
            
        email = cache.get(f"register_token:{token}")
        if not email:
            return Response({"error": "Token đăng ký không hợp lệ hoặc đã hết hạn."}, status=status.HTTP_400_BAD_REQUEST)
            
        # Lấy thông tin
        full_name = request.data.get('full_name', '')
        avatar = request.data.get('avatar', '')
        field_of_work = request.data.get('field_of_work', '')
        country = request.data.get('country', '')
        password = request.data.get('password')
        
        if not password:
            return Response({"error": "Vui lòng cung cấp mật khẩu."}, status=status.HTTP_400_BAD_REQUEST)
            
        # Kiểm tra xem user đã tồn tại chưa (có thể user OAuth muốn cập nhật thành Base Auth)
        user, created = User.objects.get_or_create(email=email)
        
        # Khôi phục tài khoản nếu người dùng đăng ký lại sau khi Soft Delete
        if not created and not user.is_active:
            user.is_active = True
            user.deleted_at = None
            
        user.full_name = full_name
        user.avatar = avatar
        user.field_of_work = field_of_work
        user.country = country
        user.set_password(password)
        
        if created:
            user.auth_provider = 'email'
        
        user.save()
        
        # Xóa token tạm
        cache.delete(f"register_token:{token}")
        
        # Trả về JWT Token luôn để đăng nhập
        jwt_token = CustomTokenObtainPairSerializer.get_token(user)
        
        return Response({
            "message": "Đăng ký thành công.",
            "access": str(jwt_token.access_token),
            "refresh": str(jwt_token),
            "tenant_id": user.tenant_id
        }, status=status.HTTP_201_CREATED)
