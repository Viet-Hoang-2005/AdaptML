"""
WebSocket JWT authentication middleware.

Extracts the 'token' query parameter from the WebSocket URL,
validates it as an RS256 JWT using django-simplejwt, and attaches
the authenticated user to scope['user'].

Security notes:
- Token is extracted from query string (?token=...) since WS browsers
  cannot set Authorization headers.
- The token value is NEVER logged.
- If authentication fails, scope['user'] is set to AnonymousUser.
"""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from authentication.models import CustomUser
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError, InvalidToken


@database_sync_to_async
def get_user_from_token(raw_token: str):
    """
    Validates the JWT token and returns the authenticated user, or None.
    Does not log the token value.
    """
    try:
        validated = AccessToken(raw_token)
        user_id = validated.get('user_id')
        if not user_id:
            return None
        return CustomUser.objects.filter(pk=user_id, is_active=True).first()
    except (TokenError, InvalidToken):
        return None
    except Exception:
        return None


class TokenAuthMiddleware(BaseMiddleware):
    """
    Channels middleware that authenticates WS connections via JWT query param.
    Usage: ws://host/ws/training-jobs/42/?token=<access_token>
    """

    async def __call__(self, scope, receive, send):
        query_string = scope.get('query_string', b'').decode('utf-8')
        params = parse_qs(query_string)
        # Extract token without logging its value
        token_list = params.get('token', [])
        raw_token = token_list[0] if token_list else None

        if raw_token:
            user = await get_user_from_token(raw_token)
            scope['user'] = user if user else AnonymousUser()
        else:
            scope['user'] = AnonymousUser()

        return await super().__call__(scope, receive, send)


def TokenAuthMiddlewareStack(inner):
    return TokenAuthMiddleware(inner)
