import logging

from celery import shared_task
from django.db import transaction
from django.utils import timezone
from infrastructure.execution import build_backend, deployment_backend

from apps.deployment.services.logs import append_deployment_log, reset_deployment_logs
from apps.observability.services.outbox import enqueue_event

logger = logging.getLogger(__name__)


def _mark_deployment_healthy(deployment):
    from .models import Endpoint

    Deployment = type(deployment)
    Deployment.objects.filter(pk=deployment.pk).update(
        status="healthy", deployed_at=timezone.now(), error_message=""
    )
    Endpoint.objects.filter(deployment=deployment).update(
        health_status="healthy", last_checked_at=timezone.now()
    )
    append_deployment_log(deployment, "Endpoint passed health checks; deployment is healthy.")
    enqueue_event(
        topic="deployment.events",
        aggregate_type="deployment",
        aggregate_id=deployment.public_id,
        event_type="deployment.changed",
        payload={"deployment_id": str(deployment.public_id), "status": "healthy"},
    )


@shared_task(
    bind=True, autoretry_for=(ConnectionError, TimeoutError), retry_backoff=True, retry_jitter=True, max_retries=5
)
def execute_build(self, build_id):
    from .models import Build

    with transaction.atomic():
        build = (
            Build.objects.select_for_update()
            .select_related("version", "version__project", "version__project__owner")
            .get(public_id=build_id)
        )
        if build.status in {"ready", "cancelled"}:
            return build.status
        build.status = "building"
        build.started_at = build.started_at or timezone.now()
        build.celery_task_id = self.request.id or build.celery_task_id
        build.error_message = ""
        build.save(update_fields=["status", "started_at", "celery_task_id", "error_message", "updated_at"])
    try:
        result = build_backend(build.backend).run(build)
    except Exception as exc:
        Build.objects.filter(pk=build.pk).update(
            status="failed", error_message=str(exc)[:12000], completed_at=timezone.now()
        )
        raise
    if isinstance(result, dict) and result.get("dispatched"):
        return "building"
    Build.objects.filter(pk=build.pk).update(
        status="ready",
        logs=str(result)[-20000:],
        completed_at=timezone.now(),
        error_message="",
    )
    return "ready"


@shared_task(bind=True)
def cancel_build(self, build_id):
    from .models import Build

    build = Build.objects.select_related("version").get(public_id=build_id)
    build_backend(build.backend).cancel(build)
    Build.objects.filter(pk=build.pk).update(status="cancelled", completed_at=timezone.now())
    return "cancelled"


@shared_task(
    bind=True, autoretry_for=(ConnectionError, TimeoutError), retry_backoff=True, retry_jitter=True, max_retries=5
)
def execute_deployment(self, deployment_id):
    from .models import Deployment

    with transaction.atomic():
        deployment = (
            Deployment.objects.select_for_update()
            .select_related("version", "version__project", "version__project__owner", "build")
            .get(public_id=deployment_id)
        )
        if deployment.status in {"healthy", "stopped"}:
            return deployment.status
        starting = deployment.status == "pending"
        deployment.status = "deploying"
        deployment.celery_task_id = self.request.id or deployment.celery_task_id
        deployment.error_message = ""
        deployment.save(update_fields=["status", "celery_task_id", "error_message", "updated_at"])
    if starting:
        reset_deployment_logs(deployment, "Starting deployment process.")
    append_deployment_log(deployment, f"Dispatching {deployment.backend} deployment backend.")
    try:
        backend = deployment_backend(deployment.backend)
        backend.log_sink = lambda message: append_deployment_log(deployment, message)
        endpoint = backend.deploy(deployment)
    except Exception as exc:
        Deployment.objects.filter(pk=deployment.pk).update(status="failed", error_message=str(exc)[:12000])
        append_deployment_log(deployment, f"Deployment failed: {exc}")
        raise
    append_deployment_log(deployment, "Runtime resource created; waiting for endpoint health check.")
    if endpoint.health_status == "healthy":
        _mark_deployment_healthy(deployment)
        return "healthy"
    check_deployment_health.apply_async(args=[str(deployment.public_id)], countdown=10)
    return "deploying"


@shared_task(bind=True, max_retries=30)
def check_deployment_health(self, deployment_id):
    from .models import Deployment, Endpoint

    deployment = Deployment.objects.select_related("version", "build").get(public_id=deployment_id)
    if deployment.status in {"healthy", "failed", "stopped"}:
        return deployment.status
    healthy, metadata = deployment_backend(deployment.backend).health(deployment)
    Endpoint.objects.filter(deployment=deployment).update(
        health_status="healthy" if healthy else "unknown",
        last_checked_at=timezone.now(),
        metadata=metadata,
    )
    if healthy:
        _mark_deployment_healthy(deployment)
        return "healthy"
    if self.request.retries >= self.max_retries:
        Deployment.objects.filter(pk=deployment.pk).update(
            status="unhealthy", error_message="Endpoint health check timed out."
        )
        append_deployment_log(deployment, "Endpoint health check timed out.")
        return "unhealthy"
    append_deployment_log(deployment, "Endpoint is not healthy yet; retrying health check.")
    raise self.retry(countdown=min(10 + self.request.retries * 2, 60))


@shared_task(bind=True)
def stop_deployment(self, deployment_id):
    from .models import Deployment

    deployment = Deployment.objects.select_related("version", "build").get(public_id=deployment_id)
    deployment_backend(deployment.backend).stop(deployment)
    Deployment.objects.filter(pk=deployment.pk).update(status="stopped", stopped_at=timezone.now())
    append_deployment_log(deployment, "Deployment stopped.")
    enqueue_event(
        topic="deployment.events",
        aggregate_type="deployment",
        aggregate_id=deployment.public_id,
        event_type="deployment.changed",
        payload={"deployment_id": str(deployment.public_id), "status": "stopped"},
    )
    return "stopped"
