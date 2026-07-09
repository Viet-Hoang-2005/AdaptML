"""
ASGI config for core project.

It exposes the ASGI callable as a module-level variable named ``application``.
Supports HTTP (Django views) protocol.
"""


import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

from django.core.asgi import get_asgi_application

application = get_asgi_application()

