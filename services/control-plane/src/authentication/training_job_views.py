from pathlib import Path

from django.conf import settings
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import TrainingJob
from .aws_batch_training_service import (
    get_aws_batch_training_log_payload,
    refresh_aws_batch_training_job,
    start_aws_batch_training_job,
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
    jobs = TrainingJob.objects.filter(tenant=user, created_at__gte=month_start, created_at__lt=month_end)
    stored_runtime = jobs.aggregate(total=Sum("runtime_seconds"))["total"] or 0
    running_runtime = 0
    now = timezone.now()
    for job in jobs.filter(status="running"):
        if job.started_at:
            running_runtime += max(int((now - job.started_at).total_seconds()), 0)

    monthly_runtime_seconds = stored_runtime + running_runtime
    monthly_quota_seconds = settings.TRAINING_MONTHLY_QUOTA_SECONDS
    counts = jobs.aggregate(
        running_jobs_count=Count("id", filter=Q(status="running")),
        completed_jobs_count=Count("id", filter=Q(status="completed")),
        failed_jobs_count=Count("id", filter=Q(status="failed")),
    )

    return {
        "training_backend": settings.TRAINING_BACKEND,
        "monthly_quota_seconds": monthly_quota_seconds,
        "monthly_runtime_seconds": monthly_runtime_seconds,
        "remaining_seconds": max(monthly_quota_seconds - monthly_runtime_seconds, 0),
        "running_jobs_count": counts["running_jobs_count"],
        "completed_jobs_count": counts["completed_jobs_count"],
        "failed_jobs_count": counts["failed_jobs_count"],
        "current_month_start": month_start,
        "current_month_end": month_end,
    }


def serialize_training_job(training_job: TrainingJob):
    return {
        "id": training_job.id,
        "name": training_job.name,
        "model_version": training_job.model_version,
        "entry_point": training_job.entry_point,
        "training_backend": training_job.training_backend,
        "vcpu": training_job.vcpu,
        "memory": training_job.memory,
        "max_runtime_seconds": training_job.max_runtime_seconds,
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


def validate_create_training_job_request(request):
    name = (request.data.get("name") or "").strip()
    model_version = (request.data.get("model_version") or "").strip()
    entry_point = (request.data.get("entry_point") or "train.py").strip()
    max_runtime_seconds = _parse_positive_int(request.data.get("max_runtime_seconds"), "max_runtime_seconds", 3600)
    vcpu = _parse_positive_int(request.data.get("vcpu"), "vcpu", 2)
    memory = _parse_positive_int(request.data.get("memory"), "memory", 4096)
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

    return {
        "name": name,
        "model_version": model_version,
        "entry_point": entry_point,
        "vcpu": vcpu,
        "memory": memory,
        "max_runtime_seconds": max_runtime_seconds,
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
            source_zip=payload["source_zip"],
            requirements_file=payload["requirements_file"],
            training_data=payload["training_data"],
            status="pending",
        )

        try:
            if training_backend == "local":
                run_local_training_job(training_job)
            elif training_backend == "aws_batch":
                start_aws_batch_training_job(training_job)
            else:
                start_sagemaker_training_job(training_job)
        except ValidationError:
            training_job.status = "failed"
            training_job.save(update_fields=["status", "updated_at"])
            raise
        except Exception as exc:
            training_job.status = "failed"
            training_job.error_message = str(exc)
            training_job.save(update_fields=["status", "error_message", "updated_at"])
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
        if training_job.training_backend == "local":
            return Response(serialize_training_job(training_job), status=status.HTTP_200_OK)

        try:
            if training_job.training_backend == "aws_batch":
                refresh_aws_batch_training_job(training_job)
            else:
                refresh_sagemaker_training_job(training_job)
        except Exception as exc:
            training_job.error_message = str(exc)
            training_job.save(update_fields=["error_message", "updated_at"])
            return Response(serialize_training_job(training_job), status=status.HTTP_502_BAD_GATEWAY)
        return Response(serialize_training_job(training_job), status=status.HTTP_200_OK)


class TrainingJobDownloadURLView(TrainingJobDetailView):
    def get(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        download_url = create_model_artifact_presigned_url(training_job)
        return Response({"download_url": download_url}, status=status.HTTP_200_OK)


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

        return Response(
            {
                "job_id": training_job.id,
                "training_job_id": training_job.id,
                "status": training_job.status,
                "logs": logs or "No training logs are available yet.",
                "text": logs or "No training logs are available yet.",
                "log_stream_name": log_stream_name,
                "next_token": next_token,
                "updated_at": training_job.updated_at,
            },
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
