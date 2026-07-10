import logging
import os
import threading

import docker
import requests
from django.conf import settings

from authentication.models import ModelAPI
from integrations.hashid_utils import encode_model_id
from training.s3_storage_service import (
    generate_presigned_download_url,
    generate_presigned_upload_url,
)

logger = logging.getLogger(__name__)

BUILD_URL_EXPIRY_SECONDS = 7200


def _as_s3_uri(bucket_name: str, key_or_uri: str) -> str:
    value = (key_or_uri or "").strip()
    if not value:
        return ""
    if value.startswith("s3://"):
        return value
    if not bucket_name:
        raise ValueError("AWS_STORAGE_BUCKET_NAME is required to create build artifact URLs.")
    return f"s3://{bucket_name}/{value.lstrip('/')}"


def build_artifact_urls(
    source_key: str,
    output_key: str,
    label_mapping_key: str = None,
    training_artifact_uri: str = "",
) -> dict[str, str]:
    bucket_name = getattr(settings, "AWS_STORAGE_BUCKET_NAME", "")
    source_uri = training_artifact_uri or _as_s3_uri(bucket_name, source_key)
    output_uri = _as_s3_uri(bucket_name, output_key) if output_key else ""
    label_mapping_uri = _as_s3_uri(bucket_name, label_mapping_key) if label_mapping_key else ""

    return {
        "SOURCE_DOWNLOAD_URL": generate_presigned_download_url(source_uri, BUILD_URL_EXPIRY_SECONDS),
        "OUTPUT_UPLOAD_URL": generate_presigned_upload_url(output_uri, BUILD_URL_EXPIRY_SECONDS),
        "LABEL_MAPPING_DOWNLOAD_URL": generate_presigned_download_url(label_mapping_uri, BUILD_URL_EXPIRY_SECONDS),
    }

def build_webhook_url(model_id: str) -> str:
    internal_base_url = getattr(settings, "CONTROL_PLANE_INTERNAL_URL", "http://control-plane:8000").rstrip("/")
    return f"{internal_base_url}/api/models/{encode_model_id(int(model_id))}/build-webhook"


def mark_build_start_failed(model_id: str, message: str) -> None:
    updated = ModelAPI.objects.filter(id=model_id).update(
        status="error",
        build_status="error",
        error_message="Unable to start build process.",
        build_error=message,
    )
    if updated:
        logger.info("Marked model %s build as error after build container start failure.", model_id)

STANDARD_DYNAMIC_FLAVORS = {"sklearn", "scikit-learn", "xgboost", "pytorch", "keras", "tensorflow"}

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
        if not os.environ.get("ENABLE_PREBUILT_MODEL_IMAGE", "true").lower() == "true" and task_type == "BUILD" and (flavor or "").lower() in STANDARD_DYNAMIC_FLAVORS:
            logger.info("Skipping container build for standard flavor '%s' (Dynamic Runtime Injection enabled for model %s).", flavor, model_id)
            ModelAPI.objects.filter(id=model_id).update(
                status="ready",
                build_status="ready",
                error_message="",
                build_error="",
            )
            return

        def _run_container():
            try:
                model_api = ModelAPI.objects.filter(id=model_id).first()
                tenant_id = model_api.tenant.tenant_id if model_api else "unknown"

                client = docker.from_env()
                image_name = "mlops-paas-model-packager"
                try:
                    client.images.get(image_name)
                except docker.errors.ImageNotFound:
                    logger.error("Image %s not found.", image_name)

                webhook_url = build_webhook_url(model_id)
                hashid_str = encode_model_id(int(model_id))
                artifact_urls = build_artifact_urls(
                    source_key=source_key,
                    output_key=output_key,
                    label_mapping_key=label_mapping_key,
                    training_artifact_uri=training_artifact_uri,
                )
                environment = {
                    "TASK_TYPE": task_type,
                    "TENANT_ID": tenant_id,
                    "MODEL_ID": str(model_id),
                    "MODEL_HASHID": hashid_str,
                    "FLAVOR": flavor,
                    "REQUIREMENTS_TEXT": requirements_text,
                    "SOURCE_TYPE": "training_job" if training_artifact_uri else "manual_upload",
                    "SOURCE_ARTIFACT_NAME": os.path.basename(source_key) if source_key else "training-model.tar.gz",
                    "LABEL_MAPPING_FILENAME": os.path.basename(label_mapping_key) if label_mapping_key else "",
                    "REDIS_URL": "redis://redis:6379/1",
                    "HARBOR_REGISTRY_URL": getattr(settings, "HARBOR_REGISTRY_URL", ""),
                    "HARBOR_USER_PROJECT": getattr(settings, "HARBOR_USER_PROJECT", "user-images"),
                    "HARBOR_USERNAME": os.environ.get("HARBOR_USERNAME", ""),
                    "HARBOR_PASSWORD": os.environ.get("HARBOR_PASSWORD", ""),
                    "CONTROL_PLANE_WEBHOOK_URL": webhook_url,
                    "CONTROL_PLANE_WEBHOOK_SECRET": getattr(settings, "CONTROL_PLANE_WEBHOOK_SECRET", ""),
                }
                environment.update(artifact_urls)

                network_name = getattr(settings, "DOCKER_NETWORK_NAME", "mlops_paas_network")
                logger.info(
                    "Starting Docker build container for model=%s task=%s network=%s image=%s",
                    model_id,
                    task_type,
                    network_name,
                    image_name,
                )
                logger.info("Build callback URL for model %s: %s", model_id, webhook_url)
                container = client.containers.run(
                    image=image_name,
                    name=f"build_{tenant_id.lower()}_model_{hashid_str.lower()}",
                    command=["python", "src/cli.py"],
                    environment=environment,
                    network=network_name,
                    volumes={"/var/run/docker.sock": {"bind": "/var/run/docker.sock", "mode": "rw"}},
                    # Wait for the outcome so failed jobs remain inspectable.
                    remove=False,
                    detach=True,
                )
                result = container.wait()
                if result.get("StatusCode") != 0:
                    logger.error(
                        "Build container %s exited with status %s and was retained for debugging.",
                        container.name,
                        result.get("StatusCode"),
                    )
                    return

                try:
                    container.remove()
                except docker.errors.NotFound:
                    pass
                except Exception as cleanup_exc:
                    logger.warning("Could not remove successful build container %s: %s", container.name, cleanup_exc)
            except Exception as exc:
                logger.error("Error starting Docker build for %s: %s", model_id, exc)
                mark_build_start_failed(str(model_id), f"Failed to start container: {exc}")

        threading.Thread(target=_run_container).start()

    def cancel_build(self, model_id: str):
        try:
            model_api = ModelAPI.objects.filter(id=model_id).first()
            tenant_id = model_api.tenant.tenant_id if model_api else "unknown"

            client = docker.from_env()
            container_name = f"build_{tenant_id}_model_{model_id}"
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
        if not os.environ.get("ENABLE_PREBUILT_MODEL_IMAGE", "true").lower() == "true" and task_type == "BUILD" and (flavor or "").lower() in STANDARD_DYNAMIC_FLAVORS:
            logger.info("Skipping Argo build workflow for standard flavor '%s' (Dynamic Runtime Injection enabled for model %s).", flavor, model_id)
            ModelAPI.objects.filter(id=model_id).update(
                status="ready",
                build_status="ready",
                error_message="",
                build_error="",
            )
            return

        argo_webhook_url = os.environ.get("ARGO_EVENTS_WEBHOOK_URL")
        if not argo_webhook_url:
            logger.error("ARGO_EVENTS_WEBHOOK_URL is not set.")
            return

        model_api = ModelAPI.objects.filter(id=model_id).first()
        tenant_id = model_api.tenant.tenant_id if model_api else "unknown"
        artifact_urls = build_artifact_urls(
            source_key=source_key,
            output_key=output_key,
            label_mapping_key=label_mapping_key,
            training_artifact_uri=training_artifact_uri,
        )

        payload = {
            "model_id": str(model_id),
            "model_hashid": encode_model_id(int(model_id)),
            "tenant_id": tenant_id,
            "flavor": flavor,
            "requirements_text": requirements_text,
            "source_artifact_name": os.path.basename(source_key) if source_key else "training-model.tar.gz",
            "label_mapping_filename": os.path.basename(label_mapping_key) if label_mapping_key else "",
            "source_type": "training_job" if training_artifact_uri else "manual_upload",
            "task_type": task_type,
            "control_plane_webhook_url": build_webhook_url(model_id),
            **artifact_urls,
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
