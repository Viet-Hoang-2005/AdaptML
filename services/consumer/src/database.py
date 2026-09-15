"""Database helpers for consumer services."""

import os
import json
import time
from urllib.parse import quote_plus

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.pool import QueuePool
from sqlalchemy.dialects.postgresql import JSONB
from src.logging_utils import Summary, get_logger, log_event

logger = get_logger(__name__)
persistence_summary = Summary(logger, "production_persistence_summary")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, '.env'))

DB_USER = os.environ.get("DB_USER")
DB_PASSWORD = os.environ.get("DB_PASSWORD")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "mlops_paas_db")

DB_HOST_RW = os.environ.get("DB_HOST_RW", "postgres")
DB_HOST_RO = os.environ.get("DB_HOST_RO", "postgres")

AUTOMATIC_DRIFT_OUTBOX_TABLE = "paas_automatic_drift_outbox"
INFERENCE_EVENTS_TABLE = "mlops_inference_events"
PRODUCTION_DATA_TABLE = "mlops_production_data"

def create_engine_safe(host: str, label: str):
    db_password_encoded = quote_plus(DB_PASSWORD) if DB_PASSWORD else ""
    db_url = f"postgresql://{DB_USER}:{db_password_encoded}@{host}:{DB_PORT}/{DB_NAME}"
    try:
        eng = create_engine(
            db_url,
            poolclass=QueuePool,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
            pool_recycle=1800,
        )
        log_event(logger, "INFO", "database_engine_initialized", "Database engine initialized", operation=label)
        return eng
    except Exception as e:
        log_event(logger, "ERROR", "database_engine_failed", "Database engine initialization failed", operation=label, error_type=type(e).__name__)
        return None
        
engine_rw = create_engine_safe(DB_HOST_RW, "Read Write")
engine_ro = create_engine_safe(DB_HOST_RO, "Read Only")

def init_db():
    if engine_rw is None:
        return
        
    def execute_safe(sql: str, ignore_error: bool = False):
        try:
            with engine_rw.begin() as conn:
                conn.execute(text(sql))
        except Exception as e:
            if not ignore_error:
                log_event(logger, "ERROR", "database_schema_statement_failed", "Database schema statement failed", error_type=type(e).__name__)
            else:
                pass

    execute_safe("""
        CREATE TABLE IF NOT EXISTS mlops_inference_events (
            id VARCHAR(255) PRIMARY KEY,
            prediction_id VARCHAR(255),
            tenant_id VARCHAR(255),
            project_id VARCHAR(255),
            model_version_id VARCHAR(255),
            model_version VARCHAR(255),
            endpoint_url TEXT,
            request_id VARCHAR(255),
            timestamp TIMESTAMPTZ,
            prediction TEXT,
            confidence DOUBLE PRECISION,
            latency_ms DOUBLE PRECISION,
            status_code INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)

    execute_safe("ALTER TABLE mlops_inference_events ADD COLUMN IF NOT EXISTS project_id VARCHAR(255);")
    execute_safe("ALTER TABLE mlops_inference_events ADD COLUMN IF NOT EXISTS model_version_id VARCHAR(255);")
    execute_safe("ALTER TABLE mlops_inference_events ADD COLUMN IF NOT EXISTS prediction_id VARCHAR(255);")
    execute_safe("ALTER TABLE mlops_inference_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();")

    execute_safe("""
        CREATE TABLE IF NOT EXISTS mlops_production_data (
            id VARCHAR(255) PRIMARY KEY,
            inference_event_id VARCHAR(255) NOT NULL,
            tenant_id VARCHAR(255) NOT NULL,
            project_id VARCHAR(255) NOT NULL,
            model_version_id VARCHAR(255) NOT NULL,
            observed_at TIMESTAMPTZ NOT NULL,
            features JSONB NOT NULL,
            prediction TEXT,
            ground_truth TEXT,
            label_status VARCHAR(32) NOT NULL DEFAULT 'unlabeled'
                CHECK (label_status IN ('unlabeled', 'pending', 'labeled', 'rejected')),
            labeled_at TIMESTAMPTZ,
            data_quality_status VARCHAR(32) NOT NULL DEFAULT 'unchecked'
                CHECK (data_quality_status IN ('unchecked', 'accepted', 'rejected')),
            training_eligibility BOOLEAN NOT NULL DEFAULT FALSE,
            exclusion_reason TEXT,
            drift_run_id VARCHAR(255),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    execute_safe(
        "CREATE INDEX IF NOT EXISTS idx_mlops_inference_events_tenant_model_version "
        "ON mlops_inference_events(tenant_id, project_id, model_version_id);"
    )
    execute_safe(
        "CREATE INDEX IF NOT EXISTS idx_mlops_inference_events_model_version "
        "ON mlops_inference_events(model_version_id);"
    )
    execute_safe(
        "CREATE INDEX IF NOT EXISTS idx_mlops_inference_events_prediction_id "
        "ON mlops_inference_events(prediction_id);"
    )
    execute_safe(
        "CREATE INDEX IF NOT EXISTS idx_mlops_inference_events_timestamp "
        "ON mlops_inference_events(timestamp);"
    )
    execute_safe(
        "CREATE INDEX IF NOT EXISTS idx_mlops_inference_events_version_timestamp "
        "ON mlops_inference_events(model_version_id, timestamp DESC);"
    )
    execute_safe(
        "CREATE INDEX IF NOT EXISTS idx_mlops_production_data_tenant_project_version_observed "
        "ON mlops_production_data(tenant_id, project_id, model_version_id, observed_at DESC);"
    )
    execute_safe(
        "CREATE INDEX IF NOT EXISTS idx_mlops_production_data_version_observed "
        "ON mlops_production_data(model_version_id, observed_at DESC);"
    )
    execute_safe(
        "CREATE INDEX IF NOT EXISTS idx_mlops_production_data_training_eligible "
        "ON mlops_production_data(model_version_id, observed_at DESC) "
        "WHERE training_eligibility IS TRUE;"
    )
    execute_safe(
        "CREATE INDEX IF NOT EXISTS idx_mlops_production_data_pending_labels "
        "ON mlops_production_data(tenant_id, project_id, observed_at DESC) "
        "WHERE label_status IN ('unlabeled', 'pending');"
    )

    execute_safe(f"""
        CREATE TABLE IF NOT EXISTS {AUTOMATIC_DRIFT_OUTBOX_TABLE} (
            id BIGSERIAL PRIMARY KEY,
            idempotency_key VARCHAR(255) UNIQUE NOT NULL,
            model_version_id VARCHAR(255) NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            locked_until TIMESTAMPTZ,
            published_at TIMESTAMPTZ,
            last_error TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)
    execute_safe(
        f"CREATE INDEX IF NOT EXISTS idx_paas_auto_drift_outbox_pending "
        f"ON {AUTOMATIC_DRIFT_OUTBOX_TABLE}(published_at, available_at, created_at);"
    )
    
    log_event(logger, "INFO", "database_schema_initialization_finished", "Database schema initialization finished")


def insert_on_conflict_do_nothing(table, conn, keys, data_iter):
    """Pandas ``to_sql`` method that makes Kafka replay safe by event id."""
    rows = [dict(zip(keys, row)) for row in data_iter]
    if not rows:
        return 0

    statement = postgresql_insert(table.table).values(rows)
    if "id" in keys:
        statement = statement.on_conflict_do_nothing(index_elements=["id"])
    result = conn.execute(statement)
    return result.rowcount


def _save_dataframe(conn, df: pd.DataFrame, table_name: str) -> None:
    dtypes = {}
    for col in df.columns:
        if df[col].apply(lambda x: isinstance(x, (dict, list))).any():
            df[col] = df[col].apply(lambda x: json.loads(x) if isinstance(x, str) else x)
            dtypes[col] = JSONB

    df.to_sql(
        table_name,
        conn,
        if_exists='append',
        index=False,
        chunksize=1000,
        dtype=dtypes,
        method=insert_on_conflict_do_nothing,
    )


def save_dataframe_to_db(df: pd.DataFrame, table_name: str) -> bool:
    started = time.perf_counter()
    if engine_rw is None:
        persistence_summary.record(success=False)
        persistence_summary.failure("write", "Database engine unavailable for persistence")
        return False

    try:
        with engine_rw.begin() as conn:
            _save_dataframe(conn, df, table_name)

        persistence_summary.record(duration_ms=(time.perf_counter() - started) * 1000, records=len(df), batches=1)
        persistence_summary.recovery("write")
        return True

    except Exception as e:
        persistence_summary.record(success=False, duration_ms=(time.perf_counter() - started) * 1000)
        persistence_summary.failure("write", "Production data persistence failed", error_type=type(e).__name__)
        return False

def save_inference_events_and_production_data_and_automatic_drift_signals(
    inference_events: pd.DataFrame,
    production_data: pd.DataFrame,
    signals: list[dict[str, str]],
) -> bool:
    """Persist telemetry, CT candidates, and automatic-drift signals atomically.

    A Kafka replay is safe: both tables conflict on their event id and signals
    conflict on their deterministic batch key. No foreign key links the tables,
    so telemetry can use a shorter retention period than production data.
    """
    started = time.perf_counter()
    if engine_rw is None:
        persistence_summary.record(success=False)
        persistence_summary.failure("write", "Database engine unavailable for persistence")
        return False

    try:
        with engine_rw.begin() as conn:
            _save_dataframe(conn, inference_events, INFERENCE_EVENTS_TABLE)
            if not production_data.empty:
                _save_dataframe(conn, production_data, PRODUCTION_DATA_TABLE)
            if signals:
                conn.execute(
                    text(
                        f"""
                        INSERT INTO {AUTOMATIC_DRIFT_OUTBOX_TABLE}
                            (idempotency_key, model_version_id)
                        VALUES (:idempotency_key, :model_version_id)
                        ON CONFLICT (idempotency_key) DO NOTHING
                        """
                    ),
                    signals,
                )
        persistence_summary.record(
            duration_ms=(time.perf_counter() - started) * 1000,
            records=len(inference_events), production_samples=len(production_data), batches=1,
        )
        persistence_summary.recovery("write")
        return True
    except Exception as exc:
        persistence_summary.record(success=False, duration_ms=(time.perf_counter() - started) * 1000)
        persistence_summary.failure("write", "Inference telemetry and production data transaction failed", error_type=type(exc).__name__)
        return False


def claim_automatic_drift_signals(limit: int, lease_seconds: int) -> list[dict]:
    """Lease pending signals so multiple Consumer replicas do not send the same row."""
    if engine_rw is None:
        return []

    with engine_rw.begin() as conn:
        rows = conn.execute(
            text(
                f"""
                WITH candidates AS (
                    SELECT id
                    FROM {AUTOMATIC_DRIFT_OUTBOX_TABLE}
                    WHERE published_at IS NULL
                      AND available_at <= NOW()
                      AND (locked_until IS NULL OR locked_until < NOW())
                    ORDER BY created_at, id
                    FOR UPDATE SKIP LOCKED
                    LIMIT :limit
                )
                UPDATE {AUTOMATIC_DRIFT_OUTBOX_TABLE} AS event
                SET attempts = event.attempts + 1,
                    locked_until = NOW() + (:lease_seconds * INTERVAL '1 second')
                FROM candidates
                WHERE event.id = candidates.id
                RETURNING event.id, event.idempotency_key, event.model_version_id, event.attempts
                """
            ),
            {"limit": limit, "lease_seconds": lease_seconds},
        ).mappings()
        return [dict(row) for row in rows]


def mark_automatic_drift_signal_published(event_id: int) -> None:
    if engine_rw is None:
        return
    with engine_rw.begin() as conn:
        conn.execute(
            text(
                f"""
                UPDATE {AUTOMATIC_DRIFT_OUTBOX_TABLE}
                SET published_at = NOW(), locked_until = NULL, last_error = ''
                WHERE id = :event_id AND published_at IS NULL
                """
            ),
            {"event_id": event_id},
        )


def reschedule_automatic_drift_signal(event_id: int, attempts: int, error: str, delay_seconds: int) -> None:
    if engine_rw is None:
        return
    with engine_rw.begin() as conn:
        conn.execute(
            text(
                f"""
                UPDATE {AUTOMATIC_DRIFT_OUTBOX_TABLE}
                SET available_at = NOW() + (:delay_seconds * INTERVAL '1 second'),
                    locked_until = NULL,
                    last_error = :error
                WHERE id = :event_id AND published_at IS NULL AND attempts = :attempts
                """
            ),
            {
                "event_id": event_id,
                "attempts": attempts,
                "delay_seconds": delay_seconds,
                "error": error[:1000],
            },
        )
