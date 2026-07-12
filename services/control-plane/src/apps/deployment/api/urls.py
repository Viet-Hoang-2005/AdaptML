from django.urls import path

from .endpoints import (
    BuildCancelEndpoint,
    BuildDetailEndpoint,
    BuildListCreateEndpoint,
    DeploymentDetailEndpoint,
    DeploymentListCreateEndpoint,
    DeploymentStopEndpoint,
    EndpointListEndpoint,
    EndpointLogsEndpoint,
)

build_patterns = [
    path("", BuildListCreateEndpoint.as_view(), name="build-list"),
    path("<uuid:build_id>/", BuildDetailEndpoint.as_view(), name="build-detail"),
    path("<uuid:build_id>/cancel/", BuildCancelEndpoint.as_view(), name="build-cancel"),
]
deployment_patterns = [
    path("", DeploymentListCreateEndpoint.as_view(), name="deployment-list"),
    path("<uuid:deployment_id>/", DeploymentDetailEndpoint.as_view(), name="deployment-detail"),
    path("<uuid:deployment_id>/stop/", DeploymentStopEndpoint.as_view(), name="deployment-stop"),
]
endpoint_patterns = [
    path("", EndpointListEndpoint.as_view(), name="endpoint-list"),
    path("<uuid:endpoint_id>/logs/", EndpointLogsEndpoint.as_view(), name="endpoint-logs"),
]
