import logging
import os
import threading

import docker
import requests
from django.conf import settings

logger = logging.getLogger(__name__)

class BuildAdapter:
    def trigger_build(self, model_id: str, flavor: str, requirements_text: str, source_key: str, output_key: str):
        raise NotImplementedError()

    def cancel_build(self, model_id: str):
        raise NotImplementedError()

class DockerBuildAdapter(BuildAdapter):
    def trigger_build(self, model_id: str, flavor: str, requirements_text: str, source_key: str, output_key: str):
        def _run_container():
            try:
                client = docker.from_env()
                # Use the same image as the packager
                # Assuming the image is named mlops-nids-system-model_packager locally
                # We will find the image name based on running containers or hardcode.
                # Actually docker-compose builds it as mlops-nids-system-model_packager
                image_name = "mlops-nids-system-model_packager" 
                
                # Check if image exists
                try:
                    client.images.get(image_name)
                except docker.errors.ImageNotFound:
                    # try alternative names like mlops-nids-system_model_packager
                    image_name = "mlops-nids-system_model_packager"
                
                webhook_url = f"http://control-plane:8000/api/auth/models/{model_id}/build-webhook"
                
                environment = {
                    "MODEL_ID": str(model_id),
                    "FLAVOR": flavor,
                    "REQUIREMENTS_TEXT": requirements_text,
                    "SOURCE_KEY": source_key,
                    "OUTPUT_KEY": output_key,
                    "REDIS_URL": "redis://redis:6379/1",
                    "AWS_ACCESS_KEY_ID": os.environ.get("AWS_ACCESS_KEY_ID", ""),
                    "AWS_SECRET_ACCESS_KEY": os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
                    "AWS_BUCKET_NAME": getattr(settings, "AWS_STORAGE_BUCKET_NAME", ""),
                    "AWS_DEFAULT_REGION": getattr(settings, "AWS_S3_REGION_NAME", "ap-southeast-1"),
                    "CONTROL_PLANE_WEBHOOK_URL": webhook_url,
                }
                
                logger.info(f"Starting Docker container for build {model_id} using image {image_name}")
                client.containers.run(
                    image=image_name,
                    name=f"mlops_build_{model_id}",
                    command=["python", "src/cli.py"],
                    environment=environment,
                    network="mlops-nids-system_mlops_paas_network",
                    remove=True,
                    detach=True
                )
            except Exception as e:
                logger.error(f"Error starting Docker build for {model_id}: {e}")
                # Update DB via webhook to mark error since container failed to start
                webhook_url = f"http://control-plane:8000/api/auth/models/{model_id}/build-webhook"
                try:
                    requests.post(webhook_url, json={"status": "error", "error_message": f"Failed to start container: {str(e)}"}, timeout=5)
                except:
                    pass

        # Chạy trong background thread để không block API
        t = threading.Thread(target=_run_container)
        t.start()

    def cancel_build(self, model_id: str):
        try:
            client = docker.from_env()
            container_name = f"mlops_build_{model_id}"
            try:
                container = client.containers.get(container_name)
                container.kill()
                logger.info(f"Killed container {container_name}")
            except docker.errors.NotFound:
                logger.info(f"Container {container_name} not found, already finished or deleted")
        except Exception as e:
            logger.error(f"Error cancelling build {model_id}: {e}")

class ArgoBuildAdapter(BuildAdapter):
    def trigger_build(self, model_id: str, flavor: str, requirements_text: str, source_key: str, output_key: str):
        argo_webhook_url = os.environ.get("ARGO_EVENTS_WEBHOOK_URL")
        if not argo_webhook_url:
            logger.error("ARGO_EVENTS_WEBHOOK_URL is not set.")
            return
        
        payload = {
            "model_id": str(model_id),
            "flavor": flavor,
            "requirements_text": requirements_text,
            "source_key": source_key,
            "output_key": output_key,
            "control_plane_webhook_url": f"http://control-plane.mlops-paas.svc.cluster.local:8000/api/auth/models/{model_id}/build-webhook"
        }
        
        def _send_webhook():
            try:
                requests.post(argo_webhook_url, json=payload, timeout=10)
            except Exception as e:
                logger.error(f"Error sending webhook to Argo Events: {e}")
                
        t = threading.Thread(target=_send_webhook)
        t.start()

    def cancel_build(self, model_id: str):
        # TODO: Implement Argo workflow cancellation via webhook or k8s api
        logger.info(f"Cancel build requested for Argo model {model_id}")

def get_build_adapter() -> BuildAdapter:
    strategy = os.environ.get("BUILD_STRATEGY", "docker").lower()
    if strategy == "argo":
        return ArgoBuildAdapter()
    return DockerBuildAdapter()
