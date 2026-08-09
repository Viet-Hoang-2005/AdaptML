from types import SimpleNamespace
from unittest.mock import Mock

from src import drift_outbox_worker as worker


def test_deliver_posts_internal_idempotent_signal(monkeypatch):
    monkeypatch.setattr(
        worker,
        "CONTROL_PLANE_AUTOMATIC_DRIFT_WEBHOOK_URL",
        "http://control-plane/internal/webhooks/automatic-drift/",
    )
    monkeypatch.setattr(worker, "WEBHOOK_SECRET", "secret")
    post = Mock(return_value=SimpleNamespace(status_code=202))
    monkeypatch.setattr(worker.requests, "post", post)

    assert worker.deliver({"model_version_id": "version-1", "idempotency_key": "signal-1"}) == (True, "")
    post.assert_called_once_with(
        "http://control-plane/internal/webhooks/automatic-drift/",
        headers={
            "Authorization": "Bearer secret",
            "Content-Type": "application/json",
            "Idempotency-Key": "signal-1",
        },
        json={"model_version_id": "version-1"},
        timeout=worker.REQUEST_TIMEOUT_SECONDS,
    )


def test_deliver_rejects_missing_configuration(monkeypatch):
    monkeypatch.setattr(worker, "CONTROL_PLANE_AUTOMATIC_DRIFT_WEBHOOK_URL", "")
    assert worker.deliver({"model_version_id": "version-1", "idempotency_key": "signal-1"}) == (
        False,
        "CONTROL_PLANE_AUTOMATIC_DRIFT_WEBHOOK_URL is not configured",
    )


def test_drain_marks_only_successful_signal_published(monkeypatch):
    signals = [
        {"id": 1, "model_version_id": "version-1", "idempotency_key": "signal-1", "attempts": 1},
        {"id": 2, "model_version_id": "version-2", "idempotency_key": "signal-2", "attempts": 2},
    ]
    monkeypatch.setattr(worker, "claim_automatic_drift_signals", lambda *_args: signals)
    monkeypatch.setattr(worker, "deliver", Mock(side_effect=[(True, ""), (False, "control plane unavailable")]))
    published = Mock()
    reschedule = Mock()
    monkeypatch.setattr(worker, "mark_automatic_drift_signal_published", published)
    monkeypatch.setattr(worker, "reschedule_automatic_drift_signal", reschedule)
    monkeypatch.setattr(worker, "retry_delay", lambda attempts: attempts * 10)

    assert worker.drain_once() == 1
    published.assert_called_once_with(1)
    reschedule.assert_called_once_with(2, 2, "control plane unavailable", 20)


def test_retry_delay_is_bounded(monkeypatch):
    monkeypatch.setattr(worker, "OUTBOX_RETRY_INITIAL_SECONDS", 5)
    monkeypatch.setattr(worker, "OUTBOX_RETRY_MAX_SECONDS", 30)
    assert worker.retry_delay(1) == 5
    assert worker.retry_delay(4) == 30
