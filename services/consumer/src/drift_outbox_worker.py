"""Deliver durable automatic-drift signals to the Control Plane."""

import os
import signal
import time

import requests

from src.database import (
    claim_automatic_drift_signals,
    init_db,
    mark_automatic_drift_signal_published,
    reschedule_automatic_drift_signal,
)


CONTROL_PLANE_WEBHOOK_URL = os.environ.get("CONTROL_PLANE_WEBHOOK_URL", "").strip()
WEBHOOK_SECRET = os.environ.get("CONTROL_PLANE_WEBHOOK_SECRET", "")
OUTBOX_POLL_SECONDS = max(1, int(os.environ.get("AUTOMATIC_DRIFT_OUTBOX_POLL_SECONDS", "5")))
OUTBOX_BATCH_SIZE = max(1, int(os.environ.get("AUTOMATIC_DRIFT_OUTBOX_BATCH_SIZE", "50")))
OUTBOX_LEASE_SECONDS = max(OUTBOX_POLL_SECONDS, int(os.environ.get("AUTOMATIC_DRIFT_OUTBOX_LEASE_SECONDS", "60")))
OUTBOX_RETRY_INITIAL_SECONDS = max(
    1, int(os.environ.get("AUTOMATIC_DRIFT_OUTBOX_RETRY_INITIAL_SECONDS", "5"))
)
OUTBOX_RETRY_MAX_SECONDS = max(
    OUTBOX_RETRY_INITIAL_SECONDS,
    int(os.environ.get("AUTOMATIC_DRIFT_OUTBOX_RETRY_MAX_SECONDS", "300")),
)
REQUEST_TIMEOUT_SECONDS = max(
    1, int(os.environ.get("AUTOMATIC_DRIFT_OUTBOX_REQUEST_TIMEOUT_SECONDS", "10"))
)

RUNNING = True


def handle_sigterm(*_args):
    global RUNNING
    RUNNING = False


def retry_delay(attempts: int) -> int:
    return min(
        OUTBOX_RETRY_INITIAL_SECONDS * (2 ** max(0, attempts - 1)),
        OUTBOX_RETRY_MAX_SECONDS,
    )


def deliver(signal: dict) -> tuple[bool, str]:
    """Send one idempotent signal without exposing response payloads in logs."""
    if not CONTROL_PLANE_WEBHOOK_URL:
        return False, "CONTROL_PLANE_WEBHOOK_URL is not configured"
    if not WEBHOOK_SECRET:
        return False, "CONTROL_PLANE_WEBHOOK_SECRET is not configured"

    try:
        response = requests.post(
            CONTROL_PLANE_WEBHOOK_URL,
            headers={
                "Authorization": f"Bearer {WEBHOOK_SECRET}",
                "Content-Type": "application/json",
                "Idempotency-Key": signal["idempotency_key"],
            },
            json={"model_version_id": signal["model_version_id"]},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        return False, f"request failed: {exc.__class__.__name__}"

    if 200 <= response.status_code < 300:
        return True, ""
    return False, f"control-plane returned HTTP {response.status_code}"


def drain_once() -> int:
    delivered = 0
    for event in claim_automatic_drift_signals(OUTBOX_BATCH_SIZE, OUTBOX_LEASE_SECONDS):
        success, error = deliver(event)
        if success:
            mark_automatic_drift_signal_published(event["id"])
            delivered += 1
            continue

        delay = retry_delay(event["attempts"])
        reschedule_automatic_drift_signal(event["id"], event["attempts"], error, delay)
        print(
            f"Automatic drift signal {event['id']} was not delivered; "
            f"retrying in {delay}s ({error})."
        )
    return delivered


def main():
    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)
    init_db()
    print("Automatic drift outbox worker started.")
    while RUNNING:
        delivered = drain_once()
        if delivered:
            print(f"Delivered {delivered} automatic drift signal(s).")
            continue
        time.sleep(OUTBOX_POLL_SECONDS)


if __name__ == "__main__":
    main()
