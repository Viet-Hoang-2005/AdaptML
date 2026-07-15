from django.db import transaction
from django.utils import timezone
from infrastructure.execution import deployment_backend
from rest_framework.exceptions import ValidationError

from apps.deployment.models import Deployment
from apps.deployment.tasks import execute_deployment, stop_deployment


def request_deployment(build, backend):
    with transaction.atomic():
        build = type(build).objects.select_for_update().select_related("version").get(pk=build.pk)
        if build.status != "ready":
            raise ValidationError({"build": "Only a ready build can be deployed."})
        if not build.is_saved:
            build.is_saved = True
            build.saved_at = timezone.now()
            build.save(update_fields=["is_saved", "saved_at", "updated_at"])
        deployment = Deployment.objects.create(version=build.version, build=build, backend=backend, status="pending")
    transaction.on_commit(lambda: _enqueue(deployment))
    return deployment


def _enqueue(deployment):
    result = execute_deployment.delay(str(deployment.public_id))
    Deployment.objects.filter(pk=deployment.pk).update(celery_task_id=result.id)


def request_stop(deployment):
    transaction.on_commit(lambda: stop_deployment.delay(str(deployment.public_id)))
    return deployment


def endpoint_logs(endpoint):
    return deployment_backend(endpoint.deployment.backend).logs(endpoint.deployment)
