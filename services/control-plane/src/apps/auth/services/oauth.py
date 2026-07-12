from django.conf import settings
from django.contrib.auth import get_user_model
from infrastructure.http import HttpClient
from rest_framework.exceptions import AuthenticationFailed, ValidationError


def authenticate_google(access_token, http=None):
    if not settings.GOOGLE_OAUTH2_CLIENT_ID:
        raise ValidationError({"google": "Google OAuth is not configured."})
    response = (http or HttpClient()).request(
        "GET",
        "https://www.googleapis.com/oauth2/v3/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    profile = response.json()
    email = profile.get("email")
    if not email or not profile.get("email_verified"):
        raise AuthenticationFailed("Google account email is not verified.")
    return _oauth_user(email, profile.get("name", ""), "google")


def authenticate_github(code, redirect_uri, http=None):
    if not settings.GITHUB_OAUTH2_CLIENT_ID or not settings.GITHUB_OAUTH2_CLIENT_SECRET:
        raise ValidationError({"github": "GitHub OAuth is not configured."})
    client = http or HttpClient()
    token = (
        client.request(
            "POST",
            "https://github.com/login/oauth/access_token",
            json={
                "client_id": settings.GITHUB_OAUTH2_CLIENT_ID,
                "client_secret": settings.GITHUB_OAUTH2_CLIENT_SECRET,
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Accept": "application/json"},
        )
        .json()
        .get("access_token")
    )
    if not token:
        raise AuthenticationFailed("GitHub did not return an access token.")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    profile = client.request("GET", "https://api.github.com/user", headers=headers).json()
    email = profile.get("email")
    if not email:
        emails = client.request("GET", "https://api.github.com/user/emails", headers=headers).json()
        email = next((item["email"] for item in emails if item.get("primary") and item.get("verified")), None)
    if not email:
        raise AuthenticationFailed("GitHub account has no verified primary email.")
    return _oauth_user(email, profile.get("name") or profile.get("login", ""), "github")


def _oauth_user(email, full_name, provider):
    user, created = get_user_model().objects.get_or_create(
        email__iexact=email,
        defaults={"email": email, "full_name": full_name, "auth_provider": provider},
    )
    if not user.is_active:
        raise AuthenticationFailed("Account is disabled.")
    return user, created
