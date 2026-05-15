from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth import get_user_model
from django.conf import settings
from .serializers import CustomTokenObtainPairSerializer
from django.core.files.base import ContentFile
import requests
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

User = get_user_model()

def get_or_create_oauth_user(email, full_name, avatar_url, provider):
    """Tìm hoặc tạo User mới từ OAuth."""
    user, created = User.objects.get_or_create(email=email)
    
    # Khôi phục tài khoản nếu người dùng đăng nhập lại sau khi Soft Delete
    if not created and not user.is_active:
        user.is_active = True
        user.deleted_at = None
        user.save()
        
    if created:
        user.full_name = full_name
        user.auth_provider = provider
        user.set_unusable_password() # Cấm đăng nhập bằng mật khẩu tạm thời
        
        # Tải ảnh avatar từ URL của Google/GitHub và lưu vào S3
        if avatar_url:
            try:
                response = requests.get(avatar_url, timeout=5)
                if response.status_code == 200:
                    # Tạo tên file ngẫu nhiên dựa trên email
                    file_name = f"{email.split('@')[0]}_{provider}_avatar.jpg"
                    user.avatar.save(file_name, ContentFile(response.content), save=False)
            except Exception as e:
                print(f"Không thể tải avatar từ {avatar_url}: {e}")
                
        user.save()
        
    # Tạo JWT Token
    jwt_token = CustomTokenObtainPairSerializer.get_token(user)
    return {
        "message": "Đăng nhập thành công.",
        "access": str(jwt_token.access_token),
        "refresh": str(jwt_token),
        "tenant_id": user.tenant_id,
        "is_new_user": created
    }

class GoogleOAuthView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        token = request.data.get('token')
        if not token:
            return Response({"error": "Thiếu id_token từ Google."}, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            # Verify token với Google
            client_id = settings.GOOGLE_OAUTH2_CLIENT_ID
            idinfo = id_token.verify_oauth2_token(token, google_requests.Request(), client_id)
            
            email = idinfo.get('email')
            full_name = idinfo.get('name', '')
            avatar = idinfo.get('picture', '')
            
            if not email:
                return Response({"error": "Không lấy được email từ Google."}, status=status.HTTP_400_BAD_REQUEST)
                
            response_data = get_or_create_oauth_user(email, full_name, avatar, 'google')
            return Response(response_data, status=status.HTTP_200_OK)
            
        except ValueError as e:
            return Response({"error": f"Token không hợp lệ: {str(e)}"}, status=status.HTTP_401_UNAUTHORIZED)
            
class GitHubOAuthView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        access_token = request.data.get('token')
        if not access_token:
            return Response({"error": "Thiếu access_token từ GitHub."}, status=status.HTTP_400_BAD_REQUEST)
            
        headers = {'Authorization': f'token {access_token}'}
        
        # 1. Lấy thông tin cơ bản
        user_response = requests.get('https://api.github.com/user', headers=headers)
        if user_response.status_code != 200:
            return Response({"error": "Xác thực GitHub thất bại."}, status=status.HTTP_401_UNAUTHORIZED)
            
        user_data = user_response.json()
        email = user_data.get('email')
        full_name = user_data.get('name', user_data.get('login', ''))
        avatar = user_data.get('avatar_url', '')
        
        # 2. Nếu email bị private, gọi API phụ để lấy list emails
        if not email:
            emails_response = requests.get('https://api.github.com/user/emails', headers=headers)
            if emails_response.status_code == 200:
                emails_data = emails_response.json()
                # Tìm email primary và verified
                for e in emails_data:
                    if e.get('primary') and e.get('verified'):
                        email = e.get('email')
                        break
        
        if not email:
            return Response({"error": "Không thể truy cập địa chỉ email (Primary & Verified) từ GitHub."}, status=status.HTTP_400_BAD_REQUEST)
            
        response_data = get_or_create_oauth_user(email, full_name, avatar, 'github')
        return Response(response_data, status=status.HTTP_200_OK)
