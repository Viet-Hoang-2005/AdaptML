import json
import re
from datetime import datetime, timezone as datetime_timezone

import boto3
from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from authentication.models import TrainingJob
from .mlflow_utils import parse_mlflow_metadata_from_logs
from .sagemaker_service import (
    _copy_django_file_to_s3,
    _s3_uri,
    get_training_job_prefix,
    upload_training_inputs_to_s3,
)

METRIC_LOG_PREFIX = "METRIC_JSON "


def _batch_client():
    return boto3.client("batch", region_name=settings.AWS_BATCH_REGION)


def _logs_client():
    return boto3.client("logs", region_name=settings.AWS_BATCH_REGION)


def _validate_batch_config(training_job: TrainingJob | None = None) -> None:
    if training_job and training_job.accelerator_type == "gpu":
        missing = []
        if not settings.AWS_BATCH_GPU_JOB_QUEUE:
            missing.append("AWS_BATCH_GPU_JOB_QUEUE")
        if not settings.AWS_BATCH_GPU_JOB_DEFINITION:
            missing.append("AWS_BATCH_GPU_JOB_DEFINITION")
        if missing:
            raise ValidationError({"error": "Missing AWS Batch GPU configuration: " + ", ".join(missing) + "."})
        return

    missing = []
    if not settings.AWS_BATCH_JOB_QUEUE:
        missing.append("AWS_BATCH_JOB_QUEUE")
    if not settings.AWS_BATCH_JOB_DEFINITION:
        missing.append("AWS_BATCH_JOB_DEFINITION")
    if missing:
        raise ValidationError(
            {
                "error": (
                    "Missing AWS Batch configuration: "
                    + ", ".join(missing)
                    + ". Set these values in .env after applying Terraform."
                )
            }
        )


def _batch_submit_config(training_job: TrainingJob) -> tuple[str, str]:
    if training_job.accelerator_type == "gpu":
        if not settings.ENABLE_GPU_TRAINING:
            raise ValidationError(
                {
                    "error": (
                        "GPU training is not enabled. Configure AWS Batch EC2 GPU queue/job definition first."
                    )
                }
            )
        missing = []
        if not settings.AWS_BATCH_GPU_JOB_QUEUE:
            missing.append("AWS_BATCH_GPU_JOB_QUEUE")
        if not settings.AWS_BATCH_GPU_JOB_DEFINITION:
            missing.append("AWS_BATCH_GPU_JOB_DEFINITION")
        if missing:
            raise ValidationError({"error": "Missing AWS Batch GPU configuration: " + ", ".join(missing) + "."})
        return settings.AWS_BATCH_GPU_JOB_QUEUE, settings.AWS_BATCH_GPU_JOB_DEFINITION
    return settings.AWS_BATCH_JOB_QUEUE, settings.AWS_BATCH_JOB_DEFINITION


def _safe_batch_job_name(training_job: TrainingJob) -> str:
    raw_name = f"mlops-paas-{training_job.tenant.tenant_id}-{training_job.id}-{training_job.name}"
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "-", raw_name).strip("-")
    return safe_name[:128] or f"mlops-paas-training-{training_job.id}"


def _aws_millis_to_datetime(value):
    if not value:
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=datetime_timezone.utc)
    except (TypeError, ValueError):
        return None


def _upload_requirements_to_s3(training_job: TrainingJob, prefix: str) -> str:
    if not training_job.requirements_file:
        return ""

    bucket_name = settings.AWS_STORAGE_BUCKET_NAME
    requirements_key = f"{prefix}/source/requirements.txt"
    return _copy_django_file_to_s3(training_job.requirements_file, bucket_name, requirements_key)


def start_aws_batch_training_job(training_job: TrainingJob) -> tuple[str, str]:
    _validate_batch_config(training_job)

    source_uri, data_uri, prefix = upload_training_inputs_to_s3(training_job)
    requirements_uri = _upload_requirements_to_s3(training_job, prefix)
    output_s3_uri = _s3_uri(settings.AWS_STORAGE_BUCKET_NAME, f"{prefix}/output/batch/")
    model_artifact_uri = _s3_uri(settings.AWS_STORAGE_BUCKET_NAME, f"{prefix}/output/batch/model.tar.gz")

    environment = [
        {"name": "AWS_BUCKET_NAME", "value": settings.AWS_STORAGE_BUCKET_NAME},
        {"name": "S3_SOURCE_URI", "value": source_uri},
        {"name": "S3_TRAINING_DATA_URI", "value": data_uri},
        {"name": "S3_OUTPUT_URI", "value": model_artifact_uri},
        {"name": "ENTRY_POINT", "value": training_job.entry_point},
        {"name": "MODEL_VERSION", "value": training_job.model_version},
        {"name": "TRAINING_JOB_ID", "value": str(training_job.id)},
    ]
    if requirements_uri:
        environment.append({"name": "S3_REQUIREMENTS_URI", "value": requirements_uri})

    # Phase 10E.1: Inject MLflow env into AWS Batch ONLY if AWS_BATCH_MLFLOW_TRACKING_URI
    # is configured. Do NOT inject local http://mlflow:5000 — Batch cannot resolve it.
    _batch_mlflow_uri = getattr(settings, "AWS_BATCH_MLFLOW_TRACKING_URI", "").strip()
    _batch_mlflow_exp = getattr(settings, "MLFLOW_EXPERIMENT_NAME", "").strip()
    if _batch_mlflow_uri:
        environment.append({"name": "MLFLOW_TRACKING_URI", "value": _batch_mlflow_uri})
        if _batch_mlflow_exp:
            environment.append({"name": "MLFLOW_EXPERIMENT_NAME", "value": _batch_mlflow_exp})

    job_queue, job_definition = _batch_submit_config(training_job)
    resource_requirements = [
        {"type": "VCPU", "value": str(training_job.vcpu)},
        {"type": "MEMORY", "value": str(training_job.memory)},
    ]
    if training_job.accelerator_type == "gpu":
        resource_requirements.append({"type": "GPU", "value": str(training_job.accelerator_count)})

    response = _batch_client().submit_job(
        jobName=_safe_batch_job_name(training_job),
        jobQueue=job_queue,
        jobDefinition=job_definition,
        containerOverrides={
            "environment": environment,
            "resourceRequirements": resource_requirements,
        },
        timeout={"attemptDurationSeconds": training_job.max_runtime_seconds},
    )

    external_job_id = response["jobId"]
    training_job.training_backend = "aws_batch"
    training_job.external_job_id = external_job_id
    training_job.sagemaker_job_name = ""
    training_job.output_s3_uri = output_s3_uri
    training_job.model_artifact_uri = model_artifact_uri
    training_job.status = "running"
    training_job.error_message = ""
    training_job.stop_reason = ""
    training_job.mark_started(save=False)
    training_job.save(
        update_fields=[
            "training_backend",
            "external_job_id",
            "sagemaker_job_name",
            "output_s3_uri",
            "model_artifact_uri",
            "status",
            "error_message",
            "stop_reason",
            "started_at",
            "updated_at",
        ]
    )
    return external_job_id, output_s3_uri


def cancel_aws_batch_training_job(training_job: TrainingJob, reason: str = "User cancelled training job") -> None:
    if not training_job.external_job_id:
        return
    try:
        _batch_client().terminate_job(jobId=training_job.external_job_id, reason=reason)
    except Exception as exc:
        message = str(exc).lower()
        if "not found" in message or "not in a cancellable state" in message or "status" in message:
            return
        raise


def _batch_diagnostics(job: dict) -> dict:
    container = job.get("container") or {}
    status_reason = job.get("statusReason", "") or ""
    container_reason = container.get("reason", "") or ""
    exit_code = container.get("exitCode")
    log_stream_name = container.get("logStreamName", "") or ""
    combined = " ".join([status_reason, container_reason]).lower()

    if "cannotpullcontainererror" in combined or "pull" in combined and "image" in combined:
        concise_reason = "Image pull failed. Check the training runner image URI, ECR push, and Batch task execution role."
    elif "timeout" in combined or "timed out" in combined:
        concise_reason = "Training job reached its configured timeout."
    elif exit_code not in {None, 0}:
        concise_reason = f"Training script failed: container exited with code {exit_code}."
    elif container_reason:
        concise_reason = container_reason
    elif status_reason:
        concise_reason = status_reason
    else:
        concise_reason = "AWS Batch job failed. Check the training logs for details."

    return {
        "status_reason": status_reason,
        "container_reason": container_reason,
        "exit_code": exit_code,
        "log_stream_name": log_stream_name,
        "concise_reason": concise_reason,
    }


def _failure_message(job: dict) -> str:
    diagnostics = _batch_diagnostics(job)
    parts = [
        diagnostics["concise_reason"],
        diagnostics["status_reason"],
        diagnostics["container_reason"],
    ]
    if diagnostics["exit_code"] is not None:
        parts.append(f"exitCode={diagnostics['exit_code']}")
    if diagnostics["log_stream_name"]:
        parts.append(f"logStreamName={diagnostics['log_stream_name']}")
    seen = set()
    message = " | ".join(part for part in parts if part and not (part in seen or seen.add(part)))
    return message or "AWS Batch job failed."


def _describe_batch_job(training_job: TrainingJob) -> dict:
    response = _batch_client().describe_jobs(jobs=[training_job.external_job_id])
    jobs = response.get("jobs") or []
    if not jobs:
        raise ValidationError({"error": "AWS Batch job was not found."})
    return jobs[0]


def get_aws_batch_training_log_payload(training_job: TrainingJob, limit: int = 300) -> dict:
    payload = {
        "logs": training_job.training_logs or "",
        "log_stream_name": "",
        "next_token": "",
        "updated_at": timezone.now(),
    }

    if not training_job.external_job_id:
        payload["logs"] = training_job.training_logs or "AWS Batch job has not been submitted yet."
        return payload

    job = _describe_batch_job(training_job)
    container = job.get("container") or {}
    log_stream_name = container.get("logStreamName", "")
    payload["log_stream_name"] = log_stream_name
    if not log_stream_name:
        status_reason = job.get("statusReason", "")
        payload["logs"] = training_job.training_logs or status_reason or "CloudWatch log stream is not available yet."
        return payload

    try:
        response = _logs_client().get_log_events(
            logGroupName=settings.AWS_BATCH_LOG_GROUP,
            logStreamName=log_stream_name,
            startFromHead=True,
            limit=limit,
        )
    except Exception as exc:
        payload["logs"] = training_job.training_logs or f"Unable to read CloudWatch logs: {exc}"
        return payload

    events = response.get("events") or []
    logs = "\n".join(event.get("message", "") for event in events).strip()
    payload["logs"] = logs or "CloudWatch log stream is empty."
    payload["next_token"] = response.get("nextForwardToken", "") or ""
    return payload


def get_aws_batch_training_logs(training_job: TrainingJob, limit: int = 300) -> str:
    return get_aws_batch_training_log_payload(training_job, limit=limit)["logs"]


def parse_training_metrics_from_logs(logs: str, max_points: int = 120) -> list[dict]:
    metrics = []
    for line in (logs or "").splitlines():
        if METRIC_LOG_PREFIX not in line:
            continue
        _, raw_payload = line.split(METRIC_LOG_PREFIX, 1)
        try:
            payload = json.loads(raw_payload.strip())
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            metrics.append(payload)
    return metrics[-max_points:]


def strip_training_metric_lines(logs: str) -> str:
    return "\n".join(line for line in (logs or "").splitlines() if METRIC_LOG_PREFIX not in line).strip()


def get_training_metrics_payload(training_job: TrainingJob, limit: int = 1000) -> dict:
    logs = training_job.training_logs or ""
    log_stream_name = ""
    message = ""

    if training_job.training_backend == "aws_batch":
        log_payload = get_aws_batch_training_log_payload(training_job, limit=limit)
        logs = log_payload["logs"]
        log_stream_name = log_payload["log_stream_name"]
        if logs != training_job.training_logs:
            training_job.training_logs = logs
            training_job.save(update_fields=["training_logs", "updated_at"])
    elif not logs:
        message = "Runtime metrics are not available for this job yet."

    history = parse_training_metrics_from_logs(logs)
    latest = history[-1] if history else None
    if not history and not message:
        message = (
            "Runtime metrics are not available yet. They appear after the training runner starts "
            "and emits METRIC_JSON log lines."
        )

    return {
        "job_id": training_job.id,
        "training_job_id": training_job.id,
        "status": training_job.status,
        "metrics_available": bool(history),
        "latest": latest,
        "history": history,
        "log_stream_name": log_stream_name,
        "message": message,
        "updated_at": timezone.now(),
    }


def refresh_aws_batch_training_job(training_job: TrainingJob) -> TrainingJob:
    _validate_batch_config()
    if not training_job.external_job_id:
        raise ValidationError({"error": "Training job has not been submitted to AWS Batch yet."})

    job = _describe_batch_job(training_job)
    batch_status = job.get("status", "")
    started_at = _aws_millis_to_datetime(job.get("startedAt"))
    stopped_at = _aws_millis_to_datetime(job.get("stoppedAt"))
    if batch_status in {"SUBMITTED", "PENDING", "RUNNABLE", "STARTING", "RUNNING"}:
        training_job.status = "running"
        if started_at and not training_job.started_at:
            training_job.started_at = started_at
        training_job.mark_started(save=False)
    elif batch_status == "SUCCEEDED":
        training_job.status = "completed"
        training_job.error_message = ""
        training_job.stop_reason = ""
        training_job.training_logs = get_aws_batch_training_logs(training_job)
        if started_at and not training_job.started_at:
            training_job.started_at = started_at
        if stopped_at and not training_job.completed_at:
            training_job.completed_at = stopped_at
        training_job.mark_finished(save=False)
        # Phase 10E.1: Parse MLflow metadata from CloudWatch logs.
        _mlflow_meta = parse_mlflow_metadata_from_logs(training_job.training_logs)
        _mlflow_extra_fields = []
        for _field, _value in _mlflow_meta.items():
            if _value and not getattr(training_job, _field, None):
                setattr(training_job, _field, _value)
                _mlflow_extra_fields.append(_field)
    elif batch_status == "FAILED":
        failure_message = _failure_message(job)
        if "user cancelled" in failure_message.lower() or "terminated" in failure_message.lower():
            training_job.status = "cancelled"
            training_job.error_message = ""
            training_job.stop_reason = "User cancelled training job"
        else:
            training_job.status = "failed"
            training_job.error_message = failure_message
            training_job.stop_reason = training_job.error_message
        training_job.training_logs = get_aws_batch_training_logs(training_job)
        if started_at and not training_job.started_at:
            training_job.started_at = started_at
        if stopped_at and not training_job.completed_at:
            training_job.completed_at = stopped_at
        training_job.mark_finished(training_job.stop_reason, save=False)
    else:
        training_job.status = "running"
        training_job.error_message = job.get("statusReason", "")
        if started_at and not training_job.started_at:
            training_job.started_at = started_at
        training_job.mark_started(save=False)

    training_job.save(
        update_fields=[
            "status",
            "error_message",
            "training_logs",
            "started_at",
            "completed_at",
            "runtime_seconds",
            "stop_reason",
            "updated_at",
        ] + (locals().get("_mlflow_extra_fields") or [])
    )
    return training_job
