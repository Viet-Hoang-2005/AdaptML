# Backend logging contract

Application-owned operational logs use single-line `key=value` (logfmt) on stdout
in Docker and K3s. Each service owns a standard-library-only
`src/logging_utils.py` (`src/common/logging_utils.py` in Control Plane) for
formatting, redaction and context. Only services that need them include bounded
summaries, ASGI middleware or runtime-log routing. There is no shared Python
package, symlink or cross-service import. Format compatibility is maintained by
this contract and regression tests in each service; implementations may evolve
independently.
Database, broker, registry, MLflow server, Kaniko and operator internals are not
rewritten. No new collector, storage or cluster permission is required.
Local Control Plane keeps Daphne, with access output disabled via verbosity 0;
Django installs its service-owned operational handler. Production keeps Gunicorn.
Gateway and ML-serving launch `python -m src.uvicorn_entrypoint`; spawned Uvicorn
workers install the local formatter before startup, not only at lifespan. BentoML
uses local middleware and formatting; successful access logs remain disabled.

```text
ts=2026-09-14T08:30:00.123Z level=INFO service=evidently event=drift.analysis.completed instance=pod-name pid=1 drift_run_id=... duration_ms=1250 msg="Drift analysis completed"
```

## Defaults and event ownership

- `LOG_LEVEL=INFO`; set `DEBUG` temporarily on the affected service/job for internal
  steps. Do not enable globally to debug one job.
- `LOG_SUMMARY_INTERVAL_SECONDS=60`. Summaries are per process, with `instance` and
  `pid`; empty windows are silent and normal shutdown flushes outstanding counts.
  They are best-effort diagnostics, not a replacement for Prometheus or audit data.
- UTC timestamps; English messages; stable event names. Quote and escape strings;
  bounded messages and stack locations keep each event on one physical line.
- Context uses distinct public resource IDs. HTTP request IDs are validated;
  Celery propagates bounded context, never task arguments or results.
- Lifecycle start/dispatch/terminal events belong to Control Plane boundaries.
  Emit terminal state only after its database transaction commits. Worker-local
  completion is not authoritative business completion; callback replay must not
  emit a second transition. Abrupt SIGKILL/OOM cannot promise a final application
  log; diagnose those using existing runtime/controller status.
- HTTP successes, production ingestion and event delivery are summarized, not
  printed per record. Successful probes/scrapes are silent. First dependency/error
  occurrence is immediate, repeats are counted, recovery is explicit. Flapping
  failure/recovery messages share the same 60-second cooldown; they cannot bypass
  suppression by alternating on each request.
- Keep persistence and offset commits distinct. Do not describe an enqueued Kafka
  event as acknowledged delivery, or an Argo dispatch as a completed job.
- Expected client rejection is not an unexpected server exception. A successful
  drift analysis can detect drift; detection itself is not an execution ERROR.

## Runtime logs and compatibility

System code calls `log_event` for operational events. Detailed subprocess output
uses `RuntimeLog.detail`, which sends sanitized lines to the existing per-job sink;
container output is DEBUG when that write succeeds, otherwise INFO fallback.
This preserves a debug path during Redis outages and for production training,
which intentionally has **no shared Redis credentials**. The production job-log
pipeline remains a separate follow-up. Third-party subprocess/container output
can therefore remain verbose; it is not silently discarded.

Runtime-log API shapes, resource-specific Redis keys, cursors and marker protocols
remain unchanged. `METRIC_JSON:` input from tenant training scripts is parsed before
presentation sanitization. System `METRIC_JSON ` output and `BUILD_EOF_*` markers
remain protocol records, not lifecycle authority. Never derive trusted success or
failure from a tenant log line or from the mere presence of stderr.
Displayed metric JSON is reserialized after redaction, retaining numeric metric
types; invalid or oversized records use a diagnostic placeholder, not broken JSON.

## Security and safe usage

Log operation names, resource IDs, counts, status codes and exception types. Never
pass feature/prediction values, request/response bodies, SQL parameters, environment
dumps, credentials or presigned URLs to logging. Redaction is defence in depth,
not a guarantee that arbitrary tenant-generated personal data can be recognized.
Known secret environment values, credential assignments, authorization, URL
paths/query/userinfo and common SQL parameter dumps are masked. Tracebacks contain
bounded stack locations, not source lines or locals. Detail sinks use the same
sanitizer; streamed PEM private keys are masked across lines within each input
thread. This does not rewrite historical logs already in Redis/PostgreSQL.

## Development and verification

Install only the target service's requirements. Images build from
`services/<service>` with that service's `.dockerignore` and Dockerfile. Never add
another service to `PYTHONPATH`. CI/CD use `matrix.target.context` and explicit
Dockerfile paths; a service's code or `.dockerignore` selects only that service.
Workflow changes and shared test-requirements changes retain their existing CI
rules (the latter affects tests, not unrelated image builds).
The offline `.github/tests/test_backend_packaging.py` checks matrix selection,
local utility ownership, COPY instructions and ignore rules in CI's detection step.
It requires only Python's standard library.

```bash
cd services/model-server
python -m pytest tests --cov=src --cov-fail-under=70
PYTHONPATH=.:tests python tests/asgi_smoke.py
cd ../..
python3 -m unittest discover -s .github/tests -p 'test_*.py'
docker build -f services/model-server/Dockerfile -t mlops-paas-model-server services/model-server
docker compose config --quiet
kubectl kustomize k8s/apps/overlays/production/control-plane
```

Use the isolated service pytest suites as well. Validate success/failure, replay,
context isolation, noise suppression, redaction and Redis fallback before image
promotion. Rollback uses the prior image/config Git commit, with no database
migration. Do not apply manifests or restart a production service merely to test
log formatting.
