# ADR 003: Celery Owns Background Execution

Status: Accepted

HTTP workers do not create threads or wait for long-running work. Services write
state and enqueue Celery tasks with `transaction.on_commit`. Redis is the broker
and result backend. Tasks invoke Docker locally or Argo in production, store task
IDs, use timeouts and retries, and accept idempotent callbacks.
