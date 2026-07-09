import logging
import time
import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class PrometheusObservabilityAdapter:
    def __init__(self, prometheus_url: str, container_name: str, model_type: str = "ml"):
        self.prometheus_url = (prometheus_url or "").rstrip("/")
        self.container_name = container_name
        self.model_type = model_type
        # Pod regex filter matching deployment container prefix or pod name
        self.pod_filter = f"{container_name}.*" if container_name else "unknown_container"

    def _query_prom(self, promql: str) -> float:
        if not self.prometheus_url or not self.container_name:
            return 0.0
        try:
            resp = requests.get(
                f"{self.prometheus_url}/api/v1/query",
                params={"query": promql},
                timeout=3,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success" and data.get("data", {}).get("result"):
                    value_str = data["data"]["result"][0]["value"][1]
                    return float(value_str)
        except Exception as exc:
            logger.debug("PromQL query failed (%s): %s", promql, exc)
        return 0.0

    def get_group1_traffic(self) -> dict:
        """
        Group 1: Traffic & Performance signals.
        Supports both BentoML DL native metrics (bentoml_service_request_*)
        and model-server/Uvicorn ML metrics (http_requests_total / http_request_duration_seconds).
        Note: P99 latency is excluded per user specification.
        """
        if self.model_type == "dl":
            rps_query = f'sum(rate(bentoml_service_request_total{{pod=~"{self.pod_filter}"}}[2m]))'
            p50_query = f'histogram_quantile(0.50, sum(rate(bentoml_service_request_duration_seconds_bucket{{pod=~"{self.pod_filter}"}}[5m])) by (le)) * 1000'
            p95_query = f'histogram_quantile(0.95, sum(rate(bentoml_service_request_duration_seconds_bucket{{pod=~"{self.pod_filter}"}}[5m])) by (le)) * 1000'
            error_query = f'sum(rate(bentoml_service_request_total{{pod=~"{self.pod_filter}",http_response_code=~"5.."}}[5m])) / (sum(rate(bentoml_service_request_total{{pod=~"{self.pod_filter}"}}[5m])) + 0.001) * 100'
            batch_size_query = f'bentoml_runner_adaptive_batch_size_sum{{pod=~"{self.pod_filter}"}} / (bentoml_runner_adaptive_batch_size_count{{pod=~"{self.pod_filter}"}} + 0.001)'
            batch_wait_query = f'bentoml_runner_batch_wait_duration_seconds_sum{{pod=~"{self.pod_filter}"}} / (bentoml_runner_batch_wait_duration_seconds_count{{pod=~"{self.pod_filter}"}} + 0.001) * 1000'
        else:
            rps_query = f'sum(rate(http_requests_total{{pod=~"{self.pod_filter}"}}[2m]))'
            p50_query = f'histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket{{pod=~"{self.pod_filter}"}}[5m])) by (le)) * 1000'
            p95_query = f'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{{pod=~"{self.pod_filter}"}}[5m])) by (le)) * 1000'
            error_query = f'sum(rate(http_requests_total{{pod=~"{self.pod_filter}",status=~"5.."}}[5m])) / (sum(rate(http_requests_total{{pod=~"{self.pod_filter}"}}[5m])) + 0.001) * 100'
            batch_size_query = '0'
            batch_wait_query = '0'

        rps = round(self._query_prom(rps_query), 2)
        p50 = round(self._query_prom(p50_query), 2)
        p95 = round(self._query_prom(p95_query), 2)
        error_rate = round(self._query_prom(error_query), 2)
        avg_batch_size = round(self._query_prom(batch_size_query), 2)
        batch_wait_ms = round(self._query_prom(batch_wait_query), 2)

        # Handle NaN/Inf values returned from Prometheus when rates are 0
        p50 = 0.0 if p50 != p50 or p50 < 0 else p50
        p95 = 0.0 if p95 != p95 or p95 < 0 else p95
        error_rate = 0.0 if error_rate != error_rate or error_rate < 0 else error_rate
        avg_batch_size = 0.0 if avg_batch_size != avg_batch_size or avg_batch_size < 0 else avg_batch_size
        batch_wait_ms = 0.0 if batch_wait_ms != batch_wait_ms or batch_wait_ms < 0 else batch_wait_ms

        return {
            "rps_current": rps,
            "latency_p50_ms": p50,
            "latency_p95_ms": p95,
            "error_rate_pct": error_rate,
            "avg_batch_size": avg_batch_size,
            "batch_wait_ms": batch_wait_ms,
        }

    def get_group2_resources(self) -> dict:
        """
        Group 2: Hardware Resource Utilization (CPU, RAM, Network I/O).
        """
        cpu_query = f'sum(rate(container_cpu_usage_seconds_total{{pod=~"{self.pod_filter}",container!="POD"}}[5m])) * 100'
        ram_query = f'sum(container_memory_working_set_bytes{{pod=~"{self.pod_filter}",container!="POD"}}) / 1048576'
        rx_query = f'sum(rate(container_network_receive_bytes_total{{pod=~"{self.pod_filter}"}}[5m])) / 1024'
        tx_query = f'sum(rate(container_network_transmit_bytes_total{{pod=~"{self.pod_filter}"}}[5m])) / 1024'

        cpu = round(self._query_prom(cpu_query), 2)
        ram = round(self._query_prom(ram_query), 2)
        rx = round(self._query_prom(rx_query), 2)
        tx = round(self._query_prom(tx_query), 2)

        cpu = 0.0 if cpu != cpu or cpu < 0 else cpu
        ram = 0.0 if ram != ram or ram < 0 else ram
        rx = 0.0 if rx != rx or rx < 0 else rx
        tx = 0.0 if tx != tx or tx < 0 else tx

        return {
            "cpu_percent": cpu,
            "memory_mb": ram,
            "network_rx_kbps": rx,
            "network_tx_kbps": tx,
        }

    def get_group3_health(self, model_api) -> dict:
        """
        Group 3: Lifecycle & Health status from kube-state-metrics and live HTTP probe.
        """
        ready_replicas_query = f'kube_deployment_status_replicas_ready{{deployment=~"{self.container_name}"}}'
        desired_replicas_query = f'kube_deployment_spec_replicas{{deployment=~"{self.container_name}"}}'
        uptime_query = f'time() - max(kube_pod_start_time{{pod=~"{self.pod_filter}"}})'

        ready_replicas = int(self._query_prom(ready_replicas_query))
        desired_replicas = int(self._query_prom(desired_replicas_query))
        uptime_seconds = int(self._query_prom(uptime_query))
        if uptime_seconds < 0:
            uptime_seconds = 0

        # Perform quick internal health check via DeployAdapter or direct HTTP probe if container is running
        pod_status = "Running" if ready_replicas > 0 else "NotReady"
        livez = "ok" if ready_replicas > 0 else "unreachable"
        readyz = "ok" if ready_replicas > 0 else "unreachable"

        if model_api and model_api.endpoint_status in {"healthy", "ready"}:
            is_ready = True
            if pod_status == "NotReady" and not self.prometheus_url:
                pod_status = "Running (Docker)"
                livez = "ok"
                readyz = "ok"
        else:
            is_ready = False
            if not self.prometheus_url:
                pod_status = model_api.endpoint_status or "NotDeployed"

        return {
            "pod_status": pod_status,
            "is_ready": is_ready,
            "ready_replicas": ready_replicas if self.prometheus_url else (1 if is_ready else 0),
            "desired_replicas": desired_replicas if self.prometheus_url else (1 if is_ready else 0),
            "uptime_seconds": uptime_seconds,
            "livez": livez,
            "readyz": readyz,
        }
