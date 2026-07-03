import logging
from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from training.models import TrainingJob

logger = logging.getLogger("paas.training.webhook")


class TrainingJobWebhookView(APIView):
    permission_classes = [AllowAny]

    def post(self, request, training_job_id):
        webhook_secret = getattr(settings, "CONTROL_PLANE_WEBHOOK_SECRET", "")
        if webhook_secret:
            provided_secret = (
                request.headers.get("X-Training-Webhook-Secret", "")
                or request.headers.get("Authorization", "").replace("Bearer ", "")
            )
            if provided_secret != webhook_secret:
                logger.warning("Rejected training webhook for job %s due to invalid secret.", training_job_id)
                return Response({"error": "Invalid training webhook secret."}, status=status.HTTP_403_FORBIDDEN)

        training_job = TrainingJob.objects.filter(id=training_job_id).first()
        if not training_job:
            return Response({"error": "Training job not found."}, status=status.HTTP_404_NOT_FOUND)

        data = request.data
        status_val = data.get("status")
        logger.info("Received training webhook for job %s with status=%s", training_job_id, status_val)

        if status_val == "completed":
            training_job.status = "completed"
            training_job.error_message = ""
            incoming_artifact = data.get("model_artifact_uri") or ""
            if incoming_artifact.startswith("s3://"):
                training_job.model_artifact_uri = incoming_artifact
            incoming_output = data.get("output_s3_uri") or ""
            if incoming_output.startswith("s3://"):
                training_job.output_s3_uri = incoming_output
            training_job.mark_finished(save=False)
            update_fields = [
                "status",
                "error_message",
                "model_artifact_uri",
                "output_s3_uri",
                "completed_at",
                "runtime_seconds",
                "stop_reason",
                "updated_at",
            ]
        else:
            training_job.status = "failed"
            training_job.error_message = data.get("error_message", "Training pipeline failed during execution.")
            training_job.mark_finished(training_job.error_message, save=False)
            update_fields = [
                "status",
                "error_message",
                "completed_at",
                "runtime_seconds",
                "stop_reason",
                "updated_at",
            ]

        training_job.save(update_fields=update_fields)
        return Response({"message": f"Training job {training_job_id} updated to {training_job.status}."}, status=status.HTTP_200_OK)
