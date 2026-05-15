# update_reference_data.py: Cập nhật References Data trong PostgreSQL sau khi deploy model mới thành công.
import sys
import json
import uuid
import boto3
import os
import pandas as pd
from io import StringIO
from datetime import datetime
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# 1. CẤU HÌNH TỪ BIẾN MÔI TRƯỜNG
# Load biến môi trường từ file .env khi chạy local
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA_DIR = os.path.join(ROOT_DIR, 'data')
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, '.env'))

# Khi chạy trên GitHub Actions, các biến này sẽ được inject tự động
DB_USER = os.environ.get("DB_USER")
DB_PASSWORD = os.environ.get("DB_PASSWORD")
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "mlops_nids_db")

AWS_BUCKET = os.environ.get("AWS_BUCKET_NAME", "mlops-nids-artifacts")
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "ap-southeast-1")
MANIFEST_KEY = "data_manifest.json"
REFERENCE_TABLE = "nids_reference_data"

os.makedirs(DATA_DIR, exist_ok=True)

# 2. ĐỌC MANIFEST TỪ AWS S3 HOẶC LOCAL
def load_manifest_from_s3(s3_client) -> dict:
    print(f"[2/4] Reading data manifest from s3://{AWS_BUCKET}/{MANIFEST_KEY}...")
    
    response = s3_client.get_object(Bucket=AWS_BUCKET, Key=MANIFEST_KEY)
    manifest = json.loads(response['Body'].read().decode('utf-8-sig'))
    
    print(f" Target dataset : {manifest['target_csv']}")
    print(f" Model version  : {manifest['model_version']}")
    return manifest

def load_manifest_local() -> dict:
    manifest_path = os.path.join(ROOT_DIR, MANIFEST_KEY)
    print(f" Fallback: Reading data manifest from local {manifest_path}...")
    with open(manifest_path, 'r', encoding='utf-8-sig') as f:
        manifest = json.load(f)
    print(f" Target dataset : {manifest['target_csv']}")
    print(f" Model version  : {manifest['model_version']}")
    return manifest

# 3. TẢI FILE CSV TỪ S3 HOẶC LOCAL
def load_csv_from_s3(s3_client, manifest: dict) -> pd.DataFrame:
    prefix = manifest.get("s3_training_data_prefix", "training-data/")
    csv_key = f"{prefix}{manifest['target_csv']}"

    print(f"[3/4] Downloading dataset from s3://{AWS_BUCKET}/{csv_key}...")
    response = s3_client.get_object(Bucket=AWS_BUCKET, Key=csv_key)
    csv_content = response['Body'].read().decode('utf-8')
    df = pd.read_csv(StringIO(csv_content))

    print(f" Downloaded: {len(df):,} rows × {len(df.columns)} columns")
    return df

def load_csv_local(manifest: dict) -> pd.DataFrame:
    csv_path = os.path.join(DATA_DIR, manifest['target_csv'])
    print(f" Fallback: Reading dataset from local {csv_path}...")
    df = pd.read_csv(csv_path)

    print(f" Downloaded: {len(df):,} rows × {len(df.columns)} columns")
    return df

# 4. CẬP NHẬT BẢNG REFERENCE TRONG POSTGRESQL (PRIMARY)
def update_reference_table(engine, df: pd.DataFrame, manifest: dict):
    print(f"[4/4] Updating '{REFERENCE_TABLE}' in PostgreSQL...")

    # Xóa baseline cũ để tránh tích lũy nhiều phiên bản lẫn lộn
    with engine.begin() as conn:
        try:
            conn.execute(text(f'TRUNCATE TABLE "{REFERENCE_TABLE}" RESTART IDENTITY;'))
            print(f"TRUNCATED old data from '{REFERENCE_TABLE}'")
        except Exception as e:
            # Bảng có thể chưa tồn tại (lần đầu chạy) -> bỏ qua lỗi này
            print(f"Could not truncate (may not exist yet): {e}")

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
    # Kết nối PostgreSQL PRIMARY (READ-WRITE endpoint của CloudNativePG)
    db_url = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    try:
        # pool_pre_ping=True đảm bảo script tự reconnect nếu connection bị drop trong môi trường GitHub Actions (mạng không ổn định)
        engine = create_engine(db_url, pool_pre_ping=True)
        
        # Test connection ngay để fail-fast nếu credentials sai
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print(f"[0/4] Connected to PostgreSQL at {DB_HOST}:{DB_PORT}/{DB_NAME}")
    except Exception as e:
        print(f"Cannot connect to PostgreSQL: {e}")
        sys.exit(1)

    # Kết nối AWS S3
    try:
        s3 = boto3.client('s3', region_name=AWS_REGION)
        print(f"[1/4] Connected to AWS S3 (Region: {AWS_REGION})")
    except Exception as e:
        print(f"Cannot connect to AWS S3: {e}. Will fallback to local files.")
        s3 = None

    # Đọc manifest -> Tải CSV -> Cập nhật DB
    try:
        # Load manifest
        if s3 is not None:
            try:
                manifest = load_manifest_from_s3(s3)
            except Exception as e:
                print(f"S3 Manifest failed ({e}), falling back to local...")
                manifest = load_manifest_local()
        else:
            manifest = load_manifest_local()

        # Load CSV
        if s3 is not None:
            try:
                new_reference_df = load_csv_from_s3(s3, manifest)
            except Exception as e:
                print(f"S3 CSV failed ({e}), falling back to local...")
                new_reference_df = load_csv_local(manifest)
        else:
            new_reference_df = load_csv_local(manifest)

        # Update DB
        update_reference_table(engine, new_reference_df, manifest)
    except Exception as e:
        print(f"Error during sync process: {e}")
        sys.exit(1)

    print("Reference Data sync COMPLETED!")
    print(f" New dataset  : {manifest['target_csv']}")
    print(f" Model ver    : {manifest['model_version']}")
    print(f" Rows synced  : {len(new_reference_df):,}")
