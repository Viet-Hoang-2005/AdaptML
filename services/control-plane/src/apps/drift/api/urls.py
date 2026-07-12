from django.urls import path

from .endpoints import DriftMonitorDetailEndpoint, DriftMonitorListCreateEndpoint, DriftRunEndpoint

urlpatterns = [
    path("", DriftMonitorListCreateEndpoint.as_view(), name="drift-monitor-list"),
    path("<uuid:monitor_id>/", DriftMonitorDetailEndpoint.as_view(), name="drift-monitor-detail"),
    path("<uuid:monitor_id>/runs/", DriftRunEndpoint.as_view(), name="drift-run"),
]
