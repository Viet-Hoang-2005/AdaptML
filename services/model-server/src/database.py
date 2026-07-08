# database.py: Quản lý kết nối đến Control Plane Model Registry
import os
import re
from typing import Dict, Any
from urllib.parse import quote_plus

from sqlalchemy import create_engine, text

def build_control_plane_database_url() -> str | None:
    explicit_url = os.environ.get("CONTROL_PLANE_DATABASE_URL")
    if explicit_url:
        return explicit_url

    db_user = os.environ.get("DB_USER")
    db_password = os.environ.get("DB_PASSWORD")
    db_host = os.environ.get("DB_HOST_RO", "postgres")
    db_port = os.environ.get("DB_PORT", "5432")
    db_name = os.environ.get("DB_NAME", "mlops_paas_db")

    if not db_user or not db_password:
        return None

    return (
        f"postgresql://{quote_plus(db_user)}:{quote_plus(db_password)}"
        f"@{db_host}:{db_port}/{db_name}"
    )

CONTROL_PLANE_DATABASE_URL = build_control_plane_database_url()
CONTROL_PLANE_DB_SCHEMA = os.environ.get("CONTROL_PLANE_DB_SCHEMA") or os.environ.get("DB_SCHEMA", "control_plane")

if CONTROL_PLANE_DB_SCHEMA and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", CONTROL_PLANE_DB_SCHEMA):
    raise RuntimeError("CONTROL_PLANE_DB_SCHEMA must be a simple PostgreSQL identifier.")

try:
    model_registry_engine = (
        create_engine(
            CONTROL_PLANE_DATABASE_URL,
            pool_pre_ping=True,
            connect_args={"options": f"-c search_path={CONTROL_PLANE_DB_SCHEMA},public"},
        )
        if CONTROL_PLANE_DATABASE_URL
        else None
    )
    print("Connected to Control Plane model registry." if model_registry_engine else "CONTROL_PLANE_DATABASE_URL is not set.")
except Exception as exc:
    print(f"Failed to connect to Control Plane model registry: {exc}")
    model_registry_engine = None

def get_model_api_record(model_id: int) -> Dict[str, Any]:
    if model_registry_engine is None:
        raise Exception("Model registry database is unavailable.")

    query = text('''
        SELECT
            model.id,
            model.name,
            model.access_mode,
            model.model_uri,
            model.endpoint_url,
            model.endpoint_container_name,
            model.model_type,
            model.status,
            model.updated_at,
            users.tenant_id
        FROM authentication_modelapi AS model
        INNER JOIN authentication_customuser AS users ON users.id = model.tenant_id
        WHERE model.id = :model_id AND model.status != 'disabled'
        LIMIT 1
    ''')

    with model_registry_engine.connect() as conn:
        row = conn.execute(query, {"model_id": model_id}).mappings().first()

    if not row:
        return None

    return dict(row)
