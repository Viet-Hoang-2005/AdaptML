import logging
import os
import threading

import docker
import requests
from django.conf import settings

from authentication.models import ModelAPI

logger = logging.getLogger(__name__)


def build_webhook_url(model_id: str) -> str:
    internal_base_url = getattr(settings, "CONTROL_PLANE_INTERNAL_URL", "http://control-plane:8000").rstrip("/")
    return f"{internal_base_url}/api/models/{model_id}/build-webhook"


def mark_build_start_failed(model_id: str, message: str) -> None:
    updated = ModelAPI.objects.filter(id=model_id).update(
        status="error",
        build_status="error",
        error_message="Unable to start build process.",
        build_error=message,
    )
    if updated:
        logger.info("Marked model %s build as error after build container start failure.", model_id)


class BuildAdapter:
    def trigger_build(
        self,
        model_id: str,
        flavor: str,
        requirements_text: str,
        source_key: str,
        output_key: str,
        label_mapping_key: str = None,
        training_artifact_uri: str = "",
        task_type: str = "BUILD",
    ):
        raise NotImplementedError()

    def cancel_build(self, model_id: str):
        raise NotImplementedError()


class DockerBuildAdapter(BuildAdapter):
    def trigger_build(
        self,
        model_id: str,
        flavor: str,
        requirements_text: str,
        source_key: str,
        output_key: str,
        label_mapping_key: str = None,
        training_artifact_uri: str = "",
        task_type: str = "BUILD",
    ):
        def _run_container():
            try:
                client = docker.from_env()
                image_name = "mlops-paas-model-packager"
                try:
                    client.images.get(image_name)
                except docker.errors.ImageNotFound:
                    logger.error("Image %s not found.", image_name)

                webhook_url = build_webhook_url(model_id)
                environment = {
                    "TASK_TYPE": task_type,
                    "MODEL_ID": str(model_id),
                    "FLAVOR": flavor,
                    "REQUIREMENTS_TEXT": requirements_text,
                    "SOURCE_KEY": source_key,
                    "SOURCE_TYPE": "training_job" if training_artifact_uri else "manual_upload",
                    "TRAINING_ARTIFACT_URI": training_artifact_uri or "",
                    "OUTPUT_KEY": output_key,
                    "LABEL_MAPPING_KEY": label_mapping_key or "",
                    "REDIS_URL": "redis://redis:6379/1",
                    "AWS_ACCESS_KEY_ID": os.environ.get("AWS_ACCESS_KEY_ID", ""),
                    "AWS_SECRET_ACCESS_KEY": os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
                    "AWS_BUCKET_NAME": getattr(settings, "AWS_STORAGE_BUCKET_NAME", ""),
                    "AWS_DEFAULT_REGION": getattr(settings, "AWS_S3_REGION_NAME", "ap-southeast-1"),
                    "CONTROL_PLANE_WEBHOOK_URL": webhook_url,
                    "MODEL_BUILD_WEBHOOK_SECRET": getattr(settings, "MODEL_BUILD_WEBHOOK_SECRET", ""),
                }

                network_name = getattr(settings, "DOCKER_NETWORK_NAME", "mlops_paas_network")
                logger.info(
                    "Starting Docker build container for model=%s task=%s network=%s image=%s",
                    model_id,
                    task_type,
                    network_name,
                    image_name,
                )
                logger.info("Build callback URL for model %s: %s", model_id, webhook_url)
                client.containers.run(
                    image=image_name,
                    name=f"mlops_paas_model_build_{model_id}",
                    command=["python", "src/cli.py"],
                    environment=environment,
                    network=network_name,
                    volumes={"/var/run/docker.sock": {"bind": "/var/run/docker.sock", "mode": "rw"}},
                    remove=True,
                    detach=True,
                )
            except Exception as exc:
                logger.error("Error starting Docker build for %s: %s", model_id, exc)
                mark_build_start_failed(str(model_id), f"Failed to start container: {exc}")

        threading.Thread(target=_run_container).start()

    def cancel_build(self, model_id: str):
        try:
            client = docker.from_env()
            container_name = f"mlops_paas_model_build_{model_id}"
            try:
                container = client.containers.get(container_name)
                container.kill()
                logger.info("Killed container %s", container_name)
            except docker.errors.NotFound:
                logger.info("Container %s not found, already finished or deleted", container_name)
        except Exception as exc:
            logger.error("Error cancelling build %s: %s", model_id, exc)


class ArgoBuildAdapter(BuildAdapter):
    def trigger_build(
        self,
        model_id: str,
        flavor: str,
        requirements_text: str,
        source_key: str,
        output_key: str,
        label_mapping_key: str = None,
        training_artifact_uri: str = "",
        task_type: str = "BUILD",
    ):
        argo_webhook_url = os.environ.get("ARGO_EVENTS_WEBHOOK_URL")
        if not argo_webhook_url:
            logger.error("ARGO_EVENTS_WEBHOOK_URL is not set.")
            return

        payload = {
            "model_id": str(model_id),
            "flavor": flavor,
            "requirements_text": requirements_text,
            "source_key": source_key,
            "source_type": "training_job" if training_artifact_uri else "manual_upload",
            "training_artifact_uri": training_artifact_uri,
            "output_key": output_key,
            "task_type": task_type,
            "control_plane_webhook_url": build_webhook_url(model_id),
        }

        def _send_webhook():
            try:
                requests.post(argo_webhook_url, json=payload, timeout=10)
            except Exception as exc:
                logger.error("Error sending webhook to Argo Events: %s", exc)

        threading.Thread(target=_send_webhook).start()

    def cancel_build(self, model_id: str):
        logger.info("Cancel build requested for Argo model %s", model_id)


def get_build_adapter() -> BuildAdapter:
    strategy = os.environ.get("BUILD_STRATEGY", "docker").lower()
    if strategy == "argo":
        return ArgoBuildAdapter()
    return DockerBuildAdapter()
