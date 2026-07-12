from common.api.permissions import HasInternalWebhookSecret
from django.db import transaction
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.training.models import TrainingJob, TrainingJobEvent, TrainingOutput


class TrainingJobWebhookEndpoint(APIView):
    authentication_classes = ()
    permission_classes = (HasInternalWebhookSecret,)

    def post(self, request, job_id):
        key = request.headers.get("Idempotency-Key") or str(request.data.get("idempotency_key", ""))
        with transaction.atomic():
            job = TrainingJob.objects.select_for_update().get(public_id=job_id)
            if key and TrainingJobEvent.objects.filter(job=job, idempotency_key=key).exists():
                return Response({"status": job.status, "duplicate": True})
            status_value = str(request.data.get("status", "")).lower()
            if status_value in {"success", "succeeded", "completed"}:
                job.mark_finished("completed")
                output_uri = request.data.get("output_uri") or job.output_uri
                TrainingOutput.objects.update_or_create(
                    job=job, relative_path="model.tar.gz", defaults={"kind": "model", "s3_uri": output_uri}
                )
            elif status_value in {"failed", "error"}:
                job.mark_finished("failed")
                job.error_message = str(request.data.get("error_message", "Training failed."))[:12000]
            else:
                job.status = status_value or job.status
            job.mlflow_run_id = request.data.get("mlflow_run_id", job.mlflow_run_id)
            job.save()
            TrainingJobEvent.objects.create(
                job=job,
                event_type="webhook",
                message=f"Training status changed to {job.status}.",
                metadata=dict(request.data),
                idempotency_key=key,
            )
        return Response({"status": job.status})
