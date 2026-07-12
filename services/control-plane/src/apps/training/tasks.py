from celery import shared_task
from django.db import transaction
from infrastructure.execution import training_backend


@shared_task(
    bind=True, autoretry_for=(ConnectionError, TimeoutError), retry_backoff=True, retry_jitter=True, max_retries=5
)
def execute_training_job(self, job_id):
    from .models import TrainingJob, TrainingJobEvent

    with transaction.atomic():
        job = TrainingJob.objects.select_for_update().select_related("project", "project__owner").get(public_id=job_id)
        if job.status in {"completed", "cancelled"}:
            return job.status
        job.mark_started()
        job.celery_task_id = self.request.id or job.celery_task_id
        job.error_message = ""
        job.save(update_fields=["status", "started_at", "celery_task_id", "error_message", "updated_at"])
        TrainingJobEvent.objects.create(job=job, event_type="started", message="Training execution started.")
    try:
        result = training_backend(job.backend).run(job)
    except Exception as exc:
        with transaction.atomic():
            job = TrainingJob.objects.select_for_update().get(pk=job.pk)
            job.mark_finished("failed")
            job.error_message = str(exc)[:12000]
            job.save(update_fields=["status", "completed_at", "runtime_seconds", "error_message", "updated_at"])
            TrainingJobEvent.objects.create(
                job=job, event_type="failed", message="Training execution failed.", metadata={"error": str(exc)[:1000]}
            )
        raise
    if isinstance(result, dict) and result.get("dispatched"):
        return "running"
    with transaction.atomic():
        job = TrainingJob.objects.select_for_update().get(pk=job.pk)
        job.mark_finished("completed")
        job.tracking = {**job.tracking, "logs_tail": str(result)[-6000:]}
        job.save(update_fields=["status", "completed_at", "runtime_seconds", "tracking", "updated_at"])
        TrainingJobEvent.objects.create(job=job, event_type="completed", message="Training execution completed.")
    return "completed"


@shared_task(bind=True)
def cancel_training_job(self, job_id):
    from .models import TrainingJob, TrainingJobEvent

    job = TrainingJob.objects.select_related("project", "project__owner").get(public_id=job_id)
    training_backend(job.backend).cancel(job)
    job.mark_finished("cancelled")
    job.save(update_fields=["status", "completed_at", "runtime_seconds", "updated_at"])
    TrainingJobEvent.objects.create(job=job, event_type="cancelled", message="Training execution cancelled.")
    return "cancelled"
