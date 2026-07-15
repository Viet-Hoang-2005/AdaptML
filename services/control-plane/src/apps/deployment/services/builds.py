from django.db import transaction
from django.utils import timezone
from infrastructure.execution.image_cleanup import BuildImageCleaner
from rest_framework.exceptions import ValidationError

from apps.deployment.models import Build
from apps.deployment.tasks import cancel_build, discard_build_image, execute_build


def request_build(version, backend):
    if version.deployability not in {"deployable", "unknown"}:
        raise ValidationError({"version": version.deployability_reason or "This version is not deployable."})
    # A rebuild replaces only disposable images from the same tenant project.
    # Saved and deployed builds are intentionally retained as reproducible artifacts.
    for previous_build in Build.objects.filter(
        version__project=version.project,
        status="ready",
        is_saved=False,
        deployments__isnull=True,
    ):
        request_discard(previous_build)
    build = Build.objects.create(version=version, backend=backend, status="queued")
    transaction.on_commit(lambda: _enqueue(build))
    return build


def _enqueue(build):
    result = execute_build.delay(str(build.public_id))
    Build.objects.filter(pk=build.pk).update(celery_task_id=result.id)


def request_cancel(build):
    if build.status in {"ready", "failed", "cancelled", "discarded"}:
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


def request_discard(build):
    """Discard an unretained image asynchronously without trusting the browser to clean it up."""
    with transaction.atomic():
        build = Build.objects.select_for_update().get(pk=build.pk)
        if build.status == "discarded" or build.is_saved:
            return build
        if build.status != "ready":
            raise ValidationError({"build": "Only a ready, unsaved build can be discarded."})
        if build.deployments.exists(): # type: ignore[attr-defined]
            raise ValidationError({"build": "A build with a deployment cannot be discarded."})
        transaction.on_commit(lambda: discard_build_image.delay(str(build.public_id)))
    return build


def discard_ready_unsaved_build(build_id, image_cleaner=None):
    """Delete an unretained image after locking the Build lifecycle record."""
    with transaction.atomic():
        build = Build.objects.select_for_update().get(public_id=build_id)
        if build.status == "discarded":
            return "already-discarded"
        if build.is_saved or build.status != "ready" or build.deployments.exists(): # type: ignore[attr-defined]
            return "retained"
        result = (image_cleaner or BuildImageCleaner()).delete(build)
        build.status = "discarded"
        build.discarded_at = timezone.now()
        build.error_message = "Unsaved image discarded."
        build.save(update_fields=["status", "discarded_at", "error_message", "updated_at"])
    return result


def expired_unsaved_build_ids(cutoff, limit=100):
    return list(
        Build.objects.filter(
            status="ready",
            is_saved=False,
            completed_at__lte=cutoff,
            deployments__isnull=True,
        )
        .order_by("completed_at")
        .values_list("public_id", flat=True)[:limit]
    )
