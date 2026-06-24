import requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.registration.otp_service import normalize_email
from authentication.tokens.serializers import CustomTokenObtainPairSerializer
from authentication.models import UserAvatar

User = get_user_model()

GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_EMAILS_URL = "https://api.github.com/user/emails"
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

def build_auth_response(user, created):
    jwt_token = CustomTokenObtainPairSerializer.get_token(user)
    return {
        "message": "OAuth login successful.",
        "access": str(jwt_token.access_token),
        "refresh": str(jwt_token),
        "tenant_id": user.tenant_id,
        "is_new_user": created,
    }

def get_or_create_oauth_user(email, full_name, avatar_url, provider):
    email = normalize_email(email)
    user, created = User.objects.get_or_create(email=email)

    if not created and not user.is_active:
        user.is_active = True
        user.deleted_at = None

    if created:
        user.auth_provider = provider
        user.set_unusable_password()

    if full_name and (created or not user.full_name):
        user.full_name = full_name

    if avatar_url and created:
        try:
            response = requests.get(avatar_url, timeout=5)
            if response.status_code == 200:
                file_name = f"{email.split('@')[0]}_{provider}_avatar.jpg"
                user.avatar.save(file_name, ContentFile(response.content), save=False)
        except Exception as exc:
            print(f"Unable to fetch OAuth avatar from {avatar_url}: {exc}")

    user.save()

    if avatar_url and created and user.avatar:
        UserAvatar.objects.get_or_create(user=user, image=user.avatar.name)

    return build_auth_response(user, created)


class GoogleOAuthView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        token = request.data.get("token")
        if not token:
            return Response({"error": "Google token is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not settings.GOOGLE_OAUTH2_CLIENT_ID:
            return Response(
                {"error": "GOOGLE_OAUTH2_CLIENT_ID is not configured."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if token.count(".") == 2:
            try:
                idinfo = id_token.verify_oauth2_token(
                    token,
                    google_requests.Request(),
                    settings.GOOGLE_OAUTH2_CLIENT_ID,
                )
            except ValueError as exc:
                return Response({"error": f"Invalid Google token: {str(exc)}"}, status=status.HTTP_401_UNAUTHORIZED)
        else:
            try:
                tokeninfo_response = requests.get(
                    GOOGLE_TOKENINFO_URL,
                    params={"access_token": token},
                    timeout=5,
                )
                if tokeninfo_response.status_code != 200:
                    return Response({"error": "Invalid Google access token."}, status=status.HTTP_401_UNAUTHORIZED)

                tokeninfo = tokeninfo_response.json()
                if tokeninfo.get("aud") != settings.GOOGLE_OAUTH2_CLIENT_ID:
                    return Response({"error": "Google token audience is invalid."}, status=status.HTTP_401_UNAUTHORIZED)

                userinfo_response = requests.get(
                    GOOGLE_USERINFO_URL,
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=5,
                )
                if userinfo_response.status_code != 200:
                    return Response({"error": "Unable to fetch Google user info."}, status=status.HTTP_401_UNAUTHORIZED)

                idinfo = userinfo_response.json()
            except requests.RequestException as exc:
                return Response({"error": f"Unable to contact Google: {str(exc)}"}, status=status.HTTP_502_BAD_GATEWAY)

        email = normalize_email(idinfo.get("email"))
        if not email:
            return Response({"error": "Google token does not contain an email."}, status=status.HTTP_400_BAD_REQUEST)

        if not idinfo.get("email_verified"):
            return Response({"error": "Google email is not verified."}, status=status.HTTP_401_UNAUTHORIZED)

        response_data = get_or_create_oauth_user(
            email=email,
            full_name=idinfo.get("name", ""),
            avatar_url=idinfo.get("picture", ""),
            provider="google",
        )
        return Response(response_data, status=status.HTTP_200_OK)


class GitHubOAuthView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        code = request.data.get("code")
        redirect_uri = request.data.get("redirect_uri") or settings.GITHUB_OAUTH_REDIRECT_URI

        if not code:
            return Response({"error": "GitHub authorization code is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not settings.GITHUB_OAUTH2_CLIENT_ID or not settings.GITHUB_OAUTH2_CLIENT_SECRET:
            return Response(
                {"error": "GitHub OAuth client ID/secret are not configured."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        try:
            token_response = requests.post(
                GITHUB_TOKEN_URL,
                data={
                    "client_id": settings.GITHUB_OAUTH2_CLIENT_ID,
                    "client_secret": settings.GITHUB_OAUTH2_CLIENT_SECRET,
                    "code": code,
                    "redirect_uri": redirect_uri,
                },
                headers={"Accept": "application/json"},
                timeout=5,
            )
        except requests.RequestException as exc:
            return Response({"error": f"Unable to contact GitHub: {str(exc)}"}, status=status.HTTP_502_BAD_GATEWAY)

        if token_response.status_code != 200:
            return Response({"error": "GitHub token exchange failed."}, status=status.HTTP_401_UNAUTHORIZED)

        token_payload = token_response.json()
        access_token = token_payload.get("access_token")
        if not access_token:
            return Response(
                {"error": token_payload.get("error_description", "GitHub did not return an access token.")},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
        }

        user_response = requests.get(GITHUB_USER_URL, headers=headers, timeout=5)
        if user_response.status_code != 200:
            return Response({"error": "Unable to fetch GitHub profile."}, status=status.HTTP_401_UNAUTHORIZED)

        user_data = user_response.json()
        email = normalize_email(user_data.get("email"))

        if not email:
            emails_response = requests.get(GITHUB_EMAILS_URL, headers=headers, timeout=5)
            if emails_response.status_code == 200:
                for item in emails_response.json():
                    if item.get("primary") and item.get("verified"):
                        email = normalize_email(item.get("email"))
                        break

        if not email:
            return Response(
                {"error": "Unable to access a primary verified GitHub email."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        response_data = get_or_create_oauth_user(
            email=email,
            full_name=user_data.get("name") or user_data.get("login") or "",
            avatar_url=user_data.get("avatar_url", ""),
            provider="github",
        )
        return Response(response_data, status=status.HTTP_200_OK)
