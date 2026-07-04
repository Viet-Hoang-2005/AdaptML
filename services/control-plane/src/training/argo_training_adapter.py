import base64
import logging
import os
import threading
import requests
from django.conf import settings
from django.core.cache import cache
from integrations.hashid_utils import encode_model_id
from training.s3_storage_service import (
    upload_training_inputs_to_s3,
    generate_presigned_download_url,
    generate_presigned_upload_url,
)

logger = logging.getLogger("paas.training.argo")

def training_webhook_url(training_job_id: int) -> str:
    internal_base_url = getattr(settings, "CONTROL_PLANE_INTERNAL_URL", "http://control-plane:8000").rstrip("/")
    return f"{internal_base_url}/api/training/{training_job_id}/training-webhook"


def _safe_model_version(value: str) -> str:
    return (str(value or "v1").strip() or "v1").replace(" ", "")


def _mlflow_tracking_layout(training_job, bucket_name: str, s3_prefix: str) -> tuple[str, str]:
    if getattr(training_job, "model_api", None):
        tenant_id = training_job.tenant.tenant_id
        model_hash_id = encode_model_id(training_job.model_api.id)
        safe_version = _safe_model_version(training_job.model_version or training_job.model_api.version)
        artifact_root = f"s3://{bucket_name}/users/{tenant_id}/models/{model_hash_id}/{safe_version}/mlflow"
        experiment_name = f"tenant-{tenant_id}-model-{model_hash_id}-{safe_version}"
        return experiment_name, artifact_root

    artifact_root = f"s3://{bucket_name}/{s3_prefix}/mlflow"
    experiment_name = f"tenant-{training_job.tenant.tenant_id}"
    return experiment_name, artifact_root


class ArgoTrainingAdapter:
    def start_training_job(self, training_job) -> None:
        logger.info(f"Preparing input bundle for job {training_job.id}")
        _, _, s3_prefix = upload_training_inputs_to_s3(training_job)
        job_name = f"tjob-t-{training_job.tenant.tenant_id.lower()}-{training_job.id}"
        bucket_name = getattr(settings, "AWS_STORAGE_BUCKET_NAME", "")
        output_prefix = f"{s3_prefix}/output"
        model_artifact_uri = f"s3://{bucket_name}/{output_prefix}/model.tar.gz"
        job_bundle_uri = f"s3://{bucket_name}/{s3_prefix}/source/source.zip"
        training_job.external_job_id = job_name
        training_job.status = "pending"
        training_job.model_artifact_uri = model_artifact_uri
        training_job.output_s3_uri = f"s3://{bucket_name}/{output_prefix}/"
        training_job.save(update_fields=["external_job_id", "status", "model_artifact_uri", "output_s3_uri"])

        # Clear previous logs in Redis
        try:
            client = cache.client.get_client()
            client.delete(f"training_logs:{training_job.id}")
        except Exception as exc:
            logger.warning(f"Could not clear old training logs in Redis: {exc}")

        raw_req = training_job.model_api.requirements_text if getattr(training_job, "model_api", None) else ""
        requirements_text = base64.b64encode(raw_req.encode("utf-8")).decode("utf-8") if raw_req else ""

        source_presigned = generate_presigned_download_url(str(training_job.s3_source_uri), expiry_seconds=14400)
        data_presigned = generate_presigned_download_url(str(training_job.s3_training_data_uri), expiry_seconds=14400)
        output_presigned = generate_presigned_upload_url(model_artifact_uri, expiry_seconds=14400)
        bundle_presigned = generate_presigned_upload_url(job_bundle_uri, expiry_seconds=14400)
        mlflow_experiment_name, mlflow_artifact_root = _mlflow_tracking_layout(training_job, bucket_name, s3_prefix)

        webhook_url = os.environ.get(
            "ARGO_TRAINING_WEBHOOK_URL",
            "http://webhook-eventsource-eventsource-svc.default.svc.cluster.local:12000/train"
        )
        payload = {
            "job_id": str(training_job.id),
            "tenant_id": str(training_job.tenant.tenant_id),
            "job_name": job_name,
            "namespace": os.environ.get("TRAINING_NAMESPACE", "user-jobs"),
            "vcpu": str(training_job.vcpu),
            "memory": str(training_job.memory),
            "accelerator_type": str(training_job.accelerator_type),
            "accelerator_count": str(training_job.accelerator_count),
            "s3_source_uri": source_presigned,
            "s3_training_data_uri": data_presigned,
            "s3_output_uri": output_presigned,
            "s3_job_source_bundle_uri": bundle_presigned,
            "requirements_text": requirements_text,
            "entry_point": str(training_job.entry_point),
            "model_version": str(training_job.model_version),
            "control_plane_webhook_url": training_webhook_url(training_job.id),
            "mlflow_tracking_uri": os.environ.get("MLFLOW_TRACKING_URI", "http://mlflow-server.mlflow-server.svc.cluster.local:5000"),
            "mlflow_experiment_name": mlflow_experiment_name,
            "mlflow_artifact_root": mlflow_artifact_root,
        }

        def _send_webhook():
            try:
                logger.info(f"Sending train payload to Argo Events at {webhook_url}: {payload}")
                response = requests.post(webhook_url, json=payload, timeout=10)
                if response.status_code >= 400:
                    logger.error(f"Argo Events returned status {response.status_code}: {response.text}")
                    training_job.status = "failed"
                    training_job.error_message = f"Argo Events submission failed ({response.status_code})"
                    training_job.save(update_fields=["status", "error_message"])
            except Exception as exc:
                logger.error(f"Error sending train webhook to Argo Events: {exc}")
                training_job.status = "failed"
                training_job.error_message = f"Argo Events submission error: {exc}"
                training_job.save(update_fields=["status", "error_message"])

        threading.Thread(target=_send_webhook, daemon=True).start()

    def cancel_training_job(self, training_job) -> None:
        job_name = training_job.external_job_id or f"tjob-{training_job.tenant.tenant_id.lower()}-{training_job.id}"
        webhook_url = os.environ.get(
            "ARGO_CANCEL_TRAINING_WEBHOOK_URL",
            "http://webhook-eventsource-eventsource-svc.default.svc.cluster.local:12000/cancel-train"
        )
        payload = {
            "job_name": job_name,
            "namespace": os.environ.get("TRAINING_NAMESPACE", "user-jobs"),
        }

        def _send_cancel_webhook():
            try:
                logger.info(f"Sending cancel-train payload to Argo Events at {webhook_url}: {payload}")
                requests.post(webhook_url, json=payload, timeout=10)
            except Exception as exc:
                logger.error(f"Error sending cancel-train webhook to Argo Events: {exc}")

        threading.Thread(target=_send_cancel_webhook, daemon=True).start()
        training_job.status = "cancelled"
        training_job.save(update_fields=["status"])
