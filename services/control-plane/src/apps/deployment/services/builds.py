from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.deployment.models import Build
from apps.deployment.tasks import cancel_build, execute_build


def request_build(version, backend):
    if version.deployability not in {"deployable", "unknown"}:
        raise ValidationError({"version": version.deployability_reason or "This version is not deployable."})
    build = Build.objects.create(version=version, backend=backend, status="queued")
    transaction.on_commit(lambda: _enqueue(build))
    return build


def _enqueue(build):
    result = execute_build.delay(str(build.public_id))
    Build.objects.filter(pk=build.pk).update(celery_task_id=result.id)


def request_cancel(build):
    if build.status in {"ready", "failed", "cancelled"}:
        return build
    build.status = "cancelled"
    build.save(update_fields=["status", "updated_at"])
    transaction.on_commit(lambda: cancel_build.delay(str(build.public_id)))
    return build
