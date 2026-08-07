import json
import pandas as pd
import pytest

from types import SimpleNamespace
from unittest.mock import Mock
from src import main


class FakeMessage:
    def __init__(self, payload=None, error=None, topic="events", partition=0, offset=0):
        self._payload = payload
        self._error = error
        self._topic = topic
        self._partition = partition
        self._offset = offset

    def value(self):
        return json.dumps(self._payload).encode()

    def error(self):
        return self._error

    def topic(self):
        return self._topic

    def partition(self):
        return self._partition

    def offset(self):
        return self._offset


class FakeConsumer:
    def __init__(self, messages):
        self.messages = list(messages)
        self.commits = 0
        self.commit_offsets = []
        self.commit_exception = None
        self.closed = False
        self.topics = None
        self.paused = []
        self.resumed = []

    def subscribe(self, topics):
        self.topics = topics

    def poll(self, timeout):
        if self.messages:
            return self.messages.pop(0)
        main.RUNNING = False
        return None

    def commit(self, offsets=None, asynchronous=True):
        if self.commit_exception:
            raise self.commit_exception
        self.commits += 1
        self.commit_offsets.append((offsets, asynchronous))
        return offsets

    def pause(self, partitions):
        self.paused.extend(partitions)

    def resume(self, partitions):
        self.resumed.extend(partitions)

    def close(self):
        self.closed = True


def record(payload=None, topic="events", partition=0, offset=0):
    return main.KafkaRecord(payload or {"model_version_id": "m"}, topic, partition, offset)


def test_build_batch_dataframe_converts_dates_to_utc():
    df = main.build_batch_dataframe([record({
        "timestamp": "2026-01-01T00:00:00Z", "created_at": "bad", "value": 1
    })])
    assert str(df["timestamp"].dtype) == "datetime64[ns, UTC]"
    assert pd.isna(df.loc[0, "created_at"])


def test_check_threshold_ignores_invalid_batches(monkeypatch):
    state = {"m": 10}
    assert main.check_threshold_and_trigger(state, None) is state
    assert main.check_threshold_and_trigger(state, pd.DataFrame()) is state
    assert main.check_threshold_and_trigger(state, pd.DataFrame({"x": [1]})) is state


def test_check_threshold_triggers_models_independently(monkeypatch):
    monkeypatch.setattr(main, "get_model_drift_thresholds", lambda: {"a": 5, "b": 10})
    monkeypatch.setattr(
        main,
        "get_production_data_count_by_model_version",
        lambda version_id: {"a": 8, "b": 9}[version_id],
    )
    trigger = Mock()
    monkeypatch.setattr(main, "trigger_django_webhook", trigger)

    state = main.check_threshold_and_trigger(
        {"a": 2}, pd.DataFrame({"model_version_id": ["a", "b", None]})
    )

    assert state == {"a": 8}
    trigger.assert_called_once_with("a", 8)


def test_trigger_webhook_disabled(monkeypatch):
    monkeypatch.setattr(main, "CONTROL_PLANE_WEBHOOK_URL", "")
    post = Mock()
    monkeypatch.setattr(main.requests, "post", post)
    main.trigger_django_webhook("m", 3)
    post.assert_not_called()


def test_trigger_webhook_sends_bearer_payload(monkeypatch):
    monkeypatch.setattr(main, "CONTROL_PLANE_WEBHOOK_URL", "http://control/run")
    monkeypatch.setattr(main, "WEBHOOK_SECRET", "secret")
    post = Mock(return_value=SimpleNamespace(status_code=204, text=""))
    monkeypatch.setattr(main.requests, "post", post)
    main.trigger_django_webhook("model", 12)
    post.assert_called_once_with(
        "http://control/run",
        headers={"Authorization": "Bearer secret", "Content-Type": "application/json"},
        json={
            "event_type": "trigger_drift_check",
            "model_version_id": "model",
            "current_data_count": 12,
        },
        timeout=10,
    )


def test_trigger_webhook_non_success_and_exception_are_nonfatal(monkeypatch, capsys):
    monkeypatch.setattr(main, "CONTROL_PLANE_WEBHOOK_URL", "http://control/run")
    monkeypatch.setattr(main.requests, "post", Mock(return_value=SimpleNamespace(status_code=500, text="no")))
    main.trigger_django_webhook("m", 1)
    assert "Webhook failed" in capsys.readouterr().out
    monkeypatch.setattr(main.requests, "post", Mock(side_effect=RuntimeError("down")))
    main.trigger_django_webhook("m", 1)
    assert "Error sending webhook" in capsys.readouterr().out


def test_flush_batch_commits_only_after_success(monkeypatch):
    consumer = FakeConsumer([])
    monkeypatch.setattr(main, "save_dataframe_to_db", Mock(return_value=False))
    saved, state = main.flush_batch(consumer, [record(offset=41)], {})
    assert not saved and state == {} and consumer.commits == 0

    monkeypatch.setattr(main, "save_dataframe_to_db", Mock(return_value=True))
    monkeypatch.setattr(main, "check_threshold_and_trigger", lambda state, df: {"m": len(df)})
    saved, state = main.flush_batch(consumer, [record(offset=41)], {})
    assert saved and state == {"m": 1} and consumer.commits == 1
    offsets, asynchronous = consumer.commit_offsets[0]
    assert asynchronous is False
    assert offsets[0].topic == "events"
    assert offsets[0].partition == 0
    assert offsets[0].offset == 42


def test_flush_empty_batch_is_noop():
    consumer = FakeConsumer([])
    state = {"m": 1}
    assert main.flush_batch(consumer, [], state) == (True, state)
    assert consumer.commits == 0


def test_flush_batch_rejects_mixed_partitions(monkeypatch):
    consumer = FakeConsumer([])
    monkeypatch.setattr(main, "save_dataframe_to_db", Mock(return_value=True))
    with pytest.raises(ValueError, match="exactly one partition"):
        main.flush_batch(consumer, [record(partition=0), record(partition=1)], {})


def test_failed_partition_batch_is_retained_paused_and_retried(monkeypatch):
    consumer = FakeConsumer([])
    key = ("events", 0)
    pending = {key: [record(offset=7)]}
    retries = {}
    monkeypatch.setattr(main, "save_dataframe_to_db", Mock(side_effect=[False, True]))
    monkeypatch.setattr(main, "check_threshold_and_trigger", lambda state, df: state)

    saved, state = main.flush_pending_batch(consumer, pending, retries, key, {})
    assert not saved and key in pending and key in retries
    assert consumer.commits == 0
    assert [(item.topic, item.partition) for item in consumer.paused] == [key]

    saved, state = main.flush_pending_batch(consumer, pending, retries, key, state)
    assert saved and key not in pending and key not in retries
    assert consumer.commits == 1
    assert [(item.topic, item.partition) for item in consumer.resumed] == [key]
    assert consumer.commit_offsets[0][0][0].offset == 8


def test_commit_failure_retains_batch_for_idempotent_retry(monkeypatch):
    consumer = FakeConsumer([])
    consumer.commit_exception = RuntimeError("broker unavailable")
    key = ("events", 0)
    pending = {key: [record(offset=12)]}
    retries = {}
    trigger = Mock()
    monkeypatch.setattr(main, "save_dataframe_to_db", Mock(return_value=True))
    monkeypatch.setattr(main, "check_threshold_and_trigger", trigger)

    saved, _ = main.flush_pending_batch(consumer, pending, retries, key, {})
    assert not saved and key in pending and key in retries
    trigger.assert_not_called()


def test_main_flushes_valid_message_and_closes(monkeypatch):
    fake = FakeConsumer(
        [FakeMessage({"id": "1", "model_version_id": "m", "timestamp": "2026-01-01"}), None]
    )
    monkeypatch.setattr(main, "Consumer", lambda conf: fake)
    monkeypatch.setattr(main.signal, "signal", lambda *args: None)
    monkeypatch.setattr(main, "init_db", Mock())
    monkeypatch.setattr(main, "save_dataframe_to_db", Mock(return_value=True))
    monkeypatch.setattr(main, "check_threshold_and_trigger", lambda state, df: state)
    main.RUNNING = True
    main.main()
    assert fake.topics == [main.KAFKA_TOPIC]
    assert fake.commits == 1
    assert fake.commit_offsets[0][0][0].offset == 1
    assert fake.closed


def test_main_disables_automatic_offset_storage(monkeypatch):
    fake = FakeConsumer([])
    captured_conf = {}

    def create_consumer(conf):
        captured_conf.update(conf)
        return fake

    monkeypatch.setattr(main, "Consumer", create_consumer)
    monkeypatch.setattr(main.signal, "signal", lambda *args: None)
    monkeypatch.setattr(main, "init_db", Mock())
    main.RUNNING = True
    main.main()

    assert captured_conf["enable.auto.commit"] is False
    assert captured_conf["enable.auto.offset.store"] is False


def test_main_ignores_malformed_message(monkeypatch):
    bad = FakeMessage()
    bad.value = lambda: b"not-json"
    fake = FakeConsumer([bad])
    monkeypatch.setattr(main, "Consumer", lambda conf: fake)
    monkeypatch.setattr(main.signal, "signal", lambda *args: None)
    monkeypatch.setattr(main, "init_db", Mock())
    main.RUNNING = True
    with pytest.raises(RuntimeError, match="Error parsing Kafka payload"):
        main.main()
    assert fake.commits == 0 and fake.closed


def test_handle_sigterm_stops_loop():
    main.RUNNING = True
    main.handle_sigterm()
    assert main.RUNNING is False
