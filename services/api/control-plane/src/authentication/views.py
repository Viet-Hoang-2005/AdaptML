from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.views import TokenRefreshView
from cryptography.hazmat.primitives import serialization
from .serializers import CustomTokenObtainPairSerializer, CustomTokenRefreshSerializer
from .utils import PUBLIC_KEY
import base64

class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer

class CustomTokenRefreshView(TokenRefreshView):
    serializer_class = CustomTokenRefreshSerializer

def int_to_base64url(value: int) -> str:
    """Convert Integer to Base64URL string (for JWK parameters)."""
    value_hex = format(value, 'x')
    # Ensure even length
    if len(value_hex) % 2 == 1:
        value_hex = '0' + value_hex
    value_bytes = bytes.fromhex(value_hex)
    return base64.urlsafe_b64encode(value_bytes).rstrip(b'=').decode('utf-8')

class JWKSView(APIView):
    authentication_classes = [] # Public endpoint
    permission_classes = []

    def get(self, request, *args, **kwargs):
        """Trả về tập hợp khóa công khai (JWKS) cho FastAPI sử dụng."""
        # Tải khóa RSA từ utils
        public_key_obj = serialization.load_pem_public_key(PUBLIC_KEY)
        numbers = public_key_obj.public_numbers()
        
        jwks = {
            "keys": [
                {
                    "kty": "RSA",
                    "alg": "RS256",
                    "use": "sig",
                    "kid": "mlops-paas-key-1", # Key ID trùng với header kid của token
                    "n": int_to_base64url(numbers.n),
                    "e": int_to_base64url(numbers.e)
                }
            ]
        }
        return Response(jwks)
