import jwt
from rest_framework_simplejwt.serializers import (
    TokenObtainPairSerializer,
    TokenRefreshSerializer,
)
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

JWT_KID = "ai-paas-key-1"

class KIDTokenMixin:
    def __str__(self):
        token_backend = self.get_token_backend()
        payload = self.payload.copy()

        if token_backend.audience is not None:
            payload["aud"] = token_backend.audience
        if token_backend.issuer is not None:
            payload["iss"] = token_backend.issuer

        token = jwt.encode(
            payload,
            token_backend.signing_key,
            algorithm=token_backend.algorithm,
            headers={"kid": JWT_KID},
            json_encoder=token_backend.json_encoder,
        )

        if isinstance(token, bytes):
            return token.decode("utf-8")
        return token


class KIDAccessToken(KIDTokenMixin, AccessToken):
    pass

class KIDRefreshToken(KIDTokenMixin, RefreshToken):
    access_token_class = KIDAccessToken

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    token_class = KIDRefreshToken

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["tenant_id"] = getattr(user, "tenant_id", f"tenant_{user.id}")
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["tenant_id"] = self.user.tenant_id
        return data

class CustomTokenRefreshSerializer(TokenRefreshSerializer):
    token_class = KIDRefreshToken
