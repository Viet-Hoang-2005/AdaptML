from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)

        # Thêm các custom claims vào Payload
        # Giả sử User model sẽ được mở rộng có trường tenant_id sau này.
        # Hiện tại hardcode một tenant_id mẫu để phục vụ AI PaaS.
        token['tenant_id'] = getattr(user, 'tenant_id', f'tenant_{user.id}')
        
        # Thêm Header 'kid' (Key ID) để FastAPI nhận diện khóa
        # (SimpleJWT mặc định không nhét 'kid' vào header)
        
        return token
