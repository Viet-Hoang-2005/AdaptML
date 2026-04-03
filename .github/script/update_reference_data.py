# update_reference_data.py: Script cập nhật dữ liệu nids_reference_data mới trong PostgreSQL để detect_drift.py có baseline so sánh.
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
# PostgreSQL
DB_USER = os.environ["DB_USER"]
DB_PASSWORD = os.environ["DB_PASSWORD"]
DB_HOST = os.environ["DB_HOST"]
DB_PORT = os.environ.get("DB_PORT", "5432")
DB_NAME = os.environ.get("DB_NAME", "mlops_nids_db")

# AWS S3
AWS_BUCKET = os.environ.get("AWS_BUCKET_NAME", "mlops-nids-models-bucket")
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "ap-southeast-1")
MANIFEST_KEY = "data_manifest.json"
REFERENCE_TABLE = "nids_reference_data"

# 2. ĐỌC MANIFEST TỪ AWS S3
def load_manifest_from_s3(s3_client) -> dict:
    print(f"📋 [1/4] Read the Data Manifest from S3://{AWS_BUCKET}/{MANIFEST_KEY}...")
    response = s3_client.get_object(Bucket=AWS_BUCKET, Key=MANIFEST_KEY)
    manifest = json.loads(response['Body'].read().decode('utf-8'))
    print(f"Dataset specified: {manifest['target_csv']} (Model: {manifest['model_version']})")
    return manifest

# 3. TẢI FILE CSV TỪ S3
def load_csv_from_s3(s3_client, manifest: dict) -> pd.DataFrame:
    prefix = manifest.get("s3_training_data_prefix", "training-data/")
    csv_key = f"{prefix}{manifest['target_csv']}"

    print(f"📥 [2/4] Download data from S3://{AWS_BUCKET}/{csv_key}...")
    response = s3_client.get_object(Bucket=AWS_BUCKET, Key=csv_key)
    csv_content = response['Body'].read().decode('utf-8')
    df = pd.read_csv(StringIO(csv_content))

    print(f"Downloaded: {len(df):,} rows × {len(df.columns)} columns")
    return df

# 4. CẬP NHẬT BẢNG REFERENCE TRONG POSTGRESQL
def update_reference_table(engine, df: pd.DataFrame, manifest: dict):
    print(f"🗄️ [3/4] Update the '{REFERENCE_TABLE}' table in PostgreSQL...")

    # Bước 1: Xóa toàn bộ dữ liệu cũ trong bảng reference
    with engine.begin() as conn:
        try:
            conn.execute(text(f'TRUNCATE TABLE "{REFERENCE_TABLE}";'))
            print(f"The table has been TRUNCATED: '{REFERENCE_TABLE}'")
        except Exception as e:
            print(f"❌ Cannot truncate table '{REFERENCE_TABLE}': {e}")

    # Bước 2: Gắn metadata vào mỗi dòng để truy vết nguồn gốc
    df_to_insert = df.copy()

    # Loại bỏ cột Label gốc, Reference Data chỉ cần features để Evidently so sánh
    if 'Label' in df_to_insert.columns:
        df_to_insert = df_to_insert.drop(columns=['Label'])

    # Thêm cột id, created_at, data_source, model_version
    df_to_insert['id'] = [str(uuid.uuid4()) for _ in range(len(df_to_insert))]
    df_to_insert['created_at'] = datetime.utcnow()
    df_to_insert['data_source'] = manifest['target_csv']
    df_to_insert['model_version'] = manifest['model_version']

    # Bước 3: Insert dữ liệu vào bảng reference theo từng chunk 2000 dòng
    df_to_insert.to_sql(
        REFERENCE_TABLE,
        engine,
        if_exists='append',
        index=False,
        chunksize=2000
    )
    print(f"INSERTED {len(df_to_insert):,} rows into '{REFERENCE_TABLE}'")

# 5. HÀM MAIN
if __name__ == "__main__":
    print("=" * 60)
    print("🛡️ MLOps NIDS System — Reference Data Sync Service")
    print("=" * 60)

    # Kết nối tới S3
    try:
        s3 = boto3.client('s3', region_name=AWS_REGION)
        print(f"☁️ [0/4] Connected to AWS S3 (Region: {AWS_REGION})")
    except Exception as e:
        print(f"❌ Cannot connect to AWS S3: {e}")
        sys.exit(1)

    # Kết nối tới PostgreSQL
    db_url = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    try:
        engine = create_engine(db_url)
        print(f"🔗 [0/4] Connected to PostgreSQL at {DB_HOST}:{DB_PORT}/{DB_NAME}")
    except Exception as e:
        print(f"❌ Cannot connect to PostgreSQL: {e}")
        sys.exit(1)

    # Đọc manifest -> Tải CSV -> Update DB
    try:
        manifest = load_manifest_from_s3(s3)
        new_reference_df = load_csv_from_s3(s3, manifest)
        update_reference_table(engine, new_reference_df, manifest)
    except Exception as e:
        print(f"❌ Error during sync process: {e}")
        sys.exit(1)

    print("\n" + "=" * 60)
    print(f"  ✅ Reference Data sync completed!")
    print(f"     New Dataset: {manifest['target_csv']}")
    print(f"     Model Version: {manifest['model_version']}")
    print(f"     detect_drift.py sẽ dùng dataset này làm baseline.")
    print("=" * 60)
