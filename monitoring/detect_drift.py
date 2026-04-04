# detect_drift.py: Phát hiện Data Drift giữa tập reference và production
import os
import sys
import json
import requests
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

from evidently import Report
from evidently.presets import DataDriftPreset
from evidently.metrics import DatasetDriftMetric

# 1. NẠP CẤU HÌNH TỪ BIẾN MÔI TRƯỜNG
# Khi chạy trong K8s CronJob, các biến này được inject từ manifest YAML.
# Khi chạy local, chúng được đọc từ file .env ở thư mục gốc project.
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, '.env'))

DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "mlops_nids_db")

# Ngưỡng phát hiện drift: Nếu tỷ lệ feature bị drift >= giá trị này thì kích hoạt cảnh báo.
# Mặc định 50%, override bằng env var DRIFT_THRESHOLD trong CronJob YAML.
DRIFT_THRESHOLD = float(os.getenv("DRIFT_THRESHOLD", "0.5"))

# Thông tin GitHub để kích hoạt CI/CD Pipeline tự động
GITHUB_REPO  = os.getenv("GITHUB_REPO", "github-username/mlops-nids-system")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")

# 2. KẾT NỐI DATABASE VÀ TẢI DỮ LIỆU
def load_data_from_db(engine) -> tuple[pd.DataFrame, pd.DataFrame]:
    print("📥 [1/4] Loading data from PostgreSQL...")

    with engine.connect() as conn:
        # Tải reference data (toàn bộ tập mẫu chuẩn)
        reference_df = pd.read_sql(
            text("SELECT * FROM nids_reference_data"),
            conn
        )

        # Tải production data 24 giờ gần nhất để phân tích xu hướng drift hàng ngày
        production_df = pd.read_sql(
            text("""
                SELECT * FROM nids_production_data
                WHERE created_at >= NOW() - INTERVAL '24 hours'
                ORDER BY created_at ASC
            """),
            conn
        )

    print(f"Reference Data: {len(reference_df)} sample")
    print(f"Production Data (24h): {len(production_df)} sample")
    return reference_df, production_df


# 3. TIỀN XỬ LÝ DỮ LIỆU TRƯỚC KHI SO SÁNH
def preprocess(df: pd.DataFrame) -> pd.DataFrame:
    # Loại bỏ các cột metadata không phải feature mạng trước khi đưa vào Evidently.
    METADATA_COLS = ['id', 'created_at', 'Predicted_Label', 'Confidence_Score']
    feature_cols = [c for c in df.columns if c not in METADATA_COLS]
    return df[feature_cols].copy()


# 4. PHÂN TÍCH DATA DRIFT BẰNG EVIDENTLY AI
def run_drift_analysis(reference_df: pd.DataFrame, production_df: pd.DataFrame) -> dict:
    """
    Chạy báo cáo DataDriftPreset của Evidently AI.

    DataDriftPreset sử dụng kiểm định thống kê (VD: Kolmogorov-Smirnov cho feature
    liên tục, Chi-Square cho feature phân loại) để đo xem phân phối của production
    data có bị lệch so với reference data không.

    Trả về dictionary chứa:
    - share_drifted_features: Tỷ lệ feature bị drift (0.0 ~ 1.0)
    - dataset_drift: True/False - cờ kết luận tổng thể của Evidently
    - number_of_drifted_features: Số lượng feature bị drift
    """
    print("🔬 [2/4] Running Data Drift analysis using Evidently AI...")

    ref_clean  = preprocess(reference_df)
    prod_clean = preprocess(production_df)

    # Chỉ giữ lại các cột xuất hiện trong cả 2 tập để tránh lỗi schema mismatch
    common_cols = [col for col in ref_clean.columns if col in prod_clean.columns]
    ref_clean  = ref_clean[common_cols]
    prod_clean = prod_clean[common_cols]

    # Khởi tạo báo cáo với 2 metric
    report = Report(metrics=[
        DataDriftPreset(), # DataDriftPreset: Kiểm tra từng feature riêng lẻ
        DatasetDriftMetric(drift_share=DRIFT_THRESHOLD) # DatasetDriftMetric: Kết luận tổng thể cho cả dataset
    ])

    report.run(reference_data=ref_clean, current_data=prod_clean)

    # Trích xuất kết quả dạng JSON để xử lý
    result_json = report.as_dict()
    drift_metrics = result_json['metrics'][1]['result']

    summary = {
        "share_drifted_features": drift_metrics.get("share_drifted_features", 0.0),
        "dataset_drift": drift_metrics.get("dataset_drift", False),
        "number_of_drifted_features": drift_metrics.get("number_of_drifted_features", 0),
        "number_of_features": drift_metrics.get("number_of_features", 0),
    }

    print("\n" + "="*60)
    print("📊 SUMMARY OF DATA DRIFT RESULTS")
    print("="*60)
    print(f"Total features: {summary['number_of_features']}")
    print(f"Drifted features: {summary['number_of_drifted_features']}")
    print(f"Drift rate: {summary['share_drifted_features']:.2%}")
    print(f"Dataset Drift: {'YES' if summary['dataset_drift'] else 'NO'}")

    return summary


# 5. KÍCH HOẠT GITHUB ACTIONS VIA WEBHOOK
def trigger_github_webhook(drift_summary: dict):
    """
    Gửi tín hiệu POST đến GitHub API để kích hoạt sự kiện `repository_dispatch`.
    Sự kiện này sẽ kích hoạt workflow `retrain_pipeline.yml` với loại sự kiện
    `data_drift_detected`, khởi động quá trình tái huấn luyện tự động.
    """
    print("🚨 [3/4] Data Drift detected! Sending Webhook to GitHub...")

    url = f"https://api.github.com/repos/{GITHUB_REPO}/dispatches"
    
    # Header chứa GitHub Token để xác thực
    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
    }

    # Payload chứa thông tin về data drift
    payload = {
        "event_type": "data_drift_detected",
        "client_payload": {
            "drift_share": drift_summary["share_drifted_features"],
            "drifted_features": drift_summary["number_of_drifted_features"],
            "threshold": DRIFT_THRESHOLD
        }
    }

    response = requests.post(url, headers=headers, data=json.dumps(payload), timeout=15)

    if response.status_code == 204:
        print("✅ Webhook sent successfully! GitHub Actions has been triggered.")
    else:
        print(f"❌ Webhook failed! HTTP {response.status_code}: {response.text}")


# 6. ĐIỂM CHẠY CHÍNH (MAIN)
if __name__ == "__main__":
    print("=" * 55)
    print("🛡️ MLOps NIDS System — Data Drift Detection Service")
    print("=" * 55)

    # Kết nối Database
    db_url = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
    try:
        engine = create_engine(db_url)
        print(f"🔗 [0/4] Connected to PostgreSQL at {DB_HOST}:{DB_PORT}/{DB_NAME}")
    except Exception as e:
        print(f"❌ Cannot connect to database: {e}")
        sys.exit(1)

    # Tải dữ liệu reference và production
    try:
        reference_df, production_df = load_data_from_db(engine)
    except Exception as e:
        print(f"❌ Error loading data: {e}")
        sys.exit(1)

    # Kiểm tra số lượng production data đủ để phân tích không
    MIN_SAMPLES = 100 # Cần ít nhất 100 mẫu để kết quả thống kê có ý nghĩa
    if len(production_df) < MIN_SAMPLES:
        print(f"⚠️ [SKIP] Only {len(production_df)} production samples (need at least {MIN_SAMPLES}). Skipping analysis.")
        sys.exit(0)

    # Chạy phân tích Drift
    try:
        drift_summary = run_drift_analysis(reference_df, production_df)
    except Exception as e:
        print(f"❌ Error running Evidently: {e}")
        sys.exit(1)

    # Ra quyết định dựa trên ngưỡng
    print(f"\n ⚖️ [4/4] Evaluating the results (Warning threshold: {DRIFT_THRESHOLD:.0%})...")
    if drift_summary["dataset_drift"]:
        trigger_github_webhook(drift_summary)
    else:
        share = drift_summary['share_drifted_features']
        print(f"✅ Drift rate {share:.2%} is below the allowed threshold. System is stable.")