import logging
import os
import threading
import time
import docker
import requests
from requests import exceptions as requests_exceptions

from django.conf import settings
from django.utils import timezone
from authentication.models import ModelAPI
from integrations.hashid_utils import encode_model_id

logger = logging.getLogger(__name__)

def endpoint_container_name(tenant_id: str, model_id: int) -> str:
    return f"endpoint-{tenant_id.lower()}-model-{encode_model_id(model_id).lower()}"

def endpoint_image_name(tenant_id: str, model_id: int) -> str:
    return f"{tenant_id.lower()}-model-{encode_model_id(model_id).lower()}:latest"


def model_api_auth_headers(model_api) -> dict:
    api_key = getattr(getattr(model_api, "tenant", None), "api_key", "") if model_api else ""
    return {"X-API-Key": api_key} if api_key else {}


def endpoint_failure_payload(
    *,
    status_value: str,
    reason_code: str,
    message: str,
    endpoint_url: str = "",
    internal_url: str = "",
    technical_detail: str = "",
) -> dict:
    payload = {
        "success": False,
        "status": status_value,
        "reason_code": reason_code,
        "message": message,
        "endpoint_url": endpoint_url,
        "internal_url": internal_url,
    }
    if technical_detail:
        payload["technical_detail"] = technical_detail
    return payload


def friendly_request_failure(exc: Exception, endpoint_url: str = "", internal_url: str = "") -> dict:
    detail = str(exc)
    if isinstance(exc, requests_exceptions.Timeout):
        return endpoint_failure_payload(
            status_value="timeout",
            reason_code="ENDPOINT_TIMEOUT",
            message="The model endpoint did not respond before the health-check timeout.",
            endpoint_url=endpoint_url,
            internal_url=internal_url,
            technical_detail=detail,
        )
    if "NameResolutionError" in detail or "Failed to resolve" in detail or "Temporary failure in name resolution" in detail:
        return endpoint_failure_payload(
            status_value="not_running",
            reason_code="ENDPOINT_CONTAINER_NOT_FOUND",
            message=(
                "The model endpoint container is not running in the local Docker network. "
                "Run deploy again or start the local model server runtime."
            ),
            endpoint_url=endpoint_url,
            internal_url=internal_url,
            technical_detail=detail,
        )
    return endpoint_failure_payload(
        status_value="not_reachable",
        reason_code="ENDPOINT_NOT_REACHABLE",
        message="The model endpoint is not reachable from the control-plane container.",
        endpoint_url=endpoint_url,
        internal_url=internal_url,
        technical_detail=detail,
    )

class DeployAdapter:
    def deploy_model(self, model_id: int, tenant_id: str, model_name: str, version: str):
        raise NotImplementedError()

    def remove_model(self, model_id: int):
        raise NotImplementedError()

class DockerDeployAdapter(DeployAdapter):
    def deploy_model(self, model_id: int, tenant_id: str, model_name: str, version: str):
        model_api = ModelAPI.objects.filter(id=model_id).first()
        if not model_api:
            logger.error("Cannot deploy missing model %s", model_id)
            return
        try:
            client = docker.from_env()
            custom_image_name = endpoint_image_name(tenant_id, model_id)
            try:
                client.images.get(custom_image_name)
                image_name = custom_image_name
                logger.info("Found custom Docker image %s for model %s. Using it.", image_name, model_id)
            except docker.errors.ImageNotFound:
                image_name = "mlops-paas-model-server"
                logger.info("Using shared Base Image %s with Dynamic Runtime Injection for model %s.", image_name, model_id)

            container_name = endpoint_container_name(tenant_id, model_id)

            try:
                old_container = client.containers.get(container_name)
                old_container.remove(force=True)
                logger.info("Removed previous endpoint container %s before redeploy.", container_name)
            except docker.errors.NotFound:
                pass

            # Traefik labels - tenant_id must be the tenant code (e.g. T-24B1E790), NOT the DB PK integer.
            hashid_str = encode_model_id(model_id)
            public_path = f"/{tenant_id}/models/{hashid_str}/{version}/predict"
            internal_path = f"/models/{hashid_str}/predict"
            labels = {
                "traefik.enable": "true",
                f"traefik.http.routers.model_{model_id}.rule": f"PathPrefix(`{public_path}`)",
                f"traefik.http.middlewares.rewrite_{model_id}.replacepath.path": internal_path,
                f"traefik.http.routers.model_{model_id}.middlewares": f"rewrite_{model_id}",
                f"traefik.http.services.model_{model_id}.loadbalancer.server.port": "5000",
            }

            network_name = getattr(settings, "DOCKER_NETWORK_NAME", "mlops_paas_network")
            db_user = os.environ.get("DB_USER", "postgres")
            db_password = os.environ.get("DB_PASSWORD", "postgres")
            db_name = os.environ.get("DB_NAME", "mlops_paas")
            db_host = os.environ.get("DB_HOST_RO", "postgres")
            db_port = os.environ.get("DB_PORT", "5432")

            environment = {
                "PYTHONUNBUFFERED": "1",
                "DB_USER": db_user,
                "DB_PASSWORD": db_password,
                "DB_NAME": db_name,
                "DB_HOST_RO": db_host,
                "DB_PORT": db_port,
                "REDPANDA_BROKERS": "redpanda:9092",
                "KAFKA_TOPIC": os.environ.get("KAFKA_TOPIC", "mlops_paas_production_data"),
                "JWKS_URL": "http://control-plane:8000/api/auth/.well-known/jwks.json",
                "CONTROL_PLANE_DB_SCHEMA": os.environ.get("DB_SCHEMA", "control_plane"),
                "REDIS_URL": "redis://redis:6379/1",
                "AWS_DEFAULT_REGION": os.environ.get("AWS_DEFAULT_REGION", "ap-southeast-1"),
                "AWS_BUCKET_NAME": os.environ.get("AWS_BUCKET_NAME", ""),
            }

            logger.info(
                "Deploying endpoint container=%s model=%s | public_path=%s -> internal=%s | network=%s image=%s",
                container_name, model_id, public_path, internal_path, network_name, image_name,
            )
            model_api.status = "deploying"
            model_api.endpoint_status = "deploying"
            model_api.endpoint_error = ""
            model_api.endpoint_container_name = container_name
            model_api.endpoint_image_name = image_name
            model_api.endpoint_public_path = public_path
            model_api.endpoint_internal_path = internal_path
            model_api.endpoint_last_checked_at = timezone.now()
            model_api.save(update_fields=[
                "status",
                "endpoint_status",
                "endpoint_error",
                "endpoint_container_name",
                "endpoint_image_name",
                "endpoint_public_path",
                "endpoint_internal_path",
                "endpoint_last_checked_at",
                "updated_at",
            ])

            client.containers.run(
                image=image_name,
                name=container_name,
                environment=environment,
                labels=labels,
                network=network_name,
                volumes={"pip-cache": {"bind": "/root/.cache/pip", "mode": "rw"}},
                detach=True,
                restart_policy={"Name": "always"},
            )
            healthy, payload_or_error = self.wait_for_health(model_id)
            model_api.refresh_from_db()
            model_api.endpoint_last_checked_at = timezone.now()
            if healthy:
                model_api.status = "deployed"
                model_api.endpoint_status = "healthy"
                model_api.endpoint_error = ""
                logger.info("Endpoint model=%s became healthy: %s", model_id, payload_or_error)
            else:
                model_api.status = "deploy_failed"
                model_api.endpoint_status = "deploy_failed"
                model_api.endpoint_error = payload_or_error.get("message", str(payload_or_error)) if isinstance(payload_or_error, dict) else str(payload_or_error)
                logger.warning("Endpoint model=%s failed health check: %s", model_id, payload_or_error)
            model_api.save(update_fields=[
                "status",
                "endpoint_status",
                "endpoint_error",
                "endpoint_last_checked_at",
                "updated_at",
            ])
        except Exception as e:
            detail = str(e)
            logger.error("Error starting endpoint container for %s: %s", model_id, detail)
            ModelAPI.objects.filter(id=model_id).update(
                status="deploy_failed",
                endpoint_status="deploy_failed",
                endpoint_error="Local model endpoint container could not be started.",
                endpoint_last_checked_at=timezone.now(),
            )

    def wait_for_health(self, model_id: int, timeout_seconds: int = 45, interval_seconds: int = 3) -> tuple[bool, str]:
        model_api = ModelAPI.objects.filter(id=model_id).first()
        tenant_id = model_api.tenant.tenant_id if model_api else "unknown"
        container_name = model_api.endpoint_container_name or endpoint_container_name(tenant_id, model_id)
        url = f"http://{container_name}:5000/models/{encode_model_id(model_id)}/health"
        deadline = time.monotonic() + timeout_seconds
        last_error: dict | str = "Endpoint health check did not run."
        while time.monotonic() < deadline:
            healthy, payload = self.check_health(model_id)
            if healthy:
                return True, payload
            last_error = payload
            time.sleep(interval_seconds)
        return False, last_error

    def check_health(self, model_id: int) -> tuple[bool, dict | str]:
        model_api = ModelAPI.objects.filter(id=model_id).first()
        tenant_id = model_api.tenant.tenant_id if model_api else "unknown"
        container_name = model_api.endpoint_container_name or endpoint_container_name(tenant_id, model_id)
        url = f"http://{container_name}:5000/models/{encode_model_id(model_id)}/health"
        endpoint_url = model_api.endpoint_url if model_api else ""
        try:
            client = docker.from_env()
            container = client.containers.get(container_name)
            container.reload()
            if container.status != "running":
                return False, endpoint_failure_payload(
                    status_value="not_running",
                    reason_code="ENDPOINT_CONTAINER_NOT_FOUND",
                    message="The model endpoint container exists but is not running. Run deploy again to recreate it.",
                    endpoint_url=endpoint_url,
                    internal_url=url,
                    technical_detail=f"Container {container_name} status is {container.status}.",
                )
        except docker.errors.NotFound:
            return False, endpoint_failure_payload(
                status_value="not_running",
                reason_code="ENDPOINT_CONTAINER_NOT_FOUND",
                message=(
                    "The model endpoint container is not running in the local Docker network. "
                    "Run deploy again or start the local model server runtime."
                ),
                endpoint_url=endpoint_url,
                internal_url=url,
                technical_detail=f"Container {container_name} was not found.",
            )
        except docker.errors.DockerException as exc:
            logger.warning("Could not inspect endpoint container %s before health check: %s", container_name, exc)
        try:
            response = requests.get(url, headers=model_api_auth_headers(model_api), timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data.get("model_loaded") is True:
                    data.update({"success": True, "status": "healthy", "reason_code": ""})
                    return True, data
                return False, endpoint_failure_payload(
                    status_value="unhealthy",
                    reason_code="ENDPOINT_UNHEALTHY",
                    message="The model endpoint responded, but the model is not loaded yet.",
                    endpoint_url=endpoint_url,
                    internal_url=url,
                    technical_detail=str(data),
                )
            return False, endpoint_failure_payload(
                status_value="unhealthy",
                reason_code="ENDPOINT_UNHEALTHY",
                message=f"The model endpoint health route returned HTTP {response.status_code}.",
                endpoint_url=endpoint_url,
                internal_url=url,
                technical_detail=response.text[:500],
            )
        except requests_exceptions.RequestException as exc:
            return False, friendly_request_failure(exc, endpoint_url=endpoint_url, internal_url=url)

    def remove_model(self, model_id: int):
        model_api = ModelAPI.objects.filter(id=model_id).first()
        tenant_id = model_api.tenant.tenant_id if model_api else "unknown"
        try:
            client = docker.from_env()
            container_name = model_api.endpoint_container_name or endpoint_container_name(tenant_id, model_id)
            try:
                container = client.containers.get(container_name)
                container.remove(force=True)
                logger.info(f"Removed container {container_name}")
            except docker.errors.NotFound:
                pass
        except Exception as e:
            logger.error(f"Error removing container for {model_id}: {e}")

    def endpoint_logs(self, model_id: int, tail: int = 300) -> str:
        model_api = ModelAPI.objects.filter(id=model_id).first()
        tenant_id = model_api.tenant.tenant_id if model_api else "unknown"
        client = docker.from_env()
        container_name = model_api.endpoint_container_name or endpoint_container_name(tenant_id, model_id)
        container = client.containers.get(container_name)
        logs = container.logs(tail=tail, stdout=True, stderr=True)
        return logs.decode("utf-8", errors="replace")[-20000:]

    def cleanup_model(self, model_id: int, remove_images: bool = False) -> dict:
        model_api = ModelAPI.objects.filter(id=model_id).first()
        tenant_id = model_api.tenant.tenant_id if model_api else "unknown"
        client = docker.from_env()
        removed = {"containers": [], "images": []}
        
        container_name = model_api.endpoint_container_name or endpoint_container_name(tenant_id, model_id)
        build_container_name = f"build_{tenant_id}_model_{model_id}"
        names = [container_name, build_container_name]
        
        for name in names:
            try:
                container = client.containers.get(name)
                container.remove(force=True)
                removed["containers"].append(name)
            except docker.errors.NotFound:
                pass
        if remove_images:
            image = model_api.endpoint_image_name if model_api and model_api.endpoint_image_name else endpoint_image_name(tenant_id, model_id)
            try:
                client.images.remove(image=image, force=True)
                removed["images"].append(image)
            except docker.errors.ImageNotFound:
                pass
        return removed

class ArgoDeployAdapter(DeployAdapter):
    def deploy_model(self, model_id: int, tenant_id: str, model_name: str, version: str):
        model_api = ModelAPI.objects.filter(id=model_id).first()
        if not model_api:
            logger.error("Cannot deploy missing model %s", model_id)
            return

        webhook_url = os.environ.get("ARGO_DEPLOY_WEBHOOK_URL", "http://webhook-eventsource-eventsource-svc.default.svc.cluster.local:12000/deploy")
        container_name = endpoint_container_name(tenant_id, model_id)
        hashid_str = encode_model_id(model_id)
        public_path = f"/{tenant_id}/models/{hashid_str}/{version}/predict"
        internal_path = f"/models/{hashid_str}/predict"
        
        image_name = model_api.endpoint_image_name
        if not image_name:
            harbor_url = os.environ.get("HARBOR_REGISTRY_URL", "registry.mlops-nids-nt114.id.vn").strip().rstrip("/")
            harbor_project = getattr(settings, "HARBOR_USER_PROJECT", "user-images")
            image_name = f"{harbor_url}/{harbor_project}/mlops-paas-model-server:latest"
            logger.info("Using shared Harbor Base Image %s with Dynamic Runtime Injection for model %s.", image_name, model_id)

        payload = {
            "tenant_id": tenant_id,
            "model_id": str(model_id),
            "hashid": hashid_str,
            "version": version,
            "image_name": image_name,
            "container_name": container_name
        }

        model_api.status = "deploying"
        model_api.endpoint_status = "deploying"
        model_api.endpoint_error = ""
        model_api.endpoint_container_name = container_name
        model_api.endpoint_image_name = image_name
        model_api.endpoint_public_path = public_path
        model_api.endpoint_internal_path = internal_path
        model_api.endpoint_last_checked_at = timezone.now()
        model_api.save(update_fields=[
            "status", "endpoint_status", "endpoint_error",
            "endpoint_container_name", "endpoint_image_name",
            "endpoint_public_path", "endpoint_internal_path",
            "endpoint_last_checked_at", "updated_at"
        ])

        try:
            logger.info("Sending deploy payload to Argo Events at %s: %s", webhook_url, payload)
            response = requests.post(webhook_url, json=payload, timeout=10)
            response.raise_for_status()
            logger.info("Successfully triggered Argo Deploy Workflow for model %s", model_id)
        except Exception as e:
            logger.error("Failed to trigger Argo Deploy Workflow for model %s: %s", model_id, e)
            model_api.status = "deploy_failed"
            model_api.endpoint_status = "deploy_failed"
            model_api.endpoint_error = str(e)
            model_api.save(update_fields=["status", "endpoint_status", "endpoint_error", "updated_at"])

    def wait_for_health(self, model_id: int, timeout_seconds: int = 45, interval_seconds: int = 3) -> tuple[bool, str]:
        model_api = ModelAPI.objects.filter(id=model_id).first()
        tenant_id = model_api.tenant.tenant_id if model_api else "unknown"
        container_name = model_api.endpoint_container_name or endpoint_container_name(tenant_id, model_id)
        url = f"http://{container_name}-svc:5000/models/{encode_model_id(model_id)}/health"
        deadline = time.monotonic() + timeout_seconds
        last_error = "Endpoint health check did not run."
        while time.monotonic() < deadline:
            try:
                response = requests.get(url, timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("model_loaded") is True:
                        return True, str(data)
                    last_error = f"Endpoint returned health payload but model_loaded is not true: {data}"
                else:
                    last_error = f"HTTP {response.status_code}: {response.text[:500]}"
            except Exception as exc:
                last_error = str(exc)
            time.sleep(interval_seconds)
        return False, last_error

    def check_health(self, model_id: int) -> tuple[bool, dict | str]:
        model_api = ModelAPI.objects.filter(id=model_id).first()
        tenant_id = model_api.tenant.tenant_id if model_api else "unknown"
        container_name = model_api.endpoint_container_name or endpoint_container_name(tenant_id, model_id)
        url = f"http://{container_name}-svc:5000/models/{encode_model_id(model_id)}/health"
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                data = response.json()
                return data.get("model_loaded") is True, data
            return False, f"HTTP {response.status_code}: {response.text[:500]}"
        except Exception as exc:
            return False, str(exc)

    def remove_model(self, model_id: int):
        webhook_url = os.environ.get("ARGO_EVENTS_WEBHOOK_URL")
        if not webhook_url:
            logger.error("ARGO_EVENTS_WEBHOOK_URL is not set.")
            return
        
        model_api = ModelAPI.objects.filter(id=model_id).first()
        if not model_api:
            return
            
        tenant_id = model_api.tenant.tenant_id
        container_name = model_api.endpoint_container_name or endpoint_container_name(tenant_id, model_id)
        
        payload = {
            "task_type": "delete",
            "container_name": container_name
        }
        
        try:
            logger.info("Sending delete payload to Argo Events at %s: %s", webhook_url, payload)
            response = requests.post(webhook_url, json=payload, timeout=10)
            response.raise_for_status()
            logger.info("Successfully triggered Argo Delete Workflow for container %s", container_name)
        except Exception as e:
            logger.error("Failed to trigger Argo Delete Workflow for container %s: %s", container_name, e)

    def wait_for_removal(self, model_id: int, timeout_seconds: int = 45, interval_seconds: int = 3) -> bool:
        model_api = ModelAPI.objects.filter(id=model_id).first()
        if not model_api:
            return True
            
        tenant_id = model_api.tenant.tenant_id
        container_name = model_api.endpoint_container_name or endpoint_container_name(tenant_id, model_id)
        url = f"http://{container_name}-svc:5000/health"
        
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            try:
                # If we get a response, the service is still up
                requests.get(url, timeout=2)
            except Exception:
                # Connection refused / DNS failure means the service is gone!
                return True
            time.sleep(interval_seconds)
            
        logger.warning("Timeout waiting for container %s to be removed.", container_name)
        return False

    def endpoint_logs(self, model_id: int, tail: int = 300) -> str:
        return "Log retrieval not yet implemented for Argo/Kubernetes endpoints."

    def cleanup_model(self, model_id: int, remove_images: bool = False) -> dict:
        results = {"containers": [], "images": []}
        if not remove_images:
            return results
            
        model_api = ModelAPI.objects.filter(id=model_id).first()
        if not model_api:
            return results
            
        tenant_id = model_api.tenant.tenant_id
        hashid_str = encode_model_id(model_id)
        repo_name = f"{tenant_id.lower()}-model-{hashid_str.lower()}"
        
        harbor_url = os.environ.get("HARBOR_REGISTRY_URL", "registry.mlops-nids-nt114.id.vn").strip().rstrip("/")
        harbor_username = os.environ.get("HARBOR_USERNAME")
        harbor_password = os.environ.get("HARBOR_PASSWORD")
        harbor_project = getattr(settings, "HARBOR_USER_PROJECT", "user-images")
        
        if harbor_username and harbor_password:
            api_url = f"https://{harbor_url}/api/v2.0/projects/{harbor_project}/repositories/{repo_name}"
            try:
                logger.info("Deleting image from Harbor: %s", api_url)
                response = requests.delete(api_url, auth=(harbor_username, harbor_password), timeout=10)
                if response.status_code in [200, 202, 204]:
                    logger.info("Successfully deleted Harbor repository %s", repo_name)
                    results["images"].append(repo_name)
                elif response.status_code == 404:
                    logger.info("Harbor repository %s not found, already deleted.", repo_name)
                else:
                    logger.error("Failed to delete Harbor repository %s. Status: %s, Response: %s", repo_name, response.status_code, response.text)
            except Exception as e:
                logger.error("Error calling Harbor API to delete repository %s: %s", repo_name, e)
                
        return results

def get_deploy_adapter() -> DeployAdapter:
    strategy = os.environ.get("BUILD_STRATEGY", "docker").lower()
    if strategy == "argo":
        return ArgoDeployAdapter()
    return DockerDeployAdapter()
