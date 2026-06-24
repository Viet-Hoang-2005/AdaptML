"""
ASGI config for core project.

It exposes the ASGI callable as a module-level variable named ``application``.
Supports both HTTP (Django views) and WebSocket (Django Channels) protocols.
"""

import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter

django_asgi_app = get_asgi_application()

from realtime.ws_routing import websocket_urlpatterns
from realtime.ws_middleware import TokenAuthMiddlewareStack

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": TokenAuthMiddlewareStack(
        URLRouter(websocket_urlpatterns)
    ),
})
