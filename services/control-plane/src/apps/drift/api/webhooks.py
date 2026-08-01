from common.api.permissions import HasInternalWebhookSecret
from django.db import transaction
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.drift.models import DriftRun


class DriftRunWebhookEndpoint(APIView):
    authentication_classes = ()
    permission_classes = (HasInternalWebhookSecret,)

    def post(self, request, run_id):
        with transaction.atomic():
            run = DriftRun.objects.select_for_update().get(public_id=run_id)
            if run.status in {"completed", "failed", "cancelled"}:
                return Response({"status": run.status, "duplicate": True})
            summary = request.data.get("drift_summary") or request.data.get("summary") or {}
            run.summary = summary
            run.drift_score = summary.get("drift_score", summary.get("share_of_drifted_columns"))
            run.has_drift = summary.get("has_drift", summary.get("dataset_drift"))
            run.status = "completed"
            run.completed_at = timezone.now()
            run.save(update_fields=["summary", "drift_score", "has_drift", "status", "completed_at"])
        return Response({"status": run.status})
