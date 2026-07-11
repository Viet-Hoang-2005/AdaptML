from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.models import ModelAPI, TrainingJob
from django.core.cache import cache
from registry.views import (
    build_endpoint_url,
    serialize_model_api,
    sync_registry_version_from_model_api,
    validate_unique_model_version,
)
from training.argo_training_adapter import ArgoTrainingAdapter
from training.kubeflow_service import (
    create_model_artifact_presigned_url,
    get_training_metrics_payload,
)
from training.serializers import (
    create_training_job_event,
    serialize_training_job,
    serialize_training_job_event,
)
from training.services.jobs import _submit_training_job
from training.services.usage import _training_usage_for_user
from training.services.validation import (
    ACTIVE_STATUSES,
    _ensure_active_job_capacity,
    validate_create_training_job_request,
)
from training.tracking_ingestion_service import (
    ingest_training_job_tracking,
    serialize_training_tracking_summary,
)

TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


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
        training_backend = getattr(settings, "TRAINING_BACKEND", "kubeflow")
        if training_backend not in {"kubeflow", "local"}:
            raise ValidationError({"error": "TRAINING_BACKEND must be 'kubeflow' or 'local'."})
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

        base_model = payload["base_model"]
        
        training_job = TrainingJob.objects.create(
            tenant=request.user,
            name=payload["name"],
            model_version=payload["model_version"],
            entry_point=payload["entry_point"],
            requirements_text=payload["requirements_text"],
            training_backend=training_backend,
            vcpu=payload["vcpu"],
            memory=payload["memory"],
            max_runtime_seconds=payload["max_runtime_seconds"],
            accelerator_type=payload["accelerator_type"],
            accelerator_count=payload["accelerator_count"],
            model_api=base_model,
            status="pending",
            # Store S3 prefixes for job runners that support it
            s3_source_uri=payload.get("s3_code_prefix") or "",
            s3_training_data_uri=payload.get("s3_reference_prefix") or "",
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
            if training_job.status == "completed" and training_job.model_artifact_uri:
                ingest_training_job_tracking(training_job)
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
        if training_job.training_backend != "local":
            ArgoTrainingAdapter().cancel_training_job(training_job)
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
        if not original.s3_source_uri or not original.s3_training_data_uri:
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
            requirements_text=original.requirements_text,
            training_backend=original.training_backend,
            vcpu=original.vcpu,
            memory=original.memory,
            max_runtime_seconds=original.max_runtime_seconds,
            accelerator_type=original.accelerator_type,
            accelerator_count=original.accelerator_count,
            s3_source_uri=original.s3_source_uri,
            s3_training_data_uri=original.s3_training_data_uri,
            model_api=original.model_api,
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
        if flavor and flavor not in {"sklearn", "scikit-learn", "xgboost", "pytorch", "keras"}:
            raise ValidationError({"error": "Flavor must be one of: xgboost, scikit-learn (sklearn), pytorch, keras."})

        model_api = (
            ModelAPI.objects.filter(
                tenant=request.user,
                name=model_name,
                version=model_version,
            )
            .exclude(status="disabled")
            .first()
        )
        response_status = status.HTTP_201_CREATED
        if model_api:
            if model_api.source_training_job_id != training_job.id:
                duplicate_error = validate_unique_model_version(request.user, model_name, model_version)
                raise ValidationError({"error": duplicate_error or "Model name and version already exist."})
            response_status = status.HTTP_200_OK
            model_api.description = description or model_api.description
            model_api.access_mode = access_mode
            model_api.source_type = "training_job"
            model_api.source_training_job = training_job
            model_api.source_artifact_uri = training_job.model_artifact_uri
            model_api.flavor = flavor or model_api.flavor
            model_api.endpoint_url = build_endpoint_url(model_api)
            model_api.save(
                update_fields=[
                    "description",
                    "access_mode",
                    "source_type",
                    "source_training_job",
                    "source_artifact_uri",
                    "flavor",
                    "endpoint_url",
                    "updated_at",
                ]
            )
        else:
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
            model_api.endpoint_url = build_endpoint_url(model_api)
            model_api.save(update_fields=["endpoint_url", "updated_at"])

        if training_job.tracking_status in {"", "pending", "skipped"}:
            try:
                ingest_training_job_tracking(training_job)
                training_job.refresh_from_db()
            except Exception as exc:
                training_job.tracking_error = str(exc)
                training_job.save(update_fields=["tracking_error", "updated_at"])

        sync_registry_version_from_model_api(model_api, training_job=training_job)
        create_training_job_event(
            training_job,
            "MODEL_REGISTERED",
            f"Registered model API #{model_api.id} ({model_api.name} {model_api.version}).",
            {"model_api_id": model_api.id, "model_name": model_api.name, "version": model_api.version},
        )
        return Response(serialize_model_api(model_api), status=response_status)


class TrainingJobLogsView(TrainingJobDetailView):
    def get(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)

        offset = int(request.query_params.get("offset", 0))
        limit = int(request.query_params.get("limit", 100))

        try:
            client = cache.client.get_client()
            logs = client.lrange(f"training_logs:{training_job.id}", offset, offset + limit - 1)
            logs_str = [log.decode('utf-8') if isinstance(log, bytes) else str(log) for log in logs]

            # Store to db fallback if finished and logs present
            if logs_str and training_job.status in {"completed", "failed"} and not training_job.training_logs:
                training_job.training_logs = "\n".join(logs_str)
                training_job.save(update_fields=["training_logs", "updated_at"])

            display_text = "\n".join(logs_str)
            if not display_text and training_job.training_logs:
                display_text = training_job.training_logs

            return Response({
                "job_id": training_job.id,
                "training_job_id": training_job.id,
                "logs": logs_str,
                "text": display_text or (training_job.error_message if training_job.error_message else "No training logs are available yet."),
                "next_offset": offset + len(logs),
                "status": training_job.status,
                "error_message": training_job.error_message or "",
                "updated_at": training_job.updated_at,
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": f"Failed to fetch training logs: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TrainingJobMetricsView(TrainingJobDetailView):
    def get(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        return Response(get_training_metrics_payload(training_job), status=status.HTTP_200_OK)


class TrainingJobSummaryView(TrainingJobDetailView):
    def get(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        return Response(serialize_training_tracking_summary(training_job), status=status.HTTP_200_OK)


class TrainingJobIngestTrackingView(TrainingJobDetailView):
    parser_classes = [JSONParser, FormParser]

    def post(self, request, training_job_id):
        training_job = self.get_training_job(request, training_job_id)
        force = bool(request.data.get("force") in {True, "true", "1", "yes"})
        payload = ingest_training_job_tracking(training_job, force=force)
        return Response(payload, status=status.HTTP_200_OK)


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
