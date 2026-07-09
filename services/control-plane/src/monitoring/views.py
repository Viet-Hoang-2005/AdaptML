import logging
from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404

from authentication.models import ModelAPI
from integrations.hashid_utils import encode_model_id
from monitoring.adapters import PrometheusObservabilityAdapter

logger = logging.getLogger(__name__)


class ModelAPIObservabilityView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, model_id):
        """
        GET /api/monitoring/models/<hashid:model_id>/observability/ (or via registry URL include)
        Returns comprehensive serving observability metrics across 3 core groups:
        - Group 1: Traffic & Performance (RPS, Latency P50/P95, Error Rate, Micro-batch Efficiency)
        - Group 2: Hardware Resource Utilization (CPU %, RAM MB, Net RX/TX KB/s)
        - Group 3: Lifecycle & Health status (Pod Status, Uptime, Probe check)
        """
        model_api = get_object_or_404(ModelAPI, id=model_id, tenant=request.user)
        container_name = model_api.endpoint_container_name or f"endpoint-{request.user.tenant_id.lower()}-model-{encode_model_id(model_id).lower()}"
        model_type = getattr(model_api, "model_type", "ml")

        prometheus_url = getattr(settings, "PROMETHEUS_INTERNAL_URL", "")

        if not prometheus_url:
            # Fallback when Prometheus is not deployed/accessible (e.g., local Docker compose dev environment without K8s)
            return Response(
                {
                    "model_id": encode_model_id(model_api.id),
                    "container_name": container_name,
                    "model_type": model_type,
                    "endpoint_status": model_api.endpoint_status,
                    "data_source": "unavailable",
                    "reason": "Prometheus is only available in the Kubernetes environment.",
                    "queried_at": timezone.now().isoformat(),
                    "group1_traffic": {
                        "rps_current": 0.0,
                        "latency_p50_ms": 0.0,
                        "latency_p95_ms": 0.0,
                        "error_rate_pct": 0.0,
                        "avg_batch_size": 0.0,
                        "batch_wait_ms": 0.0,
                        "traffic_source": "model-server-gateway",
                    },
                    "group2_resources": {
                        "cpu_percent": 0.0,
                        "memory_mb": 0.0,
                        "network_rx_kbps": 0.0,
                        "network_tx_kbps": 0.0,
                    },
                    "group3_health": {
                        "pod_status": "Running (Docker)" if model_api.endpoint_status in {"healthy", "ready"} else (model_api.endpoint_status or "NotDeployed"),
                        "is_ready": model_api.endpoint_status in {"healthy", "ready"},
                        "ready_replicas": 1 if model_api.endpoint_status in {"healthy", "ready"} else 0,
                        "desired_replicas": 1 if model_api.endpoint_status in {"healthy", "ready"} else 0,
                        "uptime_seconds": 0,
                        "livez": "ok" if model_api.endpoint_status in {"healthy", "ready"} else "unreachable",
                        "readyz": "ok" if model_api.endpoint_status in {"healthy", "ready"} else "unreachable",
                    },
                },
                status=status.HTTP_200_OK,
            )

        adapter = PrometheusObservabilityAdapter(
            prometheus_url=prometheus_url,
            container_name=container_name,
            model_type=model_type,
            tenant_id=model_api.tenant.tenant_id,
            model_id=str(model_api.id),
        )

        group1 = adapter.get_group1_traffic()
        group2 = adapter.get_group2_resources()
        group3 = adapter.get_group3_health(model_api)

        return Response(
            {
                "model_id": encode_model_id(model_api.id),
                "container_name": container_name,
                "model_type": model_type,
                "endpoint_status": model_api.endpoint_status,
                "data_source": "prometheus",
                "queried_at": timezone.now().isoformat(),
                "group1_traffic": group1,
                "group2_resources": group2,
                "group3_health": group3,
            },
            status=status.HTTP_200_OK,
        )
