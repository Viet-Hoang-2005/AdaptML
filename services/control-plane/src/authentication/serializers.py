import jwt
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from django.contrib.auth import get_user_model
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from rest_framework_simplejwt.settings import api_settings

JWT_KID = "mlops-paas-key-1"

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

    default_error_messages = {
        "no_active_account": "Invalid email or password."
    }

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["tenant_id"] = getattr(user, "tenant_id", f"tenant_{user.id}")
        token["session_auth_hash"] = user.get_session_auth_hash()
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["tenant_id"] = self.user.tenant_id
        return data

class CustomTokenRefreshSerializer(TokenRefreshSerializer):
    token_class = KIDRefreshToken

    def validate(self, attrs):
        User = get_user_model()
        
        # NOTE: We must decode the token BEFORE calling super().validate(attrs).
        # Because if ROTATE_REFRESH_TOKENS and BLACKLIST_AFTER_ROTATION are True,
        # super().validate(attrs) will blacklist the token. If we decode it after,
        # self.token_class() will check the blacklist and raise TokenError!
        refresh = self.token_class(attrs["refresh"])
        user_id = refresh.payload.get(api_settings.USER_ID_CLAIM)
        
        try:
            user = User.objects.get(**{api_settings.USER_ID_FIELD: user_id}, is_active=True)
            
            session_auth_hash = refresh.payload.get("session_auth_hash")
            if session_auth_hash and session_auth_hash != user.get_session_auth_hash():
                raise AuthenticationFailed("Password has been changed since token was issued.", code="password_changed")
                
        except User.DoesNotExist:
            raise AuthenticationFailed("User not found or inactive", code="user_not_found")
            
        data = super().validate(attrs)
        return data
