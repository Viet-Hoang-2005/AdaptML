from django.conf import settings
from django.db.models import Count, Q, Sum
from django.utils import timezone

from authentication.models import TrainingJob

ACTIVE_STATUSES = {"pending", "uploading", "running"}

def _current_month_window():
    now = timezone.now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if month_start.month == 12:
        month_end = month_start.replace(year=month_start.year + 1, month=1)
    else:
        month_end = month_start.replace(month=month_start.month + 1)
    return month_start, month_end


def _training_usage_for_user(user):
    month_start, month_end = _current_month_window()
    jobs = TrainingJob.objects.filter(
        tenant=user,
        created_at__gte=month_start,
        created_at__lt=month_end,
        deleted_at__isnull=True,
    )
    stored_runtime = jobs.aggregate(total=Sum("runtime_seconds"))["total"] or 0
    running_runtime = 0
    now = timezone.now()
    for job in jobs.filter(status="running"):
        if job.started_at:
            running_runtime += max(int((now - job.started_at).total_seconds()), 0)

    monthly_runtime_seconds = stored_runtime + running_runtime
    monthly_quota_seconds = settings.TRAINING_MONTHLY_QUOTA_SECONDS
    counts = jobs.aggregate(
        active_jobs_count=Count("id", filter=Q(status__in=ACTIVE_STATUSES)),
        running_jobs_count=Count("id", filter=Q(status="running")),
        completed_jobs_count=Count("id", filter=Q(status="completed")),
        failed_jobs_count=Count("id", filter=Q(status="failed")),
    )

    return {
        "training_backend": settings.TRAINING_BACKEND,
        "monthly_quota_seconds": monthly_quota_seconds,
        "monthly_runtime_seconds": monthly_runtime_seconds,
        "remaining_seconds": max(monthly_quota_seconds - monthly_runtime_seconds, 0),
        "active_jobs_count": counts["active_jobs_count"],
        "running_jobs_count": counts["running_jobs_count"],
        "completed_jobs_count": counts["completed_jobs_count"],
        "failed_jobs_count": counts["failed_jobs_count"],
        "current_month_start": month_start,
        "current_month_end": month_end,
    }


