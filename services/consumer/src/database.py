import os
import json
from urllib.parse import quote_plus

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.pool import QueuePool
from sqlalchemy.dialects.postgresql import JSONB

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, '.env'))

DB_USER = os.environ.get("DB_USER")
DB_PASSWORD = os.environ.get("DB_PASSWORD")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "mlops_paas_db")

DB_HOST_RW = os.environ.get("DB_HOST_RW", "postgres")
DB_HOST_RO = os.environ.get("DB_HOST_RO", "postgres")

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
        print(f"[{label}] Connected to PostgreSQL at {host}:{DB_PORT}/{DB_NAME}")
        return eng
    except Exception as e:
        print(f"[{label}] Database connection failed: {e}")
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
                print(f"[RW] SQL execution failed: {e}")
            else:
                pass

    # 1. Create table if missing
    execute_safe("""
        CREATE TABLE IF NOT EXISTS paas_production_logs (
            id VARCHAR(255) PRIMARY KEY,
            tenant_id VARCHAR(255),
            project_id VARCHAR(255),
            model_version_id VARCHAR(255),
            model_version VARCHAR(255),
            endpoint_url TEXT,
            request_id VARCHAR(255),
            timestamp TIMESTAMPTZ,
            features JSONB,
            prediction TEXT,
            confidence DOUBLE PRECISION,
            latency_ms DOUBLE PRECISION,
            status_code INTEGER,
            raw_payload JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)

    # 2. Add created_at column if the table was previously created by pandas to_sql
    execute_safe("ALTER TABLE paas_production_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();", ignore_error=True)

    # 3. Migrate text columns to JSONB safely
    execute_safe("ALTER TABLE paas_production_logs ALTER COLUMN features TYPE JSONB USING features::JSONB;", ignore_error=True)
    execute_safe("ALTER TABLE paas_production_logs ALTER COLUMN raw_payload TYPE JSONB USING raw_payload::JSONB;", ignore_error=True)
    execute_safe("ALTER TABLE paas_production_logs ALTER COLUMN prediction TYPE TEXT USING prediction::TEXT;", ignore_error=True)
    execute_safe(
        "ALTER TABLE paas_production_logs ADD COLUMN IF NOT EXISTS project_id VARCHAR(255);"
    )
    execute_safe(
        "ALTER TABLE paas_production_logs ADD COLUMN IF NOT EXISTS model_version_id VARCHAR(255);"
    )

    # 4. Create Indexes
    execute_safe(
        "CREATE INDEX IF NOT EXISTS idx_paas_prod_logs_tenant_model_version "
        "ON paas_production_logs(tenant_id, project_id, model_version_id);"
    )
    execute_safe("CREATE INDEX IF NOT EXISTS idx_paas_prod_logs_timestamp ON paas_production_logs(timestamp);")
    
    print("[RW] Initialized 'paas_production_logs' schema.")


def save_dataframe_to_db(df: pd.DataFrame, table_name: str) -> bool:
    if engine_rw is None:
        print("[RW Engine] No database engine available for writing.")
        return False

    try:
        dtypes = {}
        for col in df.columns:
            if df[col].apply(lambda x: isinstance(x, (dict, list))).any():
                # Let the JSONB dtype serialize dict/list once; json.dumps here would
                # double-encode (JSONB then stores a JSON string instead of an object).
                df[col] = df[col].apply(lambda x: json.loads(x) if isinstance(x, str) else x)
                dtypes[col] = JSONB

        df.to_sql(table_name, engine_rw, if_exists='append', index=False, chunksize=1000, dtype=dtypes)

        if 'id' in df.columns:
            with engine_rw.begin() as conn:
                result = conn.execute(text(f"""
                    SELECT constraint_name
                    FROM information_schema.table_constraints
                    WHERE table_name = '{table_name}' AND constraint_type = 'PRIMARY KEY'
                """)).fetchone()

                if not result:
                    try:
                        conn.execute(text(f'ALTER TABLE "{table_name}" ADD PRIMARY KEY (id);'))
                        print(f"Primary Key added to '{table_name}'")
                    except Exception as pk_err:
                        print(f"Could not set Primary Key (may already exist): {pk_err}")

        record_count = len(df)
        if record_count == 1 and 'id' in df.columns:
            print(f"[RW] Inserted 1 record (ID: {df['id'].iloc[0]}) -> '{table_name}'")
        else:
            print(f"[RW] Inserted {record_count} records -> '{table_name}'")
        return True

    except Exception as e:
        print(f"[RW] Error saving to '{table_name}': {e}")
        return False

def get_production_data_count() -> int:
    engine = engine_ro if engine_ro else engine_rw
    if engine is None:
        return 0

    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT COUNT(*) FROM paas_production_logs"))
            return result.scalar()
    except Exception as e:
        print(f"Error counting records: {e}")
        return 0

def get_production_data_count_by_model_version(model_version_id: str) -> int:
    engine = engine_ro if engine_ro else engine_rw
    if engine is None:
        return 0

    try:
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    "SELECT COUNT(*) FROM paas_production_logs "
                    "WHERE model_version_id = :model_version_id"
                ),
                {"model_version_id": model_version_id}
            )
            return result.scalar()
    except Exception as e:
        if "relation \"paas_production_logs\" does not exist" not in str(e):
            print(f"Error counting records for model: {e}")
        return 0

def get_model_drift_thresholds() -> dict:
    engine = engine_ro if engine_ro else engine_rw
    if engine is None:
        return {}

    try:
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT version.public_id, monitor.trigger_threshold
                FROM drift_driftmonitor AS monitor
                INNER JOIN registry_modelversion AS version ON version.id = monitor.version_id
                WHERE monitor.is_active = TRUE
            """))
            return {str(row[0]): row[1] for row in result.fetchall()}
    except Exception as e:
        if "relation \"drift_driftmonitor\" does not exist" not in str(e):
            print(f"Error getting drift thresholds: {e}")
        return {}
