from django.conf import settings
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.drift.selectors import monitor_for_user, monitors_for_user
from apps.drift.services.runs import request_run

from .serializers import DriftMonitorSerializer, DriftRunSerializer


class DriftMonitorListCreateEndpoint(generics.ListCreateAPIView):
    serializer_class = DriftMonitorSerializer

    def get_queryset(self):
        return monitors_for_user(self.request.user).prefetch_related("runs")

    def perform_create(self, serializer):
        serializer.save(backend=settings.DRIFT_BACKEND)


class DriftMonitorDetailEndpoint(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = DriftMonitorSerializer
    lookup_field = "public_id"
    lookup_url_kwarg = "monitor_id"

    def get_queryset(self):
        return monitors_for_user(self.request.user).prefetch_related("runs")


class DriftRunEndpoint(APIView):
    def post(self, request, monitor_id):
        monitor = monitor_for_user(request.user, monitor_id)
        run = request_run(monitor, request.headers.get("Idempotency-Key"))
        return Response(DriftRunSerializer(run).data, status=status.HTTP_202_ACCEPTED)
