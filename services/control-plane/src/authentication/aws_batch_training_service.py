import re

import boto3
from django.conf import settings
from rest_framework.exceptions import ValidationError

from .models import TrainingJob
from .sagemaker_service import (
    _copy_django_file_to_s3,
    _s3_uri,
    get_training_job_prefix,
    upload_training_inputs_to_s3,
)


def _batch_client():
    return boto3.client("batch", region_name=settings.AWS_BATCH_REGION)


def _logs_client():
    return boto3.client("logs", region_name=settings.AWS_BATCH_REGION)


def _validate_batch_config() -> None:
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


def _safe_batch_job_name(training_job: TrainingJob) -> str:
    raw_name = f"mlops-paas-{training_job.tenant.tenant_id}-{training_job.id}-{training_job.name}"
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "-", raw_name).strip("-")
    return safe_name[:128] or f"mlops-paas-training-{training_job.id}"


def _upload_requirements_to_s3(training_job: TrainingJob, prefix: str) -> str:
    if not training_job.requirements_file:
        return ""

    bucket_name = settings.AWS_STORAGE_BUCKET_NAME
    requirements_key = f"{prefix}/source/requirements.txt"
    return _copy_django_file_to_s3(training_job.requirements_file, bucket_name, requirements_key)


def start_aws_batch_training_job(training_job: TrainingJob) -> tuple[str, str]:
    _validate_batch_config()

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

    response = _batch_client().submit_job(
        jobName=_safe_batch_job_name(training_job),
        jobQueue=settings.AWS_BATCH_JOB_QUEUE,
        jobDefinition=settings.AWS_BATCH_JOB_DEFINITION,
        containerOverrides={
            "environment": environment,
        },
    )

    external_job_id = response["jobId"]
    training_job.training_backend = "aws_batch"
    training_job.external_job_id = external_job_id
    training_job.sagemaker_job_name = ""
    training_job.output_s3_uri = output_s3_uri
    training_job.model_artifact_uri = model_artifact_uri
    training_job.status = "running"
    training_job.error_message = ""
    training_job.save(
        update_fields=[
            "training_backend",
            "external_job_id",
            "sagemaker_job_name",
            "output_s3_uri",
            "model_artifact_uri",
            "status",
            "error_message",
            "updated_at",
        ]
    )
    return external_job_id, output_s3_uri


def _failure_message(job: dict) -> str:
    container = job.get("container") or {}
    parts = [
        job.get("statusReason", ""),
        container.get("reason", ""),
    ]
    if container.get("exitCode") is not None:
        parts.append(f"exitCode={container.get('exitCode')}")
    if container.get("logStreamName"):
        parts.append(f"logStreamName={container.get('logStreamName')}")
    message = " | ".join(part for part in parts if part)
    return message or "AWS Batch job failed."


def _describe_batch_job(training_job: TrainingJob) -> dict:
    response = _batch_client().describe_jobs(jobs=[training_job.external_job_id])
    jobs = response.get("jobs") or []
    if not jobs:
        raise ValidationError({"error": "AWS Batch job was not found."})
    return jobs[0]


def get_aws_batch_training_logs(training_job: TrainingJob, limit: int = 300) -> str:
    if not training_job.external_job_id:
        return training_job.training_logs or "AWS Batch job has not been submitted yet."

    job = _describe_batch_job(training_job)
    container = job.get("container") or {}
    log_stream_name = container.get("logStreamName", "")
    if not log_stream_name:
        status_reason = job.get("statusReason", "")
        return training_job.training_logs or status_reason or "CloudWatch log stream is not available yet."

    try:
        response = _logs_client().get_log_events(
            logGroupName=settings.AWS_BATCH_LOG_GROUP,
            logStreamName=log_stream_name,
            startFromHead=True,
            limit=limit,
        )
    except Exception as exc:
        return training_job.training_logs or f"Unable to read CloudWatch logs: {exc}"

    events = response.get("events") or []
    logs = "\n".join(event.get("message", "") for event in events).strip()
    return logs or "CloudWatch log stream is empty."


def refresh_aws_batch_training_job(training_job: TrainingJob) -> TrainingJob:
    _validate_batch_config()
    if not training_job.external_job_id:
        raise ValidationError({"error": "Training job has not been submitted to AWS Batch yet."})

    job = _describe_batch_job(training_job)
    batch_status = job.get("status", "")
    if batch_status in {"SUBMITTED", "PENDING", "RUNNABLE", "STARTING", "RUNNING"}:
        training_job.status = "running"
    elif batch_status == "SUCCEEDED":
        training_job.status = "completed"
        training_job.error_message = ""
        training_job.training_logs = get_aws_batch_training_logs(training_job)
    elif batch_status == "FAILED":
        training_job.status = "failed"
        training_job.error_message = _failure_message(job)
        training_job.training_logs = get_aws_batch_training_logs(training_job)
    else:
        training_job.status = "running"
        training_job.error_message = job.get("statusReason", "")

    training_job.save(update_fields=["status", "error_message", "training_logs", "updated_at"])
    return training_job
