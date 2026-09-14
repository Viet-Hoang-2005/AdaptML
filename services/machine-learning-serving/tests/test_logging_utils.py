"""Regression checks for the service-owned logging contract."""

import asyncio
import io
import json
import logging
import os
import threading
import time
import unittest
from unittest.mock import patch

from src.logging_utils import (
    LogfmtFormatter,
    RequestLoggingMiddleware,
    Summary,
    bind_context,
    configure,
    current_context,
    log_event,
    request_id,
    reset_context,
    sanitize,
)


class LoggingTests(unittest.TestCase):
    def test_entrypoint_uses_local_worker_configuration(self):
        from src.uvicorn_entrypoint import main

        with patch(
            "sys.argv",
            [
                "uvicorn_entrypoint",
                "src.index:app",
                "--service",
                "machine-learning-serving",
                "--port",
                "8050",
                "--workers",
                "2",
            ],
        ), patch("uvicorn.run") as run:
            main()
        self.assertEqual(run.call_args.args, ("src.index:app",))
        self.assertEqual(run.call_args.kwargs["workers"], 2)
        self.assertFalse(run.call_args.kwargs["access_log"])
        self.assertEqual(
            run.call_args.kwargs["log_config"]["handlers"]["console"]["class"],
            "src.logging_utils.SafeStreamHandler",
        )

    def setUp(self):
        self.output = io.StringIO()
        self.logger = logging.Logger("test", logging.DEBUG)
        handler = logging.StreamHandler(self.output)
        handler.setFormatter(LogfmtFormatter("test"))
        self.logger.addHandler(handler)

    def test_format_context_escaping_and_allowlist(self):
        token = bind_context(request_id="req-1", features="must-not-appear")
        try:
            log_event(
                self.logger,
                "INFO",
                "job.completed",
                'Đã xong\nnext="value"\x00',
                duration_ms=12,
                features={"secret-data": 1},
            )
        finally:
            reset_context(token)
        line = self.output.getvalue()
        self.assertEqual(len(line.splitlines()), 1)
        for part in (
            "ts=",
            "Z level=INFO",
            "service=test",
            "event=job.completed",
            "request_id=req-1",
            "duration_ms=12",
            "\\n",
            "\\u0000",
        ):
            self.assertIn(part, line)
        self.assertNotIn("features", line)
        self.assertEqual(current_context(), {})

    def test_credentials_and_payloads_are_redacted(self):
        fake = "test-" + "credential-123"
        with patch.dict(os.environ, {"TEST_SECRET": fake}):
            examples = [
                (f"failed {fake}", fake),
                ("Authorization: Bearer abc.def.ghi", "abc.def.ghi"),
                ('{"password": "unsafe-value"}', "unsafe-value"),
                ("redis://user:unsafe-value@cache:6379/1", "unsafe-value"),
                (
                    "https://storage.test/path?X-Amz-Signature=unsafe-value",
                    "unsafe-value",
                ),
                ('request [parameters: {"features": "unsafe-value"}]', "unsafe-value"),
            ]
            for source, hidden in examples:
                with self.subTest(source=source):
                    self.assertNotIn(hidden, sanitize(source))
        self.assertTrue(sanitize("x" * 5000).endswith("[truncated]"))

    def test_escaped_credential_quotes_do_not_leak_suffix(self):
        for value in (
            '{"password":"first\\"private-suffix"}',
            "password='first\\'private-suffix'",
        ):
            self.assertNotIn("private-suffix", sanitize(value))

    def test_protocol_camelcase_secrets_keys_and_newlines(self):
        raw = ' \nMETRIC_JSON \n{"apiToken":"private-value","tokens_per_second":3,"https://storage.test/?token=private-key":1}'
        safe = sanitize(raw, limit=65536)
        self.assertEqual(len(safe.splitlines()), 1)
        self.assertTrue(safe.startswith("METRIC_JSON "))
        self.assertNotIn("private-value", safe)
        self.assertNotIn("private-key", safe)
        self.assertEqual(json.loads(safe.split(" ", 1)[1])["tokens_per_second"], 3)

    def test_long_nonmatching_input_is_not_quadratic(self):
        started = time.monotonic()
        sanitize("x" * 100000)
        self.assertLess(time.monotonic() - started, 2.0)

    def test_overflow_does_not_hide_server_errors_behind_warnings(self):
        summary = Summary(self.logger, "overflow", interval=60)
        try:
            for n in range(65):
                summary.failure(f"client-{n}", "Client rejected")
            summary.failure("new-server", "Server failed", level="ERROR")
            self.assertIn("error_key=other.ERROR", self.output.getvalue())
            before = self.output.getvalue().count("error_key=other.ERROR")
            with patch(
                "src.logging_utils.time.monotonic", return_value=time.monotonic() + 120
            ):
                summary.failure("another-server", "Server failed", level="ERROR")
            self.assertEqual(
                self.output.getvalue().count("error_key=other.ERROR"), before + 1
            )
            self.assertLessEqual(len(summary.last_error), 66)
        finally:
            summary.close()

    def test_flapping_is_bounded_within_a_window(self):
        summary = Summary(self.logger, "flapping", interval=3600)
        for _ in range(1000):
            summary.failure("database", "Database unavailable")
            summary.recovery("database")
        self.assertEqual(len(self.output.getvalue().splitlines()), 2)
        summary.close()
        self.assertIn("error_count=1000", self.output.getvalue())
        self.assertIn("suppressed=999", self.output.getvalue())

    def test_summary_multithread_counts(self):
        summary = Summary(self.logger, "parallel", interval=3600)

        def run():
            for _ in range(100):
                summary.record(records=1)

        threads = [threading.Thread(target=run) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        summary.close()
        self.assertIn("records=400", self.output.getvalue())

    def test_uvicorn_configuration_uses_local_handler(self):
        from src.uvicorn_entrypoint import server_log_config

        config = server_log_config("model-server")
        self.assertEqual(
            config["handlers"]["console"]["class"],
            "src.logging_utils.SafeStreamHandler",
        )
        self.assertEqual(config["formatters"]["logfmt"]["service"], "model-server")
        self.assertFalse(config["loggers"]["uvicorn.access"]["propagate"])

    def test_traceback_contains_locations_not_source_or_locals(self):
        try:
            raise ValueError("private-payload")
        except ValueError:
            log_event(self.logger, "ERROR", "job.failed", "Job failed", exc_info=True)
        value = self.output.getvalue()
        self.assertIn("error_type=ValueError", value)
        self.assertIn("traceback=", value)
        self.assertNotIn("private-payload", value)
        self.assertEqual(len(value.splitlines()), 1)

    def test_summary_empty_success_failure_recovery_and_close(self):
        summary = Summary(self.logger, "ingestion.summary", interval=3600)
        summary.flush()
        self.assertEqual(self.output.getvalue(), "")
        for _ in range(1000):
            summary.record(records=2, duration_ms=1)
        self.assertEqual(self.output.getvalue(), "")
        summary.failure("database", "Database unavailable")
        for _ in range(9):
            summary.failure("database", "Database unavailable")
        self.assertEqual(len(self.output.getvalue().splitlines()), 1)
        summary.flush()
        self.assertIn("records=2000", self.output.getvalue())
        self.assertIn("successes=1000", self.output.getvalue())
        self.assertIn("suppressed=9", self.output.getvalue())
        summary.recovery("database")
        summary.recovery("database")
        self.assertEqual(
            self.output.getvalue().count("event=ingestion.summary.recovered"), 1
        )
        summary.close()
        summary.close()

    def test_summary_bounded_error_keys_and_fork_reset(self):
        summary = Summary(self.logger, "summary", interval=3600)
        for n in range(100):
            summary.failure(str(n), "Unavailable")
        self.assertLessEqual(len(summary.errors), 65)
        summary.close()
        summary._reset()
        self.assertEqual(dict(summary.counts), {})
        self.assertIsNone(summary.thread)
        summary.close()

    def test_configuration_is_idempotent_and_bad_level_falls_back(self):
        root = logging.getLogger()
        previous, level = root.handlers[:], root.level
        try:
            with patch("sys.stdout", self.output):
                configure("test", "invalid")
                configure("test", "invalid")
                log_event(logging.getLogger("test"), "INFO", "service.ready", "Ready")
            self.assertEqual(root.level, logging.INFO)
            self.assertEqual(len(root.handlers), 1)
            self.assertEqual(self.output.getvalue().count("event=service.ready"), 1)
        finally:
            root.handlers[:], root.level = previous, level

    def test_request_id_is_bounded_and_cannot_inject(self):
        self.assertEqual(request_id("request-1"), "request-1")
        self.assertNotIn("\n", request_id("a\nevent=fake"))
        self.assertEqual(len(request_id("x" * 500)), 36)

    def test_async_context_isolation_and_exception_reset(self):
        async def worker(value):
            token = bind_context(request_id=value)
            try:
                await asyncio.sleep(0)
                self.assertEqual(current_context()["request_id"], value)
            finally:
                reset_context(token)

        async def run():
            await asyncio.gather(worker("a"), worker("b"))

        asyncio.run(run())
        self.assertEqual(current_context(), {})

    def test_asgi_probe_suppression_and_error_context(self):
        async def app(scope, receive, send):
            self.assertIn("request_id", current_context())
            await send(
                {"type": "http.response.start", "status": scope.get("test_status", 200)}
            )
            await send({"type": "http.response.body", "body": b""})

        async def noop(*args):
            pass

        middleware = RequestLoggingMiddleware(app)
        middleware.summary.logger = self.logger

        async def run():
            await middleware({"type": "http", "path": "/health"}, noop, noop)
            self.assertFalse(middleware.summary.counts)
            await middleware(
                {"type": "http", "path": "/health", "test_status": 500}, noop, noop
            )
            await middleware({"type": "http", "path": "/predict"}, noop, noop)

        asyncio.run(run())
        middleware.summary.close()
        self.assertIn("status_code=500", self.output.getvalue())
        self.assertIn("request_id=", self.output.getvalue())
        self.assertEqual(current_context(), {})
