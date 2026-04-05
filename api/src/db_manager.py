# db_manager.py: Quản lý kết nối đến CloudNativePG
import os
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.pool import QueuePool

# 1. NẠP BIẾN MÔI TRƯỜNG
# Khi chạy trong K8s, các biến được inject từ manifest YAML.
# Khi chạy local, được đọc từ file .env ở thư mục gốc project.
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, '.env'))

DB_USER = os.getenv("DB_USER", "admin")
DB_PASSWORD = os.getenv("DB_PASSWORD", "secret")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "mlops_nids_db")

# CloudNativePG tạo ra 2 Service endpoint riêng biệt:
#   DB_HOST_RW (Read-Write): Trỏ đến Pod PRIMARY — dùng cho INSERT/UPDATE/DELETE.
#                            Đây là endpoint duy nhất được phép thực hiện thao tác ghi.
#                            Tên Service: <cluster-name>-rw
#
#   DB_HOST_RO (Read-Only):  Trỏ đến CẢ Primary lẫn Standby, load-balanced.
#                            Dùng cho SELECT — giảm tải cho Primary.
#                            Tên Service: <cluster-name>-ro
#
# Khi chạy local (docker-compose), cả 2 biến đều trỏ về cùng 1 host.
DB_HOST_RW = os.getenv("DB_HOST_RW", os.getenv("DB_HOST", "localhost"))
DB_HOST_RO = os.getenv("DB_HOST_RO", os.getenv("DB_HOST", "localhost"))

# 2. KHỞI TẠO 2 CONNECTION POOL (READ-WRITE và READ-ONLY)
def _create_engine_safe(host: str, label: str):
    """
    Tạo SQLAlchemy Engine với Connection Pooling cho một host cụ thể.
    Trả về None nếu kết nối thất bại — API vẫn khởi động được, không crash hard.
    """
    db_url = f"postgresql://{DB_USER}:{DB_PASSWORD}@{host}:{DB_PORT}/{DB_NAME}"
    try:
        eng = create_engine(
            db_url,
            poolclass=QueuePool,
            pool_size=10,       # Số connection thường trực trong pool
            max_overflow=20,    # Số connection tạm thêm khi quá tải
            pool_pre_ping=True, # Tự kiểm tra connection trước khi dùng (phòng failover)
            pool_recycle=1800,  # Đóng và mở lại connection sau 30 phút để tránh stale
        )
        print(f"🔗 [{label}] Connected to PostgreSQL at {host}:{DB_PORT}/{DB_NAME}")
        return eng
    except Exception as e:
        print(f"⛓️‍💥 [{label}] Database connection failed: {e}")
        return None

# Engine cho API ghi log production data (-> Primary)
engine_rw = _create_engine_safe(DB_HOST_RW, "READ-WRITE -> Primary")

# Engine cho các tác vụ đọc nếu cần trong tương lai (-> Standby)
engine_ro = _create_engine_safe(DB_HOST_RO, "READ-ONLY  -> Standby")

# 3. HÀM GHI DỮ LIỆU (dùng engine_rw -> PRIMARY)
def save_dataframe_to_db(df: pd.DataFrame, table_name: str) -> bool:
    """
    Lưu DataFrame vào bảng PostgreSQL thông qua engine Read-Write (Primary Node).

    Quy trình:
    1. INSERT dữ liệu theo chunk để tối ưu bộ nhớ.
    2. Tự động thêm PRIMARY KEY trên cột 'id' nếu bảng chưa có (chỉ cần làm 1 lần).

    Args:
        df         : DataFrame cần lưu (log inference từ API).
        table_name : Tên bảng đích trong PostgreSQL.

    Returns:
        True nếu thành công, False nếu gặp lỗi.
    """
    if engine_rw is None:
        print("❌ [RW Engine] No database engine available for writing.")
        return False

    try:
        # INSERT dữ liệu, chunk 1000 dòng để không bão hòa RAM
        df.to_sql(table_name, engine_rw, if_exists='append', index=False, chunksize=1000)

        # Tự động thiết lập PRIMARY KEY trên cột 'id' nếu bảng chưa có PK.
        # Điều này chỉ xảy ra lần đầu tiên bảng được tạo bởi SQLAlchemy.
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
                        print(f"🔑 Primary Key added to '{table_name}'")
                    except Exception as pk_err:
                        # Bình thường nếu bảng đã có PK từ lần chạy trước
                        print(f"⚠️ Could not set Primary Key (may already exist): {pk_err}")

        record_count = len(df)
        if record_count == 1 and 'id' in df.columns:
            print(f"✅ [RW] Inserted 1 record (ID: {df['id'].iloc[0]}) → '{table_name}'")
        else:
            print(f"✅ [RW] Inserted {record_count} records → '{table_name}'")
        return True

    except Exception as e:
        print(f"❌ [RW] Error saving to '{table_name}': {e}")
        return False


# 4. TEST CHẠY THỬ ĐỘC LẬP
if __name__ == "__main__":
    import uuid
    from datetime import datetime

    CSV_PATH = os.path.join(ROOT_DIR, 'data', 'test_data.csv')

    if os.path.exists(CSV_PATH):
        print(f"📖 Reading Test Data from: {CSV_PATH}")
        sample_df = pd.read_csv(CSV_PATH)

        if 'id' not in sample_df.columns:
            sample_df['id'] = [str(uuid.uuid4()) for _ in range(len(sample_df))]
        if 'created_at' not in sample_df.columns:
            sample_df['created_at'] = datetime.utcnow()

        save_dataframe_to_db(sample_df, "nids_production_data")
    else:
        print(f"❌ Test CSV not found at: {CSV_PATH}")