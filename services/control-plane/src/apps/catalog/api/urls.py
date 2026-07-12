from django.urls import path

from .endpoints import (
    ModelProjectDetailEndpoint,
    ModelProjectListCreateEndpoint,
    RequirementsEndpoint,
    WorkspaceFilesEndpoint,
)

urlpatterns = [
    path("", ModelProjectListCreateEndpoint.as_view(), name="model-list"),
    path("<uuid:project_id>/", ModelProjectDetailEndpoint.as_view(), name="model-detail"),
    path("<uuid:project_id>/workspace/<str:kind>/files/", WorkspaceFilesEndpoint.as_view(), name="workspace-files"),
    path("<uuid:project_id>/requirements/", RequirementsEndpoint.as_view(), name="requirements"),
]
