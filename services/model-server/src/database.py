# database.py: Quản lý kết nối đến CloudNativePG
import os
import uuid
import re
from typing import Dict, Any
from datetime import datetime
from urllib.parse import quote_plus

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.pool import QueuePool

# 1. NẠP BIẾN MÔI TRƯỜNG
# Khi chạy trong K8s, các biến được inject từ manifest YAML.
# Khi chạy local, được đọc từ file .env ở thư mục gốc project.
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, '.env'))

DB_USER = os.environ.get("DB_USER")
DB_PASSWORD = os.environ.get("DB_PASSWORD")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "mlops_paas_db")

# CloudNativePG tạo ra 2 Service endpoint riêng biệt:
# - DB_HOST_RW (Read-Write): Trỏ đến Pod PRIMARY - dùng cho INSERT/UPDATE/DELETE.
# - DB_HOST_RO (Read-Only):  Trỏ đến CẢ Primary lẫn Standby, load-balanced.

# Khi chạy local (docker-compose), cả 2 biến đều trỏ về cùng 1 host.
DB_HOST_RW = os.environ.get("DB_HOST_RW", "localhost")
DB_HOST_RO = os.environ.get("DB_HOST_RO", "localhost")

# 2. KHỞI TẠO 2 CONNECTION POOL (READ-WRITE và READ-ONLY)
def _create_engine_safe(host: str, label: str):
    # URL-encode password to handle special characters (e.g. @, %, #)
    db_password_encoded = quote_plus(DB_PASSWORD) if DB_PASSWORD else ""
    db_url = f"postgresql://{DB_USER}:{db_password_encoded}@{host}:{DB_PORT}/{DB_NAME}"
    try:
        eng = create_engine(
            db_url,
            poolclass=QueuePool,
            pool_size=10,       # Số connection thường trực trong pool
            max_overflow=20,    # Số connection tạm thêm khi quá tải
            pool_pre_ping=True, # Tự kiểm tra connection trước khi dùng (phòng failover)
            pool_recycle=1800,  # Đóng và mở lại connection sau 30 phút để tránh stale
        )
        print(f"[{label}] Connected to PostgreSQL at {host}:{DB_PORT}/{DB_NAME}")
        return eng
    except Exception as e:
        print(f"[{label}] Database connection failed: {e}")
        return None
        
engine_rw = _create_engine_safe(DB_HOST_RW, "Read Write")
engine_ro = _create_engine_safe(DB_HOST_RO, "Read Only")

# 3. HÀM GHI DỮ LIỆU (dùng engine_rw -> PRIMARY)
def save_dataframe_to_db(df: pd.DataFrame, table_name: str) -> bool:
    if engine_rw is None:
        print("[RW Engine] No database engine available for writing.")
        return False

    try:
        # INSERT dữ liệu, chunk 1000 dòng để không bão hòa RAM
        df.to_sql(table_name, engine_rw, if_exists='append', index=False, chunksize=1000)

        # Tự động thiết lập PRIMARY KEY trên cột 'id' nếu bảng chưa có PK (chỉ xảy ra lần đầu tiên bảng được tạo bởi SQLAlchemy)
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
                        # Bình thường nếu bảng đã có PK từ lần chạy trước
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

# 4. HÀM ĐẾM SỐ LƯỢNG BẢN GHI
def get_production_data_count() -> int:
    # Mặc định lấy từ engine_ro nếu có để giảm tải, nếu không có fallback sang engine_rw
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

# 5. KẾT NỐI ĐẾN CONTROL PLANE MODEL REGISTRY
CONTROL_PLANE_DATABASE_URL = os.environ.get("CONTROL_PLANE_DATABASE_URL")
CONTROL_PLANE_DB_SCHEMA = os.environ.get("CONTROL_PLANE_DB_SCHEMA", "control_plane")

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

# 6. TEST CHẠY THỬ ĐỘC LẬP
if __name__ == "__main__":
    CSV_PATH = os.path.join(ROOT_DIR, 'data', 'test_data.csv')

    if os.path.exists(CSV_PATH):
        print(f"Reading Test Data from: {CSV_PATH}")
        sample_df = pd.read_csv(CSV_PATH)

        if 'id' not in sample_df.columns:
            sample_df['id'] = [str(uuid.uuid4()) for _ in range(len(sample_df))]
        if 'created_at' not in sample_df.columns:
            sample_df['created_at'] = datetime.utcnow()

        save_dataframe_to_db(sample_df, "paas_production_logs")
    else:
        print(f"Test CSV not found at: {CSV_PATH}")
