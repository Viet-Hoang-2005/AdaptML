from pathlib import Path
import zipfile

from django.conf import settings
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.models import ModelAPI, TrainingJob
from .model_api_views import serialize_model_api, validate_unique_model_version
from .hashid_utils import encode_model_id
from .aws_batch_training_service import (
    cancel_aws_batch_training_job,
    get_aws_batch_training_log_payload,
    get_training_metrics_payload,
    refresh_aws_batch_training_job,
    start_aws_batch_training_job,
    strip_training_metric_lines,
)
from .local_training_service import run_local_training_job
from .sagemaker_service import (
    create_model_artifact_presigned_url,
    refresh_sagemaker_training_job,
    start_sagemaker_training_job,
)

MAX_TRAINING_FILE_SIZE_BYTES = 512 * 1024 * 1024
RUNTIME_PROFILES = {
    (1, 2048): "small",
    (2, 4096): "medium",
    (4, 8192): "large",
}
ACCELERATOR_TYPES = {"none", "gpu", "tpu", "trainium"}
GPU_ACCELERATOR_COUNTS = {1, 2, 4}
ACTIVE_STATUSES = {"pending", "uploading", "running"}
TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


def create_training_job_event(training_job, event_type, message, metadata=None):
    training_job.events.create(event_type=event_type, message=message, metadata=metadata or {})


def serialize_training_job_event(event):
    return {
        "id": event.id,
        "training_job": event.training_job_id,
        "event_type": event.event_type,
        "message": event.message,
        "metadata": event.metadata,
        "created_at": event.created_at,
    }


def _current_month_window():
    now = timezone.now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if month_start.month == 12:
        month_end = month_start.replace(year=month_start.year + 1, month=1)
    else:
        month_end = month_start.replace(month=month_start.month + 1)
    return month_start, month_end


def _training_usage_for_user(user):
    month_start, month_end = _current_month_window()
    jobs = TrainingJob.objects.filter(
        tenant=user,
        created_at__gte=month_start,
        created_at__lt=month_end,
        deleted_at__isnull=True,
    )
    stored_runtime = jobs.aggregate(total=Sum("runtime_seconds"))["total"] or 0
    running_runtime = 0
    now = timezone.now()
    for job in jobs.filter(status="running"):
        if job.started_at:
            running_runtime += max(int((now - job.started_at).total_seconds()), 0)

    monthly_runtime_seconds = stored_runtime + running_runtime
    monthly_quota_seconds = settings.TRAINING_MONTHLY_QUOTA_SECONDS
    counts = jobs.aggregate(
        active_jobs_count=Count("id", filter=Q(status__in=ACTIVE_STATUSES)),
        running_jobs_count=Count("id", filter=Q(status="running")),
        completed_jobs_count=Count("id", filter=Q(status="completed")),
        failed_jobs_count=Count("id", filter=Q(status="failed")),
    )

    return {
        "training_backend": settings.TRAINING_BACKEND,
        "monthly_quota_seconds": monthly_quota_seconds,
        "monthly_runtime_seconds": monthly_runtime_seconds,
        "remaining_seconds": max(monthly_quota_seconds - monthly_runtime_seconds, 0),
        "active_jobs_count": counts["active_jobs_count"],
        "running_jobs_count": counts["running_jobs_count"],
        "completed_jobs_count": counts["completed_jobs_count"],
        "failed_jobs_count": counts["failed_jobs_count"],
        "current_month_start": month_start,
        "current_month_end": month_end,
    }


def serialize_training_job(training_job: TrainingJob):
    registered_model = (
        training_job.registered_model_apis.exclude(status="disabled")
        .order_by("-updated_at")
        .first()
    )
    return {
        "id": training_job.id,
        "name": training_job.name,
        "model_version": training_job.model_version,
        "entry_point": training_job.entry_point,
        "training_backend": training_job.training_backend,
        "vcpu": training_job.vcpu,
        "memory": training_job.memory,
        "max_runtime_seconds": training_job.max_runtime_seconds,
        "accelerator_type": training_job.accelerator_type,
        "accelerator_count": training_job.accelerator_count,
        "retry_of": training_job.retry_of_id,
        "source_zip": training_job.source_zip.url if training_job.source_zip else "",
        "requirements_file": training_job.requirements_file.url if training_job.requirements_file else "",
        "training_data": training_job.training_data.url if training_job.training_data else "",
        "s3_source_uri": training_job.s3_source_uri,
        "s3_training_data_uri": training_job.s3_training_data_uri,
        "sagemaker_job_name": training_job.sagemaker_job_name,
        "external_job_id": training_job.external_job_id,
        "output_s3_uri": training_job.output_s3_uri,
        "model_artifact_uri": training_job.model_artifact_uri,
        "status": training_job.status,
        "error_message": training_job.error_message,
        "training_logs": training_job.training_logs,
        "started_at": training_job.started_at,
        "completed_at": training_job.completed_at,
        "runtime_seconds": training_job.runtime_seconds,
        "stop_reason": training_job.stop_reason,
        "deleted_at": training_job.deleted_at,
        "is_deleted": bool(training_job.deleted_at),
        "registered_model": serialize_model_api(registered_model) if registered_model else None,
        "registered_model_id": encode_model_id(registered_model.id) if registered_model else None,
        "created_at": training_job.created_at,
        "updated_at": training_job.updated_at,
    }


def _validate_upload_size(upload, label):
    if upload.size > MAX_TRAINING_FILE_SIZE_BYTES:
        raise ValidationError({"error": f"{label} must be 512MB or smaller."})


def _parse_positive_int(value, field_name, default):
    raw_value = value if value not in {None, ""} else default
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        raise ValidationError({"error": f"{field_name} must be a positive integer."})
    if parsed <= 0:
        raise ValidationError({"error": f"{field_name} must be a positive integer."})
    return parsed


def _parse_non_negative_int(value, field_name, default):
    raw_value = value if value not in {None, ""} else default
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        raise ValidationError({"error": f"{field_name} must be a non-negative integer."})
    if parsed < 0:
        raise ValidationError({"error": f"{field_name} must be a non-negative integer."})
    return parsed


def _validate_accelerator_config(accelerator_type, accelerator_count, training_backend):
    if accelerator_type not in ACCELERATOR_TYPES:
        raise ValidationError({"error": "accelerator_type must be one of: none, gpu, tpu, trainium."})
    if accelerator_type == "none":
        if accelerator_count != 0:
            raise ValidationError({"error": "accelerator_count must be 0 when accelerator_type is none."})
        return
    if accelerator_type in {"tpu", "trainium"}:
        raise ValidationError({"error": f"{accelerator_type.upper()} training is not supported yet."})
    if accelerator_type == "gpu":
        if accelerator_count not in GPU_ACCELERATOR_COUNTS:
            raise ValidationError({"error": "GPU accelerator_count must be one of: 1, 2, 4."})
        if training_backend == "aws_batch" and not settings.ENABLE_GPU_TRAINING:
            raise ValidationError(
                {
                    "error": (
                        "GPU training is not enabled. Configure AWS Batch EC2 GPU queue/job definition first."
                    )
                }
            )
        if training_backend == "aws_batch" and (
            not settings.AWS_BATCH_GPU_JOB_QUEUE or not settings.AWS_BATCH_GPU_JOB_DEFINITION
        ):
            raise ValidationError(
                {
                    "error": (
                        "Missing AWS Batch GPU configuration: AWS_BATCH_GPU_JOB_QUEUE, "
                        "AWS_BATCH_GPU_JOB_DEFINITION."
                    )
                }
            )


def _validate_source_zip_entry_point(source_zip, entry_point):
    try:
        source_zip.seek(0)
        with zipfile.ZipFile(source_zip) as archive:
            file_names = [item.filename.replace("\\", "/").lstrip("./").lstrip("/") for item in archive.infolist()]
    except zipfile.BadZipFile:
        raise ValidationError({"error": "source_zip is not a valid zip archive."})
    finally:
        try:
            source_zip.seek(0)
        except Exception:
            pass

    if not file_names:
        raise ValidationError({"error": "source_zip is empty."})

    has_template_bundle = "source.zip" in file_names and not any(Path(name).name == "train.py" for name in file_names)
    if has_template_bundle:
        raise ValidationError(
            {
                "error": (
                    "You uploaded the template bundle. Extract it and upload the inner source.zip, "
                    "or use the included train.csv/requirements.txt separately."
                )
            }
        )

    normalized_entry_point = entry_point.replace("\\", "/").lstrip("./").lstrip("/")
    if normalized_entry_point not in file_names:
        matching_names = [name for name in file_names if Path(name).name == Path(normalized_entry_point).name]
        suggestion = f" Did you mean '{matching_names[0]}'?" if len(matching_names) == 1 else ""
        raise ValidationError(
            {
                "error": (
                    f"Source zip must contain the configured entry point '{normalized_entry_point}'."
                    f"{suggestion}"
                )
            }
        )


def _ensure_active_job_capacity(user):
    active_count = TrainingJob.objects.filter(
        tenant=user,
        deleted_at__isnull=True,
        status__in=ACTIVE_STATUSES,
    ).count()
    if active_count >= settings.TRAINING_MAX_ACTIVE_JOBS_PER_TENANT:
        raise ValidationError(
            {
                "error": (
                    "You already have an active training job. Please wait for it to finish or cancel it first."
                )
            }
        )


def _submit_training_job(training_job, training_backend):
    if training_backend == "local":
        run_local_training_job(training_job)
    elif training_backend == "aws_batch":
        start_aws_batch_training_job(training_job)
    else:
        start_sagemaker_training_job(training_job)
    create_training_job_event(training_job, "JOB_SUBMITTED", "Training job submitted to backend.")


def validate_create_training_job_request(request):
    name = (request.data.get("name") or "").strip()
    model_version = (request.data.get("model_version") or "").strip()
    entry_point = (request.data.get("entry_point") or "train.py").strip()
    max_runtime_seconds = _parse_positive_int(request.data.get("max_runtime_seconds"), "max_runtime_seconds", 3600)
    vcpu = _parse_positive_int(request.data.get("vcpu"), "vcpu", 2)
    memory = _parse_positive_int(request.data.get("memory"), "memory", 4096)
    accelerator_type = (request.data.get("accelerator_type") or "none").strip().lower()
    accelerator_count = _parse_non_negative_int(request.data.get("accelerator_count"), "accelerator_count", 0)
    source_zip = request.FILES.get("source_zip")
    requirements_file = request.FILES.get("requirements_file")
    training_data = request.FILES.get("training_data")

    if not name:
        raise ValidationError({"error": "Training job name is required."})
    if not model_version:
        raise ValidationError({"error": "Model version is required."})
    if not entry_point:
        raise ValidationError({"error": "Entry point is required."})
    if max_runtime_seconds > settings.TRAINING_MAX_RUNTIME_SECONDS:
        raise ValidationError({"error": "Max runtime cannot exceed 12 hours per training job."})
    if (vcpu, memory) not in RUNTIME_PROFILES:
        raise ValidationError(
            {
                "error": (
                    "Invalid runtime profile. Supported profiles are: "
                    "small=1 vCPU/2048MB, medium=2 vCPU/4096MB, large=4 vCPU/8192MB."
                )
            }
        )
    training_backend = settings.TRAINING_BACKEND
    _validate_accelerator_config(accelerator_type, accelerator_count, training_backend)
    if not source_zip:
        raise ValidationError({"error": "Source code zip is required."})
    if not training_data:
        raise ValidationError({"error": "Training data CSV is required."})

    _validate_upload_size(source_zip, "Source code zip")
    _validate_upload_size(training_data, "Training data CSV")

    if not source_zip.name.lower().endswith(".zip"):
        raise ValidationError({"error": "source_zip must be a .zip file."})
    if not training_data.name.lower().endswith(".csv"):
        raise ValidationError({"error": "training_data must be a .csv file."})

    if requirements_file:
        _validate_upload_size(requirements_file, "requirements.txt")
        requirements_name = requirements_file.name.lower()
        if not (requirements_name.endswith(".txt") or requirements_name == "requirements.txt"):
            raise ValidationError({"error": "requirements_file must be a .txt file or named requirements.txt."})

    entry_point_path = Path(entry_point)
    if entry_point_path.is_absolute() or ".." in entry_point_path.parts:
        raise ValidationError({"error": "entry_point must be a relative path inside source_zip."})
    _validate_source_zip_entry_point(source_zip, entry_point)

    return {
        "name": name,
        "model_version": model_version,
        "entry_point": entry_point,
        "vcpu": vcpu,
        "memory": memory,
        "max_runtime_seconds": max_runtime_seconds,
        "accelerator_type": accelerator_type,
        "accelerator_count": accelerator_count,
        "source_zip": source_zip,
        "requirements_file": requirements_file,
        "training_data": training_data,
    }


class TrainingJobListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        include_deleted = (request.query_params.get("include_deleted") or "").lower() in {"1", "true", "yes"}
        training_jobs = TrainingJob.objects.filter(tenant=request.user)
        if not include_deleted:
            training_jobs = training_jobs.filter(deleted_at__isnull=True)
        return Response(
            {"training_jobs": [serialize_training_job(item) for item in training_jobs]},
            status=status.HTTP_200_OK,
        )

    def post(self, request):
        payload = validate_create_training_job_request(request)
        training_backend = settings.TRAINING_BACKEND
        if training_backend not in {"sagemaker", "local", "aws_batch"}:
            raise ValidationError({"error": "TRAINING_BACKEND must be 'sagemaker', 'local', or 'aws_batch'."})
        _ensure_active_job_capacity(request.user)

        usage = _training_usage_for_user(request.user)
        if payload["max_runtime_seconds"] > usage["remaining_seconds"]:
            raise ValidationError(
                {
                    "error": (
                        "Monthly training quota exceeded. "
                        f"Remaining quota is {usage['remaining_seconds']} seconds, "
                        f"but this job requests {payload['max_runtime_seconds']} seconds."
                    )
                }
            )

        training_job = TrainingJob.objects.create(
            tenant=request.user,
            name=payload["name"],
            model_version=payload["model_version"],
            entry_point=payload["entry_point"],
            training_backend=training_backend,
            vcpu=payload["vcpu"],
            memory=payload["memory"],
            max_runtime_seconds=payload["max_runtime_seconds"],
            accelerator_type=payload["accelerator_type"],
            accelerator_count=payload["accelerator_count"],
            source_zip=payload["source_zip"],
            requirements_file=payload["requirements_file"],
            training_data=payload["training_data"],
            status="pending",
        )
        create_training_job_event(training_job, "JOB_CREATED", "Training job created.")

        try:
            _submit_training_job(training_job, training_backend)
        except ValidationError:
            training_job.status = "failed"
            training_job.save(update_fields=["status", "updated_at"])
            create_training_job_event(training_job, "JOB_FAILED", "Training job failed before submission.")
            raise
        except Exception as exc:
            training_job.status = "failed"
            training_job.error_message = str(exc)
            training_job.save(update_fields=["status", "error_message", "updated_at"])
            create_training_job_event(training_job, "JOB_FAILED", str(exc))
            return Response(serialize_training_job(training_job), status=status.HTTP_502_BAD_GATEWAY)

        return Response(serialize_training_job(training_job), status=status.HTTP_201_CREATED)


class TrainingJobDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_training_job(self, request, training_job_id):
        training_job = TrainingJob.objects.filter(id=training_job_id, tenant=request.user).first()
        if not training_job:
            raise ValidationError({"error": "Training job not found."})
        return training_job

    def get(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        return Response(serialize_training_job(training_job), status=status.HTTP_200_OK)

    def delete(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        if not training_job.deleted_at:
            training_job.deleted_at = timezone.now()
            training_job.save(update_fields=["deleted_at", "updated_at"])
        return Response(serialize_training_job(training_job), status=status.HTTP_200_OK)


class TrainingJobRefreshStatusView(TrainingJobDetailView):
    def post(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        previous_status = training_job.status
        if training_job.training_backend == "local":
            return Response(serialize_training_job(training_job), status=status.HTTP_200_OK)

        try:
            if training_job.training_backend == "aws_batch":
                refresh_aws_batch_training_job(training_job)
            else:
                refresh_sagemaker_training_job(training_job)
            if previous_status != training_job.status:
                event_type = {
                    "running": "JOB_RUNNING",
                    "completed": "JOB_COMPLETED",
                    "failed": "JOB_FAILED",
                    "cancelled": "JOB_CANCELLED",
                }.get(training_job.status, "JOB_STATUS_CHANGED")
                create_training_job_event(
                    training_job,
                    event_type,
                    f"Training job status changed from {previous_status} to {training_job.status}.",
                )
        except Exception as exc:
            training_job.error_message = str(exc)
            training_job.save(update_fields=["error_message", "updated_at"])
            return Response(serialize_training_job(training_job), status=status.HTTP_502_BAD_GATEWAY)
        return Response(serialize_training_job(training_job), status=status.HTTP_200_OK)


class TrainingJobCancelView(TrainingJobDetailView):
    def post(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        if training_job.status in TERMINAL_STATUSES:
            return Response(
                {
                    "message": f"Training job is already {training_job.status}.",
                    "training_job": serialize_training_job(training_job),
                },
                status=status.HTTP_200_OK,
            )
        if training_job.status not in ACTIVE_STATUSES:
            raise ValidationError({"error": "Only pending, uploading, or running jobs can be cancelled."})

        reason = "User cancelled training job"
        if training_job.training_backend == "aws_batch":
            cancel_aws_batch_training_job(training_job, reason)
        elif training_job.training_backend == "local":
            raise ValidationError({"error": "Cancel is not supported for local training jobs in this demo backend."})

        training_job.status = "cancelled"
        training_job.error_message = ""
        training_job.mark_finished(reason, save=False)
        training_job.save(
            update_fields=[
                "status",
                "error_message",
                "completed_at",
                "runtime_seconds",
                "stop_reason",
                "updated_at",
            ]
        )
        create_training_job_event(training_job, "JOB_CANCELLED", reason)
        return Response(serialize_training_job(training_job), status=status.HTTP_200_OK)


class TrainingJobRetryView(TrainingJobDetailView):
    def post(self, request, training_job_id):
        original = self.get_training_job(request, training_job_id)
        if original.status not in {"failed", "cancelled"}:
            raise ValidationError({"error": "Only failed or cancelled jobs can be retried."})
        if not original.source_zip or not original.training_data:
            raise ValidationError({"error": "Retry from existing artifacts is not available for this job."})

        _ensure_active_job_capacity(request.user)
        usage = _training_usage_for_user(request.user)
        if original.max_runtime_seconds > usage["remaining_seconds"]:
            raise ValidationError(
                {
                    "error": (
                        "Monthly training quota exceeded. "
                        f"Remaining quota is {usage['remaining_seconds']} seconds, "
                        f"but this retry requests {original.max_runtime_seconds} seconds."
                    )
                }
            )

        retry_job = TrainingJob.objects.create(
            tenant=request.user,
            name=original.name,
            model_version=original.model_version,
            entry_point=original.entry_point,
            training_backend=original.training_backend,
            vcpu=original.vcpu,
            memory=original.memory,
            max_runtime_seconds=original.max_runtime_seconds,
            accelerator_type=original.accelerator_type,
            accelerator_count=original.accelerator_count,
            source_zip=original.source_zip.name,
            requirements_file=original.requirements_file.name if original.requirements_file else None,
            training_data=original.training_data.name,
            retry_of=original,
            status="pending",
        )
        create_training_job_event(retry_job, "JOB_CREATED", f"Retry job created from training job #{original.id}.")
        create_training_job_event(original, "JOB_RETRIED", f"Retry job #{retry_job.id} created.")

        try:
            _submit_training_job(retry_job, retry_job.training_backend)
        except Exception as exc:
            retry_job.status = "failed"
            retry_job.error_message = str(exc)
            retry_job.save(update_fields=["status", "error_message", "updated_at"])
            create_training_job_event(retry_job, "JOB_FAILED", str(exc))
            return Response(serialize_training_job(retry_job), status=status.HTTP_502_BAD_GATEWAY)

        return Response(serialize_training_job(retry_job), status=status.HTTP_201_CREATED)


class TrainingJobDownloadURLView(TrainingJobDetailView):
    def get(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        download_url = create_model_artifact_presigned_url(training_job)
        return Response({"download_url": download_url}, status=status.HTTP_200_OK)


class TrainingJobRegisterModelView(TrainingJobDetailView):
    parser_classes = [JSONParser, FormParser]

    def post(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        if training_job.deleted_at:
            raise ValidationError({"error": "Archived training jobs cannot be registered as models."})
        if training_job.status != "completed":
            raise ValidationError({"error": "Only completed training jobs can be registered as models."})
        if not training_job.model_artifact_uri:
            raise ValidationError({"error": "Training job does not have a model artifact URI."})

        model_name = (request.data.get("model_name") or training_job.name).strip()
        model_version = (request.data.get("model_version") or training_job.model_version or "v1").strip() or "v1"
        flavor = (request.data.get("flavor") or "").strip().lower()
        access_mode = (request.data.get("access_mode") or "private").strip().lower()
        description = (request.data.get("description") or "").strip()

        if not model_name:
            raise ValidationError({"error": "Model name is required."})
        if access_mode not in {"private", "public"}:
            raise ValidationError({"error": "Access mode must be private or public."})
        if flavor and flavor not in {"sklearn", "xgboost"}:
            raise ValidationError({"error": "Flavor must be sklearn or xgboost."})

        duplicate_error = validate_unique_model_version(request.user, model_name, model_version)
        if duplicate_error:
            raise ValidationError({"error": duplicate_error})

        model_api = ModelAPI.objects.create(
            tenant=request.user,
            name=model_name,
            version=model_version,
            description=description,
            model_info=f"Registered from training job #{training_job.id}",
            access_mode=access_mode,
            source_type="training_job",
            source_training_job=training_job,
            source_artifact_uri=training_job.model_artifact_uri,
            flavor=flavor,
            status="uploading",
            build_status="not_started",
        )
        from .model_api_views import build_endpoint_url
        model_api.endpoint_url = build_endpoint_url(model_api)
        model_api.save(update_fields=["endpoint_url", "updated_at"])
        create_training_job_event(
            training_job,
            "MODEL_REGISTERED",
            f"Registered model API #{model_api.id} ({model_api.name} {model_api.version}).",
            {"model_api_id": model_api.id, "model_name": model_api.name, "version": model_api.version},
        )
        return Response(serialize_model_api(model_api), status=status.HTTP_201_CREATED)


class TrainingJobLogsView(TrainingJobDetailView):
    def get(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)

        logs = training_job.training_logs
        log_stream_name = ""
        next_token = ""
        if training_job.training_backend == "aws_batch":
            log_payload = get_aws_batch_training_log_payload(training_job)
            logs = log_payload["logs"]
            log_stream_name = log_payload["log_stream_name"]
            next_token = log_payload["next_token"]
            if logs != training_job.training_logs:
                training_job.training_logs = logs
                training_job.save(update_fields=["training_logs", "updated_at"])

        if not logs and training_job.error_message:
            logs = training_job.error_message
        display_logs = strip_training_metric_lines(logs)

        return Response(
            {
                "job_id": training_job.id,
                "training_job_id": training_job.id,
                "status": training_job.status,
                "logs": display_logs or "No training logs are available yet.",
                "text": display_logs or "No training logs are available yet.",
                "log_stream_name": log_stream_name,
                "next_token": next_token,
                "updated_at": training_job.updated_at,
            },
            status=status.HTTP_200_OK,
        )


class TrainingJobMetricsView(TrainingJobDetailView):
    def get(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        return Response(get_training_metrics_payload(training_job), status=status.HTTP_200_OK)


class TrainingJobEventsView(TrainingJobDetailView):
    def get(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        return Response(
            {"events": [serialize_training_job_event(event) for event in training_job.events.all()]},
            status=status.HTTP_200_OK,
        )


class TrainingJobRestoreView(TrainingJobDetailView):
    def post(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        if training_job.deleted_at:
            training_job.deleted_at = None
            training_job.save(update_fields=["deleted_at", "updated_at"])
        return Response(serialize_training_job(training_job), status=status.HTTP_200_OK)


class TrainingUsageView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(_training_usage_for_user(request.user), status=status.HTTP_200_OK)
