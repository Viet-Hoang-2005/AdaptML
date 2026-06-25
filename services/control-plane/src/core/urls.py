"""
URL configuration for core project.
"""

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("authentication.urls")),
    path("api/models/", include("registry.urls")),
    path("api/training/", include("training.urls")),
    path("api/drift/", include("drift.urls")),
]
