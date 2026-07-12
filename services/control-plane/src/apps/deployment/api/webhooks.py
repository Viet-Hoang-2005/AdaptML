from common.api.permissions import HasInternalWebhookSecret
from django.conf import settings
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.deployment.models import Build


class BuildWebhookEndpoint(APIView):
    authentication_classes = ()
    permission_classes = (HasInternalWebhookSecret,)

    def post(self, request, build_id):
        build = Build.objects.select_related("version", "version__project", "version__project__owner").get(
            public_id=build_id
        )
        incoming = str(request.data.get("status", "")).lower()
        if build.status in {"ready", "failed", "cancelled"}:
            return Response({"status": build.status, "duplicate": True})
        if incoming in {"success", "succeeded", "ready", "completed"}:
            project = build.version.project
            base_name = f"{project.owner.tenant_id.lower()}-model-{build.version.public_id}:latest"
            build.status = "ready"
            build.image_uri = (
                f"{settings.HARBOR_REGISTRY_URL}/{settings.HARBOR_USER_PROJECT}/{base_name}"
                if settings.HARBOR_REGISTRY_URL
                else base_name
            )
            build.error_message = ""
        else:
            build.status = "failed"
            build.error_message = str(request.data.get("error_message", "Build failed."))[:12000]
        build.completed_at = timezone.now()
        build.save(update_fields=["status", "image_uri", "error_message", "completed_at", "updated_at"])
        return Response({"status": build.status})
