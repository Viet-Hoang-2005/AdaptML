from contextlib import nullcontext
import io
import logging
import runpy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pandas as pd
import pytest
from src.logging_utils import ConsoleFormatter, JsonFormatter, Summary

from src import database, drift_outbox, main


def test_persistence_and_offset_commit_are_summarized_separately(monkeypatch):
    persistence, commits = Mock(), Mock()
    engine = Mock()
    engine.begin.side_effect = lambda: nullcontext(Mock())
    monkeypatch.setattr(database, "engine_rw", engine)
    monkeypatch.setattr(database, "_save_dataframe", Mock())
    monkeypatch.setattr(database, "persistence_summary", persistence)
    monkeypatch.setattr(main, "commit_summary", commits)
    consumer = Mock()
    consumer.commit.side_effect = [RuntimeError("broker://private?token=hidden"), []]
    records = [main.KafkaRecord({"model_version_id": "v", "features": {"private": "feature-payload"}}, "events", 0, 12)]

    assert main.flush_batch(consumer, records) is False
    assert persistence.record.call_args.kwargs["records"] == 1
    assert commits.record.call_args.kwargs["success"] is False
    assert commits.failure.call_args.kwargs["offset"] == 13
    assert main.flush_batch(consumer, records) is True
    assert commits.record.call_args.kwargs["committed"] == 1
    commits.recovery.assert_called_once_with("events:0", partition=0)
    assert "hidden" not in str(commits.mock_calls)
    assert "feature-payload" not in str(persistence.mock_calls)


def test_database_rollback_reports_failure_without_counting_persisted_records(monkeypatch):
    summary = Mock()
    engine = Mock()
    engine.begin.return_value = nullcontext(Mock())
    monkeypatch.setattr(database, "engine_rw", engine)
    monkeypatch.setattr(database, "persistence_summary", summary)
    monkeypatch.setattr(database, "_save_dataframe", Mock(side_effect=RuntimeError("SQL parameters: feature-payload")))
    assert not database.save_dataframe_and_automatic_drift_signals(pd.DataFrame({"id": ["1"]}), "logs", [])
    assert summary.record.call_args.kwargs["success"] is False
    assert "records" not in summary.record.call_args.kwargs
    summary.failure.assert_called_once_with("write", "Production data and drift signal transaction failed", error_type="RuntimeError")


def test_offset_error_objects_are_not_logged(monkeypatch):
    summary = Mock()
    consumer = Mock()
    consumer.commit.return_value = [SimpleNamespace(error="hidden broker details")]
    monkeypatch.setattr(main, "commit_summary", summary)
    assert not main._commit_batch_offset(consumer, main.KafkaRecord({}, "events", 1, 7))
    summary.failure.assert_called_once_with("events:1", "Kafka offset commit returned errors", partition=1, offset=8, count=1)


def test_outbox_retries_and_recovery_use_summary_without_response_payload(monkeypatch):
    summary = Mock()
    monkeypatch.setattr(drift_outbox, "delivery_summary", summary)
    monkeypatch.setattr(drift_outbox, "claim_automatic_drift_signals", lambda *_: [{"id": 1, "attempts": 2}])
    monkeypatch.setattr(drift_outbox, "deliver", Mock(side_effect=[(False, "private response-payload"), (True, "")]))
    monkeypatch.setattr(drift_outbox, "mark_automatic_drift_signal_published", Mock())
    monkeypatch.setattr(drift_outbox, "reschedule_automatic_drift_signal", Mock())
    assert drift_outbox.drain_once() == 0
    assert drift_outbox.drain_once() == 1
    summary.failure.assert_called_once()
    assert summary.failure.call_args.kwargs["attempt"] == 2
    summary.recovery.assert_called_once_with("delivery")
    assert summary.record.call_args.kwargs["published"] == 1
    assert "response-payload" not in str(summary.mock_calls)


def test_partition_retry_logs_current_attempt(monkeypatch):
    summary = Mock()
    consumer = Mock()
    retries = {}
    monkeypatch.setattr(main, "retry_summary", summary)
    for attempt in (1, 2):
        main._schedule_retry(consumer, ("events", 3), retries)
        assert summary.failure.call_args.kwargs["attempt"] == attempt
    consumer.pause.assert_called_once()


def test_commit_retries_emit_first_error_counts_and_recovery(monkeypatch):
    output = io.StringIO()
    logger = logging.Logger("consumer-commit-test")
    handler = logging.StreamHandler(output)
    handler.setFormatter(JsonFormatter("consumer"))
    logger.addHandler(handler)
    summary = Summary(logger, "offset_commit_summary", interval=3600)
    monkeypatch.setattr(main, "commit_summary", summary)
    consumer = Mock()
    consumer.commit.side_effect = [RuntimeError("feature-payload"), RuntimeError("https://private/endpoint"), []]
    record = main.KafkaRecord({}, "events", 0, 4)
    try:
        assert not main._commit_batch_offset(consumer, record)
        assert not main._commit_batch_offset(consumer, record)
        assert main._commit_batch_offset(consumer, record)
    finally:
        summary.close()
    logs = output.getvalue()
    assert logs.count('"event":"offset_commit_summary.error"') == 1
    assert logs.count('"event":"offset_commit_summary.recovered"') == 1
    assert '"count":2' in logs
    assert '"failures":2' in logs
    assert '"committed":1' in logs
    assert '"suppressed":1' in logs
    assert "feature-payload" not in logs
    assert "https://" not in logs


def test_dispatcher_thread_failure_remains_observable_without_raw_traceback(monkeypatch, capsys):
    event = Mock()
    monkeypatch.setattr(main, "log_event", event)
    monkeypatch.setattr(main, "run_dispatcher", Mock(side_effect=RuntimeError("SQL feature-payload")))
    stop, dispatcher = main.start_outbox_dispatcher()
    dispatcher.join(timeout=2)
    assert not dispatcher.is_alive()
    event.assert_called_once_with(main.logger, "ERROR", "drift_dispatcher_failed", "Automatic drift dispatcher stopped unexpectedly", error_type="RuntimeError")
    assert "feature-payload" not in capsys.readouterr().err


def test_malformed_record_has_one_error_with_safe_traceback(monkeypatch):
    from test_consumer import FakeConsumer, FakeMessage, install_fake_dispatcher

    class MalformedMessage(FakeMessage):
        def value(self):
            return b"private-feature-payload not json"

    output = io.StringIO()
    logger = logging.Logger("consumer-malformed-test")
    handler = logging.StreamHandler(output)
    handler.setFormatter(ConsoleFormatter("consumer"))
    logger.addHandler(handler)
    monkeypatch.setattr(main, "logger", logger)
    monkeypatch.setattr(main, "configure", Mock())
    monkeypatch.setattr(main.time, "sleep", Mock())
    monkeypatch.setattr(main.signal, "signal", Mock())
    monkeypatch.setattr(main, "init_db", Mock())
    monkeypatch.setattr(main, "RUNNING", True)
    consumer = FakeConsumer([MalformedMessage()])
    monkeypatch.setattr(main, "Consumer", lambda _: consumer)
    install_fake_dispatcher(monkeypatch)
    with pytest.raises(SystemExit) as exc:
        main.run()
    assert exc.value.code == 1
    lines = output.getvalue().splitlines()
    errors = [line for line in lines if "[ERROR]:" in line]
    assert len(errors) == 1
    assert "Consumer stopped after an unrecoverable error" in errors[0]
    assert "traceback:" in errors[0]
    assert "main.py:" in errors[0]
    assert any("[DEBUG]:" in line and "Kafka record processing failed" in line for line in lines)
    assert "private-feature-payload" not in output.getvalue()
    assert consumer.closed
    assert consumer.commits == 0


def test_script_configures_logging_before_database_import(monkeypatch):
    import builtins
    from src import logging_utils

    class Configured(Exception):
        pass

    imported = []
    original_import = builtins.__import__

    def observe_import(name, *args, **kwargs):
        imported.append(name)
        return original_import(name, *args, **kwargs)

    configure = Mock(side_effect=Configured)
    monkeypatch.setattr(logging_utils, "configure", configure)
    monkeypatch.setattr(builtins, "__import__", observe_import)
    with pytest.raises(Configured):
        runpy.run_path(str(Path(main.__file__)), run_name="__main__")
    configure.assert_called_once_with("consumer")
    assert "src.database" not in imported
