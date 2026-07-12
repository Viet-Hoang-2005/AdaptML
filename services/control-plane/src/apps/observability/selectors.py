from .models import EventOutbox


def pending_outbox_events(limit=100):
    return EventOutbox.objects.filter(published_at__isnull=True).order_by("created_at")[:limit]
