# update_reference_data.py: Cập nhật bảng nids_reference_data trong PostgreSQL sau khi deploy model mới thành công.
import sys
import json
import uuid
import boto3
import os
import pandas as pd
from io import StringIO
from datetime import datetime
from sqlalchemy import create_engine, text

# 1. CẤU HÌNH TỪ BIẾN MÔI TRƯỜNG (Inject bởi GitHub Actions)
DB_USER = os.environ["DB_USER"]
DB_PASSWORD = os.environ["DB_PASSWORD"]
DB_HOST = os.environ["DB_HOST"]
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "mlops_nids_db")

AWS_BUCKET = os.environ.get("AWS_BUCKET_NAME", "mlops-nids-artifacts")
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "ap-southeast-1")
MANIFEST_KEY = "data_manifest.json"
REFERENCE_TABLE = "nids_reference_data"

# 2. ĐỌC MANIFEST TỪ AWS S3
def load_manifest_from_s3(s3_client) -> dict:
    print(f"📋 [1/4] Reading data manifest from s3://{AWS_BUCKET}/{MANIFEST_KEY}...")
    
    response = s3_client.get_object(Bucket=AWS_BUCKET, Key=MANIFEST_KEY)
    manifest = json.loads(response['Body'].read().decode('utf-8'))
    
    print(f" -> Target dataset : {manifest['target_csv']}")
    print(f" -> Model version  : {manifest['model_version']}")
    return manifest

# 3. TẢI FILE CSV TỪ S3
def load_csv_from_s3(s3_client, manifest: dict) -> pd.DataFrame:
    prefix = manifest.get("s3_training_data_prefix", "training-data/")
    csv_key = f"{prefix}{manifest['target_csv']}"

    print(f"📥 [2/4] Downloading dataset from s3://{AWS_BUCKET}/{csv_key}...")
    response = s3_client.get_object(Bucket=AWS_BUCKET, Key=csv_key)
    csv_content = response['Body'].read().decode('utf-8')
    df = pd.read_csv(StringIO(csv_content))

    print(f" -> Downloaded: {len(df):,} rows × {len(df.columns)} columns")
    return df

# 4. CẬP NHẬT BẢNG REFERENCE TRONG POSTGRESQL (PRIMARY)
def update_reference_table(engine, df: pd.DataFrame, manifest: dict):
    print(f"🗄️ [3/4] Updating '{REFERENCE_TABLE}' in PostgreSQL...")

    # Xóa baseline cũ để tránh tích lũy nhiều phiên bản lẫn lộn
    with engine.begin() as conn:
        try:
            conn.execute(text(f'TRUNCATE TABLE "{REFERENCE_TABLE}" RESTART IDENTITY;'))
            print(f"TRUNCATED old data from '{REFERENCE_TABLE}'")
        except Exception as e:
            # Bảng có thể chưa tồn tại (lần đầu chạy) -> bỏ qua lỗi này
            print(f"⚠️ Could not truncate (may not exist yet): {e}")

    df_to_insert = df.copy()

    # Đổi tên cột 'Label' -> 'Predicted_Label' để đồng nhất schema với production data.
    # Evidently sẽ so sánh cột 'Predicted_Label' giữa reference và production.
    if 'Label' in df_to_insert.columns:
        df_to_insert = df_to_insert.rename(columns={'Label': 'Predicted_Label'})
        print("Renamed 'Label' -> 'Predicted_Label' for schema alignment")

    # Gắn metadata để truy vết nguồn gốc của baseline
    df_to_insert['id'] = [str(uuid.uuid4()) for _ in range(len(df_to_insert))]
    df_to_insert['created_at'] = datetime.utcnow()
    df_to_insert['data_source'] = manifest['target_csv']
    df_to_insert['model_version'] = manifest['model_version']

    # Insert theo chunk 2000 dòng để không bão hòa RAM
    df_to_insert.to_sql(
        REFERENCE_TABLE,
        engine,
        if_exists='append',
        index=False,
        chunksize=2000
    )
    print(f" -> INSERTED {len(df_to_insert):,} rows into '{REFERENCE_TABLE}'")

# 5. MAIN
if __name__ == "__main__":
    print("=" * 60)
    print("🛡️ MLOps NIDS System — Reference Data Sync Service")
    print("=" * 60)

    # Kết nối AWS S3
    try:
        s3 = boto3.client('s3', region_name=AWS_REGION)
        print(f"☁️ [0/4] Connected to AWS S3 (Region: {AWS_REGION})")
    except Exception as e:
        print(f"❌ Cannot connect to AWS S3: {e}")
        sys.exit(1)

    # Kết nối PostgreSQL PRIMARY (READ-WRITE endpoint của CloudNativePG)
    db_url = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    try:
        # pool_pre_ping=True đảm bảo script tự reconnect nếu connection bị drop trong môi trường GitHub Actions (mạng không ổn định)
        engine = create_engine(db_url, pool_pre_ping=True)
        
        # Test connection ngay để fail-fast nếu credentials sai
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print(f"🔗 [0/4] Connected to PostgreSQL at {DB_HOST}:{DB_PORT}/{DB_NAME}")
    except Exception as e:
        print(f"❌ Cannot connect to PostgreSQL: {e}")
        sys.exit(1)

    # Đọc manifest -> Tải CSV -> Cập nhật DB
    try:
        manifest = load_manifest_from_s3(s3)
        new_reference_df = load_csv_from_s3(s3, manifest)
        update_reference_table(engine, new_reference_df, manifest)
    except Exception as e:
        print(f"❌ Error during sync process: {e}")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("  ✅ Reference Data sync COMPLETED!")
    print(f"     New dataset : {manifest['target_csv']}")
    print(f"     Model ver.  : {manifest['model_version']}")
    print(f"     Rows synced : {len(new_reference_df):,}")
    print(f"     detect_drift.py will use this as the new baseline.")
    print("=" * 60)
