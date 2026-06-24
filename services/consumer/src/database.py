# database.py: Quản lý kết nối đến PostgreSQL cho Consumer
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

DB_HOST_RW = os.environ.get("DB_HOST_RW", "localhost")
DB_HOST_RO = os.environ.get("DB_HOST_RO", "localhost")

def _create_engine_safe(host: str, label: str):
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
        
engine_rw = _create_engine_safe(DB_HOST_RW, "Read Write")
engine_ro = _create_engine_safe(DB_HOST_RO, "Read Only")

def save_dataframe_to_db(df: pd.DataFrame, table_name: str) -> bool:
    if engine_rw is None:
        print("[RW Engine] No database engine available for writing.")
        return False

    try:
        dtypes = {}
        for col in df.columns:
            if df[col].apply(lambda x: isinstance(x, (dict, list))).any():
                df[col] = df[col].apply(lambda x: json.dumps(x) if isinstance(x, (dict, list)) else x)
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

def get_production_data_count_by_model(model_id: str) -> int:
    engine = engine_ro if engine_ro else engine_rw
    if engine is None:
        return 0

    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("SELECT COUNT(*) FROM paas_production_logs WHERE model_id = :model_id"),
                {"model_id": model_id}
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
            result = conn.execute(
                text("SELECT model_api_id, trigger_threshold FROM authentication_driftmonitoringjob WHERE status = 'active'")
            )
            return {str(row[0]): row[1] for row in result.fetchall()}
    except Exception as e:
        if "relation \"authentication_driftmonitoringjob\" does not exist" not in str(e):
            print(f"Error getting drift thresholds: {e}")
        return {}
