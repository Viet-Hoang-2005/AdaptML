from django.urls import path

from .endpoints import (
    BuildMetadataEndpoint,
    ModelDraftCreateEndpoint,
    ModelProjectDetailEndpoint,
    ModelProjectListCreateEndpoint,
    ProjectBuildEndpoint,
    RequirementsEndpoint,
    WorkspaceFilesEndpoint,
)

urlpatterns = [
    path("drafts/", ModelDraftCreateEndpoint.as_view(), name="model-draft-create"),
    path("", ModelProjectListCreateEndpoint.as_view(), name="model-list"),
    path("<uuid:project_id>/", ModelProjectDetailEndpoint.as_view(), name="model-detail"),
    path("<uuid:project_id>/build-metadata/", BuildMetadataEndpoint.as_view(), name="build-metadata"),
    path("<uuid:project_id>/builds/", ProjectBuildEndpoint.as_view(), name="project-builds"),
    path("<uuid:project_id>/workspace/<str:kind>/files/", WorkspaceFilesEndpoint.as_view(), name="workspace-files"),
    path("<uuid:project_id>/requirements/", RequirementsEndpoint.as_view(), name="requirements"),
]
