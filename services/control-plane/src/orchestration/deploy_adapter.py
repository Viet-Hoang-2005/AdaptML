import logging
import os
import threading
import time
import docker
import requests

from django.conf import settings
from django.utils import timezone
from authentication.models import ModelAPI
from urllib.parse import quote_plus
from .hashid_utils import encode_model_id

logger = logging.getLogger(__name__)

def endpoint_container_name(tenant_id: str, model_id: int) -> str:
    return f"endpoint_{tenant_id.lower()}_model_{encode_model_id(model_id).lower()}"

def endpoint_image_name(tenant_id: str, model_id: int) -> str:
    return f"{tenant_id.lower()}-model-{encode_model_id(model_id).lower()}:latest"

class DeployAdapter:
    def deploy_model(self, model_id: int, tenant_id: str, model_name: str, version: str):
        raise NotImplementedError()

    def remove_model(self, model_id: int):
        raise NotImplementedError()

class DockerDeployAdapter(DeployAdapter):
    def deploy_model(self, model_id: int, tenant_id: str, model_name: str, version: str):
        def _run_container():
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
                    logger.info(f"Found custom Docker image {image_name} for model {model_id}. Using it.")
                except docker.errors.ImageNotFound:
                    image_name = "mlops-paas-model-server"
                    logger.info(f"Custom image not found. Falling back to {image_name} for model {model_id}.")

                container_name = endpoint_container_name(tenant_id, model_id)

                try:
                    old_container = client.containers.get(container_name)
                    old_container.remove(force=True)
                    logger.info("Removed previous endpoint container %s before redeploy.", container_name)
                except docker.errors.NotFound:
                    pass

                # Traefik labels — tenant_id must be the tenant code (e.g. T-24B1E790), NOT the DB PK integer.
                hashid_str = encode_model_id(model_id)
                public_path = f"/{tenant_id}/models/{hashid_str}/{version}/predict"
                internal_path = f"/models/{encode_model_id(model_id)}/predict"
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
                db_host = os.environ.get("DB_HOST", "postgres")
                db_port = os.environ.get("DB_PORT", "5432")

                # URL-encode password so special chars (e.g. @, %, #) don't break the connection URL.
                db_password_encoded = quote_plus(db_password)

                # Prefer an explicitly set (already-encoded) URL from env, otherwise build a safe one.
                control_plane_db_url = os.environ.get("CONTROL_PLANE_DATABASE_URL") or (
                    f"postgresql://{db_user}:{db_password_encoded}@{db_host}:{db_port}/{db_name}"
                )

                # FastAPI container env vars
                environment = {
                    "PYTHONUNBUFFERED": "1",
                    "DB_USER": db_user,
                    "DB_PASSWORD": db_password,
                    "DB_NAME": db_name,
                    "DB_HOST_RW": db_host,
                    "DB_HOST_RO": db_host,
                    "DB_PORT": db_port,
                    "REDPANDA_BROKERS": "redpanda:9092",
                    "KAFKA_TOPIC": os.environ.get("KAFKA_TOPIC", "mlops_paas_production_logs"),
                    "JWKS_URL": "http://control-plane:8000/api/auth/.well-known/jwks.json",
                    "CONTROL_PLANE_DATABASE_URL": control_plane_db_url,
                    "CONTROL_PLANE_DB_SCHEMA": os.environ.get("DB_SCHEMA", "control_plane"),
                    "REDIS_URL": "redis://redis:6379/1",
                    "AWS_ACCESS_KEY_ID": os.environ.get("AWS_ACCESS_KEY_ID", ""),
                    "AWS_SECRET_ACCESS_KEY": os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
                    "AWS_DEFAULT_REGION": os.environ.get("AWS_DEFAULT_REGION", "ap-southeast-1"),
                    "AWS_BUCKET_NAME": os.environ.get("AWS_BUCKET_NAME", ""),
                }

                logger.info(
                    "Deploying endpoint container=%s model=%s | "
                    "public_path=%s -> internal=%s | network=%s image=%s",
                    container_name, model_id,
                    public_path, internal_path,
                    network_name, image_name,
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
                    detach=True,
                    restart_policy={"Name": "always"}
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
                    model_api.endpoint_error = payload_or_error
                    logger.warning("Endpoint model=%s failed health check: %s", model_id, payload_or_error)
                model_api.save(update_fields=[
                    "status",
                    "endpoint_status",
                    "endpoint_error",
                    "endpoint_last_checked_at",
                    "updated_at",
                ])
            except Exception as e:
                logger.error(f"Error starting endpoint container for {model_id}: {e}")
                ModelAPI.objects.filter(id=model_id).update(
                    status="deploy_failed",
                    endpoint_status="deploy_failed",
                    endpoint_error=str(e),
                    endpoint_last_checked_at=timezone.now(),
                )

        t = threading.Thread(target=_run_container)
        t.start()

    def wait_for_health(self, model_id: int, timeout_seconds: int = 45, interval_seconds: int = 3) -> tuple[bool, str]:
        model_api = ModelAPI.objects.filter(id=model_id).first()
        tenant_id = model_api.tenant.tenant_id if model_api else "unknown"
        container_name = model_api.endpoint_container_name or endpoint_container_name(tenant_id, model_id)
        url = f"http://{container_name}:5000/models/{encode_model_id(model_id)}/health"
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
        url = f"http://{container_name}:5000/models/{encode_model_id(model_id)}/health"
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                data = response.json()
                return data.get("model_loaded") is True, data
            return False, f"HTTP {response.status_code}: {response.text[:500]}"
        except Exception as exc:
            return False, str(exc)

    def remove_model(self, model_id: int):
        from authentication.models import ModelAPI
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
