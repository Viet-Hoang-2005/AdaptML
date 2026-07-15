from django.db import transaction
from django.utils import timezone
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


def save_build(build):
    with transaction.atomic():
        build = Build.objects.select_for_update().get(pk=build.pk)
        if build.status != "ready":
            raise ValidationError({"build": "Only a ready build can be saved."})
        if not build.is_saved:
            build.is_saved = True
            build.saved_at = timezone.now()
            build.save(update_fields=["is_saved", "saved_at", "updated_at"])
    return build
