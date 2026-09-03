# main.py: Phát hiện Data Drift (Sử dụng Evidently 0.4.15 Stable)
import os
import sys
import json
import logging
import mlflow
import zipfile
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import requests
import redis
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from datetime import datetime, timezone
from evidently.report import Report
from evidently.metric_preset import DataDriftPreset
from evidently.pipeline.column_mapping import ColumnMapping

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, ".env"))

DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "mlops_paas_db")
DB_HOST_RO = os.getenv("DB_HOST_RO", "postgres")

TENANT_ID = os.getenv("TENANT_ID")
PROJECT_ID = os.getenv("PROJECT_ID")
MODEL_VERSION_ID = os.getenv("MODEL_VERSION_ID")
MODEL_NAME = os.getenv("MODEL_NAME", PROJECT_ID)
REFERENCE_DATA_URL = os.getenv("REFERENCE_DATA_URL")
MODEL_URI = os.getenv("MODEL_URI", f"models:/{MODEL_NAME}/Production")
CONTROL_PLANE_WEBHOOK_URL = os.getenv("CONTROL_PLANE_WEBHOOK_URL", "")
CONTROL_PLANE_WEBHOOK_SECRET = os.getenv("CONTROL_PLANE_WEBHOOK_SECRET", "super-secret-key")
HTML_S3_URI = os.getenv("HTML_S3_URI", "")
REPORT_JSON_S3_URI = os.getenv("REPORT_JSON_S3_URI", "")
SUMMARY_JSON_S3_URI = os.getenv("SUMMARY_JSON_S3_URI", "")
HTML_PUBLIC_URL = os.getenv("HTML_PUBLIC_URL", "")
DRIFT_RUN_ID = os.getenv("DRIFT_RUN_ID", os.getenv("JOB_ID", ""))
REDIS_URL = os.getenv("REDIS_URL", "")

HTML_UPLOAD_URL = os.getenv("HTML_UPLOAD_URL", "")
REPORT_JSON_UPLOAD_URL = os.getenv("REPORT_JSON_UPLOAD_URL", "")
SUMMARY_JSON_UPLOAD_URL = os.getenv("SUMMARY_JSON_UPLOAD_URL", "")

DRIFT_THRESHOLD = float(os.getenv("DRIFT_THRESHOLD", "0.6"))
MAX_SAMPLES = int(os.getenv("MAX_SAMPLES", "100000"))
MIN_SAMPLES = int(os.getenv("MIN_SAMPLES", "100"))
TEMP_ROOT = Path(os.getenv("MLOPS_TEMP_DIR", tempfile.gettempdir()))


class RedisLogHandler(logging.Handler):
    """Mirror Evidently stdout/stderr into the per-run Redis log stream."""

    def __init__(self, redis_url: str, run_id: str):
        super().__init__()
        self.redis_client = redis.from_url(redis_url)
        self.log_key = f"drift_logs:{run_id}"
        self.redis_client.delete(self.log_key)

    def emit(self, record):
        try:
            self.redis_client.rpush(self.log_key, self.format(record))
            self.redis_client.expire(self.log_key, 3600)
        except Exception:
            # Logging must never stop a drift run when Redis is unavailable.
            pass


def setup_logger(run_id: str):
    if not run_id or not REDIS_URL:
        return None

    logger = logging.getLogger(f"drift-{run_id}")
    logger.handlers.clear()
    logger.setLevel(logging.INFO)
    logger.propagate = False
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(stdout_handler)
    try:
        redis_handler = RedisLogHandler(REDIS_URL, run_id)
        redis_handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(redis_handler)
    except Exception as exc:
        logger.warning("Could not connect to Redis for drift log streaming: %s", exc)

    class StreamToLogger:
        def __init__(self, target, level):
            self.target = target
            self.level = level

        def write(self, buffer):
            for line in buffer.splitlines():
                if line := line.rstrip():
                    self.target.log(self.level, line)

        def flush(self):
            pass

    sys.stdout = StreamToLogger(logger, logging.INFO)
    sys.stderr = StreamToLogger(logger, logging.ERROR)
    return logger

def validate_runtime_config():
    if not 0 <= DRIFT_THRESHOLD <= 1:
        raise ValueError("DRIFT_THRESHOLD must be between 0 and 1.")
    if not TENANT_ID or not PROJECT_ID or not MODEL_VERSION_ID:
        raise ValueError("TENANT_ID, PROJECT_ID and MODEL_VERSION_ID must be set.")

# 1. Tải Reference Data
def load_reference_data():
    if not REFERENCE_DATA_URL:
        raise ValueError("REFERENCE_DATA_URL is not provided")

    ref_path = urlparse(REFERENCE_DATA_URL).path.lower()
    is_csv = ref_path.endswith(".csv")
    local_filename = str(
        TEMP_ROOT
        / (
            f"reference_{MODEL_VERSION_ID}.csv"
            if is_csv
            else f"reference_{MODEL_VERSION_ID}.parquet"
        )
    )

    if REFERENCE_DATA_URL.startswith("http"):
        print("[2/4] Downloading reference data from presigned URL...")
        response = requests.get(REFERENCE_DATA_URL)
        if response.status_code != 200:
            raise FileNotFoundError(f"Storage returned HTTP {response.status_code}: {response.text[:150]}")
        with open(local_filename, "wb") as f:
            f.write(response.content)
    else:
        local_filename = REFERENCE_DATA_URL

    if local_filename.endswith(".csv"):
        reference_df = pd.read_csv(local_filename)
    else:
        reference_df = pd.read_parquet(local_filename)

    print(f"-> Reference data loaded: {len(reference_df)} rows")
    return reference_df

# 2. Truy vấn dữ liệu Production Data
def load_production_data():
    print(f"[1/4] Fetching Production Logs for Model Version ID: {MODEL_VERSION_ID}")
    
    # Connect to Read-Only Replica
    engine = create_engine(f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST_RO}:{DB_PORT}/{DB_NAME}")
    query = text("""
        SELECT features, prediction
        FROM paas_production_logs
        WHERE model_version_id = :model_version_id
        ORDER BY timestamp DESC
        LIMIT :lim
    """)

    with engine.connect() as conn:
        raw_df = pd.read_sql(
            query,
            conn,
            params={"model_version_id": str(MODEL_VERSION_ID), "lim": MAX_SAMPLES},
        )

    if len(raw_df) < MIN_SAMPLES:
        print(f"Skipping Drift Analysis: Not enough production samples ({len(raw_df)} < {MIN_SAMPLES})")
        return pd.DataFrame()

    # Schema Drift Defense: Flatten JSONB
    if "features" in raw_df.columns:
        features = raw_df["features"].tolist()
        if isinstance(features[0], str):
            features = [json.loads(x) for x in features]

        production_df = pd.json_normalize(features)
        if "prediction" in raw_df.columns:
            production_df["prediction"] = raw_df["prediction"].values
        del raw_df
        print(f"-> Production data loaded and JSON normalized: {len(production_df)} rows")
        return production_df
    return pd.DataFrame()

# Hàm hỗ trợ tải model trên S3
def resolve_model_dir(model_uri):
    if not model_uri or model_uri.startswith("models:/"):
        return None
    if os.path.isdir(model_uri):
        for root, dirs, files in os.walk(model_uri):
            if "MLmodel" in files:
                return root
        return model_uri

    cache_dir = str(TEMP_ROOT / f"model_cache_{MODEL_VERSION_ID}")
    os.makedirs(cache_dir, exist_ok=True)
    zip_path = os.path.join(cache_dir, "model.zip")
    extract_dir = os.path.join(cache_dir, "extracted")

    parsed = urlparse(model_uri)
    if parsed.scheme in ("http", "https"):
        resp = requests.get(model_uri)
        with open(zip_path, "wb") as f:
            f.write(resp.content)
    elif os.path.isfile(model_uri):
        shutil.copyfile(model_uri, zip_path)
    else:
        return model_uri

    if os.path.exists(zip_path) and zipfile.is_zipfile(zip_path):
        safe_extract_zip(zip_path, extract_dir)
        for root, dirs, files in os.walk(extract_dir):
            if "MLmodel" in files:
                return root
        return extract_dir

    return model_uri


def safe_extract_zip(zip_path, destination):
    destination_path = Path(destination)
    destination_path.mkdir(parents=True, exist_ok=True)
    destination_root = destination_path.resolve()
    with zipfile.ZipFile(zip_path, "r") as archive:
        for member in archive.infolist():
            resolved = (destination_path / member.filename).resolve()
            if not resolved.is_relative_to(destination_root):
                raise ValueError("Model archive contains an unsafe path.")
        archive.extractall(destination_path)

# 3. Trích xuất column mapping từ MLFlow
def get_column_mapping(reference_df, production_df):
    print(f"[3/4] Extracting Model Signature from MLflow: {MODEL_URI}")
    column_mapping = ColumnMapping()
    has_signature = False

    if mlflow is not None:
        try:
            resolved_uri = resolve_model_dir(MODEL_URI)
            if resolved_uri:
                print(f"Resolved model directory: {resolved_uri}")
                model_info = mlflow.models.get_model_info(resolved_uri)
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
                    has_signature = True
                    print(f"-> MLflow Signature: {len(num_cols)} numerical, {len(cat_cols)} categorical.")
        except Exception as e:
            print(f"MLflow signature extraction note: {e}")

    # Fallback: Auto-infer feature types from actual DataFrame structure
    if not has_signature:
        print("-> Fallback: Auto-infer feature types from actual DataFrame structure...")
        ignore_cols = {
            "prediction", "target", "Target", "label", "Label", "class", "Class",
            "timestamp", "model_version_id", "project_id", "tenant_id",
        }
        feature_cols = [c for c in production_df.columns if c not in ignore_cols]
        num_cols = production_df[feature_cols].select_dtypes(include=["int64", "float64", "int32", "float32"]).columns.tolist()
        cat_cols = production_df[feature_cols].select_dtypes(include=["object", "category", "bool"]).columns.tolist()
        column_mapping.numerical_features = num_cols
        column_mapping.categorical_features = cat_cols
        print(f"Column: {len(num_cols)} numerical, {len(cat_cols)} categorical.")

    if "prediction" in production_df.columns:
        if "prediction" not in reference_df.columns:
            for cand in ["target", "Target", "label", "Label", "class", "Class"]:
                if cand in reference_df.columns:
                    reference_df["prediction"] = reference_df[cand].values
                    print(f"Mapped column '{cand}' of Reference to 'prediction'.")
                    break
        if "prediction" in reference_df.columns:
            column_mapping.prediction = "prediction"

    for cand in ["target", "Target", "label", "Label", "class", "Class"]:
        if cand in reference_df.columns and cand in production_df.columns:
            column_mapping.target = cand
            break

    return column_mapping

# 4. Lọc column mapping
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

# 5. Phân tích Data drift & Data Quality (Evidently 0.4.15)
def run_drift_analysis(reference_df, production_df, column_mapping):
    print("[4/4] Running Evidently AI Data Drift & Data Quality analysis...")

    ignore_cols = {
        "prediction", "target", "Target", "label", "Label", "class", "Class",
        "timestamp", "created_at", "prediction_id", "id", "model_version_id",
        "project_id", "tenant_id", "endpoint_url", "request_id", "status_code",
        "latency_ms", "confidence", "raw_payload",
    }

    # 1. Xác định tập đặc trưng kỳ vọng từ Reference Data / Column Mapping
    if column_mapping.numerical_features or column_mapping.categorical_features:
        expected_features = set((column_mapping.numerical_features or []) + (column_mapping.categorical_features or []))
    else:
        expected_features = set(c for c in reference_df.columns if c not in ignore_cols)

    production_features = set(c for c in production_df.columns if c not in ignore_cols)

    # 2. Phát hiện bất thường Schema / Data Quality (Missing Features & Extra Features)
    missing_features = sorted(list(expected_features - set(production_df.columns)))
    extra_features = sorted(list(production_features - set(reference_df.columns)))

    if missing_features:
        print(f"⚠️ [DATA QUALITY ALERT] Missing {len(missing_features)} expected features in production: {missing_features}")
    if extra_features:
        print(f"ℹ️ [DATA QUALITY INFO] Found {len(extra_features)} extra features in production: {extra_features}")

    # 3. Lấy các cột chung để chạy kiểm định thống kê Evidently
    common_cols = [col for col in reference_df.columns if col in production_df.columns]
    if len(common_cols) == 0:
        raise ValueError("No common columns found between reference and production datasets.")

    # 4. Kiểm tra tỷ lệ giá trị null bất thường trên các cột chung
    high_null_features = []
    for col in common_cols:
        if col not in ignore_cols and col in production_df.columns:
            null_rate = float(production_df[col].isnull().mean())
            if null_rate >= 0.20:
                high_null_features.append({"feature": col, "null_rate": round(null_rate, 4)})

    if high_null_features:
        print(f"⚠️ [DATA QUALITY WARNING] High null rate (>20%) detected: {high_null_features}")

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

    drift_by_columns = data_drift_table.get('drift_by_columns', {})
    stat_drifted_feature_names = []
    for col_name, col_data in drift_by_columns.items():
        if col_data.get('drift_detected', False):
            stat_drifted_feature_names.append(col_name)

    # 5. Tổng hợp độ trôi dạt tổng thể (Statistical Drift + Missing Features)
    all_drifted_features = sorted(list(set(stat_drifted_feature_names) | set(missing_features)))
    total_expected_count = len(expected_features) if expected_features else len(common_cols)
    total_drifted_count = len(all_drifted_features)
    effective_drift_share = (total_drifted_count / total_expected_count) if total_expected_count > 0 else 0.0

    has_schema_mismatch = len(missing_features) > 0
    dataset_drift = (effective_drift_share >= DRIFT_THRESHOLD) or has_schema_mismatch

    data_quality = {
        "status": "alert" if has_schema_mismatch else ("warning" if high_null_features else "healthy"),
        "has_schema_mismatch": has_schema_mismatch,
        "missing_features": missing_features,
        "missing_features_count": len(missing_features),
        "extra_features": extra_features,
        "extra_features_count": len(extra_features),
        "high_null_features": high_null_features,
        "expected_features_count": total_expected_count,
        "common_features_count": len(common_cols),
    }

    summary = {
        "tenant_id": TENANT_ID,
        "project_id": PROJECT_ID,
        "model_version_id": MODEL_VERSION_ID,
        "share_drifted_features": round(effective_drift_share, 4),
        "drift_score": round(effective_drift_share, 4),
        "dataset_drift": dataset_drift,
        "has_drift": dataset_drift,
        "drift_threshold": DRIFT_THRESHOLD,
        "number_of_drifted_features": total_drifted_count,
        "number_of_features": total_expected_count,
        "drifted_feature_names": all_drifted_features,
        "statistical_drifted_features": stat_drifted_feature_names,
        "missing_features": missing_features,
        "extra_features": extra_features,
        "data_quality": data_quality,
    }
    summary["report_artifacts"] = save_drift_report(report, result_dict, summary)

    print("=" * 60)
    print("SUMMARY OF DATA DRIFT & DATA QUALITY RESULTS")
    print("=" * 60)
    print(f"Total Expected Features      : {total_expected_count}")
    print(f"Common Features Analyzed     : {len(common_cols)}")
    print(f"Statistical Drifted Features : {len(stat_drifted_feature_names)} -> {stat_drifted_feature_names}")
    if missing_features:
        print(f"⚠️ Missing Features (ALERT)  : {len(missing_features)} -> {missing_features}")
    if extra_features:
        print(f"ℹ️ Extra Features            : {len(extra_features)} -> {extra_features}")
    if high_null_features:
        print(f"⚠️ High Null Features        : {[x['feature'] for x in high_null_features]}")
    print(f"Effective Drift Rate         : {effective_drift_share:.2%} (Threshold: {DRIFT_THRESHOLD:.2%})")
    print(f"Dataset Drift Status         : {'DRIFT DETECTED' if dataset_drift else 'NOT DETECTED'}")
    print(f"Data Quality Status          : {data_quality['status'].upper()}")
    print("=" * 60)

    return summary

# 6. Lưu báo cáo drift
def save_drift_report(report, result_dict, summary):
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_dir = str(TEMP_ROOT / "drift_reports" / str(TENANT_ID) / str(MODEL_NAME) / run_id)
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
    print("Drift report uploaded.")

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


# 7. Gửi kết quả về Django Webhook
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
        "project_id": PROJECT_ID,
        "model_version_id": MODEL_VERSION_ID,
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


def main():
    setup_logger(DRIFT_RUN_ID)
    try:
        validate_runtime_config()
    except ValueError as exc:
        print(f"CRITICAL ERROR: {exc}")
        return 1

    try:
        production_df = load_production_data()
    except Exception as e:
        print(f"Failed to load Production Data: {e}")
        return 1

    if len(production_df) < MIN_SAMPLES:
        print(f"Only {len(production_df)} production samples available. Skipping drift analysis.")
        return 0

    try:
        reference_df = load_reference_data()
    except Exception as e:
        print(f"Warning: Reference Data unavailable ({e}). Auto-generating reference baseline from oldest 50% of production data...")
        half_idx = len(production_df) // 2
        reference_df = production_df.iloc[half_idx:].copy()
        production_df = production_df.iloc[:half_idx].copy()  

    column_mapping = get_column_mapping(reference_df, production_df)

    try:
        drift_summary = run_drift_analysis(reference_df, production_df, column_mapping)
    except Exception as e:
        print(f"Drift analysis failed: {e}")
        return 1

    trigger_django_webhook(drift_summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
