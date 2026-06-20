import logging
import os
import threading
import docker

logger = logging.getLogger(__name__)

class DeployAdapter:
    def deploy_model(self, model_id: int, tenant_id: str, model_name: str, version: str):
        raise NotImplementedError()

    def remove_model(self, model_id: int):
        raise NotImplementedError()

class DockerDeployAdapter(DeployAdapter):
    def deploy_model(self, model_id: int, tenant_id: str, model_name: str, version: str):
        def _run_container():
            try:
                client = docker.from_env()
                custom_image_name = f"mlops-paas-model-{model_id}:latest"
                try:
                    client.images.get(custom_image_name)
                    image_name = custom_image_name
                    logger.info(f"Found custom Docker image {image_name} for model {model_id}. Using it.")
                except docker.errors.ImageNotFound:
                    image_name = "mlops-paas-model-server"
                    logger.info(f"Custom image not found. Falling back to {image_name} for model {model_id}.")

                container_name = f"model_endpoint_{model_id}"

                try:
                    old_container = client.containers.get(container_name)
                    old_container.remove(force=True)
                except docker.errors.NotFound:
                    pass

                # Normalize model_name for URL (no spaces)
                safe_model_name = model_name.replace(' ', '')

                # Traefik labels
                labels = {
                    "traefik.enable": "true",
                    f"traefik.http.routers.model_{model_id}.rule": f"PathPrefix(`/{tenant_id}/models/{safe_model_name}/{version}/predict`)",
                    f"traefik.http.middlewares.rewrite_{model_id}.replacepath.path": f"/models/{model_id}/predict",
                    f"traefik.http.routers.model_{model_id}.middlewares": f"rewrite_{model_id}",
                    f"traefik.http.services.model_{model_id}.loadbalancer.server.port": "5000",
                }

                network_name = "mlops-nids-system_mlops_paas_network"

                db_user = os.environ.get("DB_USER", "postgres")
                db_password = os.environ.get("DB_PASSWORD", "postgres")
                db_name = os.environ.get("DB_NAME", "mlops_paas")

                # FastAPI container env vars
                environment = {
                    "PYTHONUNBUFFERED": "1",
                    "DB_USER": db_user,
                    "DB_PASSWORD": db_password,
                    "DB_NAME": db_name,
                    "REDPANDA_BROKERS": "redpanda:9092",
                    "KAFKA_TOPIC": os.environ.get("KAFKA_TOPIC", "mlops_paas_production_logs"),
                    "JWKS_URL": "http://control-plane:8000/api/auth/.well-known/jwks.json",
                    "CONTROL_PLANE_DATABASE_URL": os.environ.get("CONTROL_PLANE_DATABASE_URL", f"postgresql://{db_user}:{db_password}@postgres:5432/{db_name}"),
                    "CONTROL_PLANE_DB_SCHEMA": os.environ.get("DB_SCHEMA", "control_plane"),
                    "REDIS_URL": "redis://redis:6379/1",
                }

                logger.info(f"Starting Model Endpoint Container {container_name} for model {model_id}")
                client.containers.run(
                    image=image_name,
                    name=container_name,
                    environment=environment,
                    labels=labels,
                    network=network_name,
                    detach=True,
                    restart_policy={"Name": "always"},
                    command="uvicorn src.index:app --host 0.0.0.0 --port 5000"
                )
            except Exception as e:
                logger.error(f"Error starting endpoint container for {model_id}: {e}")

        t = threading.Thread(target=_run_container)
        t.start()

    def remove_model(self, model_id: int):
        try:
            client = docker.from_env()
            container_name = f"model_endpoint_{model_id}"
            try:
                container = client.containers.get(container_name)
                container.remove(force=True)
                logger.info(f"Removed container {container_name}")
            except docker.errors.NotFound:
                pass
        except Exception as e:
            logger.error(f"Error removing container for {model_id}: {e}")
