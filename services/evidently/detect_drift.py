# detect_drift.py: Phát hiện Data Drift (Sử dụng Evidently 0.4.15 Stable)
import os
import sys
import json
import mlflow
import requests
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from urllib.parse import urlparse
from datetime import datetime, timezone
from evidently.report import Report
from evidently.metric_preset import DataDriftPreset
from evidently.pipeline.column_mapping import ColumnMapping

# 1. NẠP CẤU HÌNH TỪ BIẾN MÔI TRƯỜNG
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, ".env"))

DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "mlops_paas_db")
DB_HOST_RO = os.getenv("DB_HOST_RO", "postgres")

# PAAS MULTI-TENANT CONFIG
TENANT_ID = os.getenv("TENANT_ID")
MODEL_ID = os.getenv("MODEL_ID")
MODEL_NAME = os.getenv("MODEL_NAME", MODEL_ID)
REFERENCE_DATA_URL = os.getenv("REFERENCE_DATA_URL")
MODEL_URI = os.getenv("MODEL_URI", f"models:/{MODEL_NAME}/Production")
CONTROL_PLANE_WEBHOOK_URL = os.getenv("CONTROL_PLANE_WEBHOOK_URL", "http://control_plane:8000/api/v1/internal/drift-webhook")
CONTROL_PLANE_WEBHOOK_SECRET = os.getenv("CONTROL_PLANE_WEBHOOK_SECRET", "super-secret-key")
HTML_S3_URI = os.getenv("HTML_S3_URI", "")
REPORT_JSON_S3_URI = os.getenv("REPORT_JSON_S3_URI", "")
SUMMARY_JSON_S3_URI = os.getenv("SUMMARY_JSON_S3_URI", "")
HTML_PUBLIC_URL = os.getenv("HTML_PUBLIC_URL", "")

HTML_UPLOAD_URL = os.getenv("HTML_UPLOAD_URL", "")
REPORT_JSON_UPLOAD_URL = os.getenv("REPORT_JSON_UPLOAD_URL", "")
SUMMARY_JSON_UPLOAD_URL = os.getenv("SUMMARY_JSON_UPLOAD_URL", "")

DRIFT_THRESHOLD = float(os.getenv("DRIFT_THRESHOLD", "0.6"))
MAX_SAMPLES = int(os.getenv("MAX_SAMPLES", "100000"))
MIN_SAMPLES = int(os.getenv("MIN_SAMPLES", "100"))

if not 0 <= DRIFT_THRESHOLD <= 1:
    print("CRITICAL ERROR: DRIFT_THRESHOLD must be between 0 and 1.")
    sys.exit(1)

if not TENANT_ID or not MODEL_ID:
    print("CRITICAL ERROR: TENANT_ID and MODEL_ID must be set!")
    sys.exit(1)

# 2. TẢI DỮ LIỆU
def load_reference_data():
    if not REFERENCE_DATA_URL:
        raise ValueError("REFERENCE_DATA_URL is not provided")

    # Xác định đường dẫn file tạm
    reference_path = urlparse(REFERENCE_DATA_URL).path.lower()
    local_filename = f"/tmp/ref_data_{MODEL_NAME}.csv"
    if reference_path.endswith('.parquet'):
        local_filename = f"/tmp/ref_data_{MODEL_NAME}.parquet"

    if REFERENCE_DATA_URL.startswith("http"):
        print(f"[1/4] Downloading from presigned URL to {local_filename}...")
        try:
            response = requests.get(REFERENCE_DATA_URL)
            response.raise_for_status()
            with open(local_filename, "wb") as f:
                f.write(response.content)
        except Exception as e:
            raise Exception(f"Failed to download reference data from URL: {e}")
    else:
        raise ValueError("REFERENCE_DATA_URL must be a valid HTTP URL")
    
    # Đọc file bằng pandas
    if local_filename.endswith('.csv'):
        df = pd.read_csv(local_filename)
    elif local_filename.endswith('.parquet'):
        df = pd.read_parquet(local_filename)
    else:
        # Giả định mặc định là CSV
        df = pd.read_csv(local_filename)
        
    print(f"Reference: {len(df)} rows loaded.")
    return df

def load_production_data_from_db(engine):
    print(f"[2/4] Loading production data from PostgreSQL for Tenant {TENANT_ID}, Model {MODEL_ID}...")
    time_filter = """
        tenant_id = :tenant_id AND model_id = :model_id
        AND "timestamp"::timestamptz >= NOW() - INTERVAL '24 hours'
    """
    with engine.connect() as conn:
        # Tải dữ liệu thực tế (Production Data) trong 24h gần nhất
        count_query = text(f"""
            SELECT COUNT(*) FROM paas_production_logs
            WHERE {time_filter}
        """)
        total_rows = conn.execute(count_query, {"tenant_id": TENANT_ID, "model_id": MODEL_ID}).scalar()
        print(f"Production (24h): {total_rows} rows (total available)")

        if total_rows > MAX_SAMPLES:
            sample_pct = min(100.0, (MAX_SAMPLES / total_rows) * 100 * 1.1)
            print(f"Exceeds MAX_SAMPLES={MAX_SAMPLES}. Fast sampling at ~{sample_pct:.2f}% at DB level...")
            
            # Lưu ý: TABLESAMPLE SYSTEM yêu cầu PostgreSQL. Với JSONB, ta lấy cột features ra.
            production_query = text(f"""
                SELECT features FROM paas_production_logs TABLESAMPLE SYSTEM ({sample_pct})
                WHERE {time_filter}
                ORDER BY "timestamp"::timestamptz DESC
                LIMIT :max_samples
            """)
            raw_df = pd.read_sql(
                production_query, conn, 
                params={"tenant_id": TENANT_ID, "model_id": MODEL_ID, "max_samples": MAX_SAMPLES}
            )
        else:
            raw_df = pd.read_sql(text(f"""
                SELECT features FROM paas_production_logs
                WHERE {time_filter}
                ORDER BY "timestamp"::timestamptz DESC
            """), conn, params={"tenant_id": TENANT_ID, "model_id": MODEL_ID})
            
    # Bung JSONB features
    if len(raw_df) > 0:
        features = raw_df['features'].map(lambda item: json.loads(item) if isinstance(item, str) else item)
        production_df = pd.json_normalize(features)
        del raw_df
        print(f"-> Production data loaded and JSON normalized: {len(production_df)} rows")
        return production_df
    return pd.DataFrame()

# 3. TRÍCH XUẤT COLUMN MAPPING TỪ MLFLOW
def get_column_mapping():
    print(f"[3/4] Extracting Model Signature from MLflow: {MODEL_URI}")
    column_mapping = ColumnMapping()
    if mlflow is None:
        print("MLflow client is not installed in the Evidently image. Evidently will auto-infer column types.")
        return column_mapping

    try:
        model_info = mlflow.models.get_model_info(MODEL_URI)
        signature = model_info.signature
        if signature and signature.inputs:
            num_cols = []
            cat_cols = []
            for inp in signature.inputs:
                if inp.type in ["integer", "long", "float", "double"]:
                    num_cols.append(inp.name)
                else:
                    cat_cols.append(inp.name)
            column_mapping.numerical_features = num_cols
            column_mapping.categorical_features = cat_cols
            print(f"Signature extracted: {len(num_cols)} numerical, {len(cat_cols)} categorical.")
        else:
            print("Warning: No signature found in MLflow. Evidently will auto-infer types.")
    except Exception as e:
        print(f"Failed to extract signature from MLflow: {e}. Evidently will auto-infer types.")
    
    return column_mapping

def filter_column_mapping(column_mapping, common_cols):
    common_set = set(common_cols)
    filtered_mapping = ColumnMapping()

    if column_mapping.numerical_features:
        filtered_mapping.numerical_features = [
            col for col in column_mapping.numerical_features if col in common_set
        ]
    if column_mapping.categorical_features:
        filtered_mapping.categorical_features = [
            col for col in column_mapping.categorical_features if col in common_set
        ]
    if getattr(column_mapping, "target", None) in common_set:
        filtered_mapping.target = column_mapping.target
    if getattr(column_mapping, "prediction", None) in common_set:
        filtered_mapping.prediction = column_mapping.prediction

    return filtered_mapping

def save_drift_report(report, result_dict, summary):
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_dir = f"/tmp/drift_reports/{TENANT_ID}/{MODEL_NAME}/{run_id}"
    os.makedirs(report_dir, exist_ok=True)

    html_path = os.path.join(report_dir, "report.html")
    result_json_path = os.path.join(report_dir, "report.json")
    summary_json_path = os.path.join(report_dir, "summary.json")

    report.save_html(html_path)
    with open(result_json_path, "w", encoding="utf-8") as fp:
        json.dump(result_dict, fp, ensure_ascii=False, indent=2, default=str)
    with open(summary_json_path, "w", encoding="utf-8") as fp:
        json.dump(summary, fp, ensure_ascii=False, indent=2, default=str)

    artifacts = {
        "local_html_path": html_path,
        "local_report_json_path": result_json_path,
        "local_summary_json_path": summary_json_path,
    }

    if not HTML_UPLOAD_URL:
        print("Warning: Upload URLs not provided. Skipping upload.")
        return artifacts

    uploads = [
        (html_path, HTML_UPLOAD_URL, "text/html"),
        (result_json_path, REPORT_JSON_UPLOAD_URL, "application/json"),
        (summary_json_path, SUMMARY_JSON_UPLOAD_URL, "application/json"),
    ]

    for local_path, upload_url, content_type in uploads:
        if upload_url:
            try:
                with open(local_path, "rb") as f:
                    resp = requests.put(upload_url, data=f, headers={"Content-Type": content_type})
                    resp.raise_for_status()
            except Exception as e:
                print(f"Failed to upload {local_path}: {e}")

    artifacts.update({
        "s3_report_prefix": "",
        "html_s3_uri": HTML_S3_URI,
        "report_json_s3_uri": REPORT_JSON_S3_URI,
        "summary_json_s3_uri": SUMMARY_JSON_S3_URI,
        "html_url": HTML_PUBLIC_URL,
    })
    print(f"Drift report uploaded.")

    summary_with_artifacts = {**summary, "report_artifacts": artifacts}
    with open(summary_json_path, "w", encoding="utf-8") as fp:
        json.dump(summary_with_artifacts, fp, ensure_ascii=False, indent=2, default=str)
    
    # Refresh summary.json on S3
    if SUMMARY_JSON_UPLOAD_URL:
        try:
            with open(summary_json_path, "rb") as f:
                resp = requests.put(SUMMARY_JSON_UPLOAD_URL, data=f, headers={"Content-Type": "application/json"})
                resp.raise_for_status()
        except Exception as e:
            print(f"Failed to refresh summary report: {e}")

    return artifacts


# 4. PHÂN TÍCH DATA DRIFT (EVIDENTLY 0.4.15)
def run_drift_analysis(reference_df, production_df, column_mapping):
    print("[4/4] Running Evidently AI Data Drift analysis...")

    # Đảm bảo chỉ so sánh các cột đặc trưng chung giữa hai dataset
    common_cols = [col for col in reference_df.columns if col in production_df.columns]
    if len(common_cols) == 0:
        raise ValueError("No common columns found between reference and production datasets.")
        
    ref_clean = reference_df[common_cols]
    prod_clean = production_df[common_cols]
    filtered_mapping = filter_column_mapping(column_mapping, common_cols)

    try:
        report = Report(metrics=[DataDriftPreset(drift_share=DRIFT_THRESHOLD)])
    except TypeError:
        print("Warning: Evidently DataDriftPreset does not accept drift_share. Applying threshold in summary only.")
        report = Report(metrics=[DataDriftPreset()])
    report.run(reference_data=ref_clean, current_data=prod_clean, column_mapping=filtered_mapping)
    
    result_dict = report.as_dict()
    dataset_drift_metrics = {}
    data_drift_table = {}

    for item in result_dict.get('metrics', []):
        result_data = item.get('result', {})
        if 'dataset_drift' in result_data and 'share_of_drifted_columns' in result_data:
            dataset_drift_metrics = result_data
        if 'drift_by_columns' in result_data:
            data_drift_table = result_data

    drift_share = dataset_drift_metrics.get('share_of_drifted_columns', 0.0)
    drifted_count = dataset_drift_metrics.get('number_of_drifted_columns', 0)
    dataset_drift = drift_share >= DRIFT_THRESHOLD
    
    drifted_feature_names = []
    drift_by_columns = data_drift_table.get('drift_by_columns', {})
    for col_name, col_data in drift_by_columns.items():
        if col_data.get('drift_detected', False):
            drifted_feature_names.append(col_name)

    summary = {
        "tenant_id": TENANT_ID,
        "model_id": MODEL_ID,
        "share_drifted_features": drift_share,
        "dataset_drift": dataset_drift,
        "drift_threshold": DRIFT_THRESHOLD,
        "number_of_drifted_features": drifted_count,
        "number_of_features": len(common_cols),
        "drifted_feature_names": drifted_feature_names,
    }
    summary["report_artifacts"] = save_drift_report(report, result_dict, summary)

    print("SUMMARY OF DATA DRIFT RESULTS")
    print("-" * 60)
    print(f"Total features: {summary['number_of_features']}")
    print(f"Drifted features: {summary['number_of_drifted_features']}")
    print(f"Drift rate: {summary['share_drifted_features']:.2%}")
    drift_status = "DETECTED" if summary["dataset_drift"] else "NOT DETECTED"
    print(f"Dataset drift: {drift_status}")

    return summary


# 5. GỬI KẾT QUẢ VỀ DJANGO WEBHOOK
def trigger_django_webhook(drift_summary):
    print("Triggering Django Webhook...")

    session = requests.Session()
    retry_strategy = Retry(
        total=3, backoff_factor=2,          
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["POST"]  
    )
    session.mount("http://", HTTPAdapter(max_retries=retry_strategy))
    session.mount("https://", HTTPAdapter(max_retries=retry_strategy))

    headers = {
        "Authorization": f"Bearer {CONTROL_PLANE_WEBHOOK_SECRET}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "tenant_id": TENANT_ID,
        "model_id": MODEL_ID,
        "drift_summary": drift_summary,
        "threshold": DRIFT_THRESHOLD
    }

    try:
        response = session.post(CONTROL_PLANE_WEBHOOK_URL, headers=headers, json=payload, timeout=15)
        if response.status_code in [200, 201, 204]:
            print("Webhook sent successfully to Django Control Plane.")
        else:
            print(f"Webhook failed! HTTP {response.status_code}: {response.text}")
    except Exception as e:
        print(f"Failed to send webhook: {e}")


if __name__ == "__main__":
    try:
        reference_df = load_reference_data()
    except Exception as e:
        print(f"Failed to load Reference Data: {e}")
        sys.exit(1)

    db_url = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST_RO}:{DB_PORT}/{DB_NAME}"
    try:
        engine = create_engine(db_url, pool_pre_ping=True)
    except Exception as e:
        print(f"Failed to connect to DB: {e}")
        sys.exit(1)

    try:
        production_df = load_production_data_from_db(engine)
    except Exception as e:
        print(f"Failed to load Production Data: {e}")
        sys.exit(1)

    if len(production_df) < MIN_SAMPLES:
        print(f"Only {len(production_df)} production samples available. Skipping drift analysis.")
        sys.exit(0)  

    column_mapping = get_column_mapping()

    try:
        drift_summary = run_drift_analysis(reference_df, production_df, column_mapping)
    except Exception as e:
        print(f"Drift analysis failed: {e}")
        sys.exit(1)

    trigger_django_webhook(drift_summary)
