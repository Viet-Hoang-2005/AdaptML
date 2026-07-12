from django.conf import settings
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.deployment.selectors import (
    build_for_user,
    builds_for_user,
    deployment_for_user,
    deployments_for_user,
    endpoint_for_user,
    endpoints_for_user,
)
from apps.deployment.services.builds import request_build, request_cancel
from apps.deployment.services.deployments import endpoint_logs, request_deployment, request_stop

from .serializers import BuildSerializer, DeploymentSerializer, EndpointSerializer


class BuildListCreateEndpoint(generics.ListCreateAPIView):
    serializer_class = BuildSerializer

    def get_queryset(self):
        return builds_for_user(self.request.user)

    def perform_create(self, serializer):
        version = serializer.validated_data["version"]
        serializer.instance = request_build(version, settings.BUILD_BACKEND)


class BuildDetailEndpoint(generics.RetrieveAPIView):
    serializer_class = BuildSerializer
    lookup_field = "public_id"
    lookup_url_kwarg = "build_id"

    def get_queryset(self):
        return builds_for_user(self.request.user)


class BuildCancelEndpoint(APIView):
    def post(self, request, build_id):
        build = request_cancel(build_for_user(request.user, build_id))
        return Response(BuildSerializer(build).data, status=status.HTTP_202_ACCEPTED)


class DeploymentListCreateEndpoint(generics.ListCreateAPIView):
    serializer_class = DeploymentSerializer

    def get_queryset(self):
        return deployments_for_user(self.request.user)

    def perform_create(self, serializer):
        build = serializer.validated_data["build"]
        serializer.instance = request_deployment(build, settings.DEPLOYMENT_BACKEND)


class DeploymentDetailEndpoint(generics.RetrieveAPIView):
    serializer_class = DeploymentSerializer
    lookup_field = "public_id"
    lookup_url_kwarg = "deployment_id"

    def get_queryset(self):
        return deployments_for_user(self.request.user)


class DeploymentStopEndpoint(APIView):
    def post(self, request, deployment_id):
        deployment = request_stop(deployment_for_user(request.user, deployment_id))
        return Response(DeploymentSerializer(deployment).data, status=status.HTTP_202_ACCEPTED)


class EndpointListEndpoint(generics.ListAPIView):
    serializer_class = EndpointSerializer

    def get_queryset(self):
        return endpoints_for_user(self.request.user)


class EndpointLogsEndpoint(APIView):
    def get(self, request, endpoint_id):
        endpoint = endpoint_for_user(request.user, endpoint_id)
        return Response(
            {
                "endpoint_id": str(endpoint.public_id),
                "runtime_name": endpoint.runtime_name,
                "logs": endpoint_logs(endpoint),
            }
        )
