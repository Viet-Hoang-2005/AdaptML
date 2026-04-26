# detect_drift.py: Phát hiện Data Drift (Sử dụng Evidently 0.4.15 Stable)
import os
import sys
import json
import requests
import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from evidently.report import Report
from evidently.metric_preset import DataDriftPreset

# 1. NẠP CẤU HÌNH TỪ BIẾN MÔI TRƯỜNG
# Khi chạy local, đọc từ file .env ở thư mục gốc project.
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, ".env"))

# Khi chạy trong K8s CronJob, các biến này được inject từ manifest YAML.
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "mlops_nids_db")

# Chỉ thực hiện thao tác đọc (SELECT) để phân tích Drift -> kết nối đến endpoint READ-ONLY của CloudNativePG.
DB_HOST_RO = os.getenv("DB_HOST_RO", "localhost")

GITHUB_REPO = os.getenv("GITHUB_REPO", "Viet-Hoang-2005/MLOps-nids-system")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")

DRIFT_THRESHOLD = float(os.getenv("DRIFT_THRESHOLD", "0.6"))
MAX_SAMPLES = 100_000

# 2. KẾT NỐI TỚI POSTGRESQL VÀ TẢI DỮ LIỆU
def load_data_from_db(engine):
    print("[1/4] Loading data from PostgreSQL...")

    with engine.connect() as conn:
        # Tải toàn bộ dữ liệu tham chiếu (Reference Data)
        reference_df = pd.read_sql(text("SELECT * FROM nids_reference_data"), conn)
        print(f"Reference: {len(reference_df)} rows")

        # Tải dữ liệu thực tế (Production Data) trong 24h gần nhất
        count_query = text("""
            SELECT COUNT(*) FROM nids_production_data
            WHERE created_at >= NOW() - INTERVAL '24 hours'
        """)
        total_rows = conn.execute(count_query).scalar()
        print(f"Production (24h): {total_rows} rows (total available)")

        # Nếu dữ liệu quá lớn, thực hiện sampling nhanh ở cấp độ DB để tránh tải toàn bộ vào bộ nhớ.
        if total_rows > MAX_SAMPLES:
            sample_pct = min(100.0, (MAX_SAMPLES / total_rows) * 100 * 1.1)
            print(f"Exceeds MAX_SAMPLES={MAX_SAMPLES}. Fast sampling at ~{sample_pct:.2f}% at DB level...")
            
            # Sử dụng TABLESAMPLE SYSTEM để lấy mẫu ngẫu nhiên trực tiếp từ bảng, giảm tải cho ứng dụng.
            production_query = text(f"""
                SELECT * FROM nids_production_data TABLESAMPLE SYSTEM ({sample_pct})
                WHERE created_at >= NOW() - INTERVAL '24 hours'
                LIMIT :max_samples
            """)
            production_df = pd.read_sql(
                production_query, conn, params={"max_samples": MAX_SAMPLES}
            )
            print(f"-> Sample load: {len(production_df)} rows loaded successfully.")
        else:
            production_df = pd.read_sql(text("""
                SELECT * FROM nids_production_data
                WHERE created_at >= NOW() - INTERVAL '24 hours'
            """), conn)
            print(f"-> Full load: {len(production_df)} rows")

    return reference_df, production_df


# 3. TIỀN XỬ LÝ DỮ LIỆU
def preprocess(df):
    # Loại bỏ các cột metadata không liên quan đến phân tích drift, chỉ giữ lại các cột đặc trưng (features).
    METADATA_COLS = ["id", "created_at", "Predicted_Label", "Confidence_Score"]
    feature_cols = [c for c in df.columns if c not in METADATA_COLS]
    return df[feature_cols].copy()


# 4. PHÂN TÍCH DATA DRIFT (EVIDENTLY 0.4.15)
def run_drift_analysis(reference_df, production_df):
    print("[2/4] Running Evidently AI Data Drift analysis (v0.4.15)...")

    ref_clean = preprocess(reference_df)
    prod_clean = preprocess(production_df)

    # Đảm bảo chỉ so sánh các cột đặc trưng chung giữa hai dataset để tránh lỗi do sự khác biệt về schema.
    common_cols = [col for col in ref_clean.columns if col in prod_clean.columns]
    ref_clean = ref_clean[common_cols]
    prod_clean = prod_clean[common_cols]
    total_features = len(common_cols)

    if total_features == 0:
        raise ValueError("No common columns found between reference and production datasets.")

    # Cấu hình Report với preset DataDriftPreset để thu thập cả tỷ lệ drift tổng thể và chi tiết từng cột.
    report = Report(metrics=[DataDriftPreset()])
    
    # Chạy phân tích drift, Evidently sẽ tự động tính toán và lưu trữ kết quả trong cấu trúc nội bộ của Report.
    report.run(reference_data=ref_clean, current_data=prod_clean)
    result_dict = report.as_dict()
    
    dataset_drift_metrics = {}
    data_drift_table = {}

    # Quét toàn bộ mảng metrics để hứng đủ 2 block kết quả
    for item in result_dict.get('metrics', []):
        result_data = item.get('result', {})
        
        # Hứng Block chứa tỷ lệ Drift tổng thể
        if 'dataset_drift' in result_data and 'share_of_drifted_columns' in result_data:
            dataset_drift_metrics = result_data
            
        # Hứng Block chứa chi tiết từng cột
        if 'drift_by_columns' in result_data:
            data_drift_table = result_data

    # Trích xuất các chỉ số chính từ Block DataDriftPreset
    drift_share = dataset_drift_metrics.get('share_of_drifted_columns', 0.0)
    drifted_count = dataset_drift_metrics.get('number_of_drifted_columns', 0)

    # Trích xuất danh sách tên cột (features) từ Block DataDriftTable
    drifted_feature_names = []
    drift_by_columns = data_drift_table.get('drift_by_columns', {})
    
    # Duyệt qua từng cột trong kết quả chi tiết để xác định cột nào bị Drift và thu thập tên của chúng.
    for col_name, col_data in drift_by_columns.items():
        if col_data.get('drift_detected', False):
            drifted_feature_names.append(col_name)

    summary = {
        "share_drifted_features": drift_share,
        "dataset_drift": dataset_drift_metrics.get('dataset_drift', False),
        "number_of_drifted_features": drifted_count,
        "number_of_features": total_features,
        "drifted_feature_names": drifted_feature_names,
    }

    print("\n" + "="*50)
    print("📊   SUMMARY OF DATA DRIFT RESULTS (v0.4.15)")
    print("-" * 50)
    print(f"Total features: {summary['number_of_features']}")
    print(f"Drifted features: {summary['number_of_drifted_features']}")
    print(f"Drift rate: {summary['share_drifted_features']:.2%}")

    if drifted_feature_names:
        print(f"Drifted feature names: \n  - " + "\n  - ".join(drifted_feature_names))
    else:
        print("Drifted feature names: []")

    drift_status = "DETECTED" if summary["dataset_drift"] else "NOT DETECTED"
    print(f"Dataset drift: {drift_status}")
    print("="*50 + "\n")

    return summary


# 5. KÍCH HOẠT GITHUB ACTIONS VIA WEBHOOK
def trigger_github_webhook(drift_summary):
    print("[4/4] DRIFT DETECTED! Triggering GitHub alert workflow...")

    if not GITHUB_TOKEN:
        print("⚠️ GITHUB_TOKEN not configured - skipping webhook.")
        return

    # Thiết lập session với retry strategy để tăng độ bền khi gửi webhook, tránh lỗi tạm thời do mạng hoặc GitHub.
    session = requests.Session()
    retry_strategy = Retry(
        total=3,
        backoff_factor=2,          
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["POST"]  
    )
    session.mount("https://", HTTPAdapter(max_retries=retry_strategy))

    url = f"https://api.github.com/repos/{GITHUB_REPO}/dispatches"
    
    # Phase 1 chỉ gửi alert cho Data Engineer. Retrain chỉ được khởi động khi
    # data_manifest.json thay đổi bởi Data Engineer trên S3.
    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
    }
    payload = {
        "event_type": "drift_alert_required",
        "client_payload": {
            "drift_share": drift_summary["share_drifted_features"],
            "drifted_features": drift_summary["number_of_drifted_features"],
            "threshold": DRIFT_THRESHOLD,
            "drifted_feature_names": drift_summary["drifted_feature_names"],
        }
    }

    response = session.post(url, headers=headers, data=json.dumps(payload), timeout=15)

    if response.status_code == 204:
        print("✅ Webhook sent successfully! GitHub Actions has been triggered.")
    else:
        print(f"❌ Webhook failed! HTTP {response.status_code} after 3 retries: {response.text}")
        sys.exit(1)


# CHƯƠNG TRÌNH CHÍNH
if __name__ == "__main__":
    print("=" * 50)
    print("🛡️   MLOps NIDS System - Data Drift Detection Service")
    print("=" * 50)

    # Kết nối đến endpoint READ-ONLY của CloudNativePG để không tạo tải cho Primary.
    db_url = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST_RO}:{DB_PORT}/{DB_NAME}"
    try:
        engine = create_engine(
            db_url,
            pool_pre_ping=True,
            pool_recycle=1800,
            isolation_level="READ COMMITTED"  
        )
        print(f"[0/4] Connected to PostgreSQL (RO) at {DB_HOST_RO}:{DB_PORT}/{DB_NAME}")
    except Exception as e:
        print(f"❌ Failed to connect: {e}")
        sys.exit(1)

    # Tải dữ liệu tham chiếu và sản xuất, với cơ chế sampling nhanh nếu dữ liệu quá lớn để đảm bảo hiệu suất.
    try:
        reference_df, production_df = load_data_from_db(engine)
    except Exception as e:
        print(f"❌ Failed to load data: {e}")
        sys.exit(1)

    # Kiểm tra xem có đủ dữ liệu production để phân tích drift không.
    MIN_SAMPLES = 100  
    if len(production_df) < MIN_SAMPLES:
        print(f"⚠️ Only {len(production_df)} production samples available (minimum: {MIN_SAMPLES}). Skipping drift analysis.")
        sys.exit(0)  

    # Chạy phân tích drift và đánh giá kết quả để quyết định có cần kích hoạt retrain pipeline hay không.
    try:
        drift_summary = run_drift_analysis(reference_df, production_df)
    except Exception as e:
        print(f"❌ Drift analysis failed: {e}")
        import traceback
        traceback.print_exc()  
        sys.exit(1)

    print(f"[3/4] Evaluating results (threshold: {DRIFT_THRESHOLD:.0%})...")
    if drift_summary["dataset_drift"]:
        trigger_github_webhook(drift_summary)
    else:
        share = drift_summary["share_drifted_features"]
        print(f"✅ Drift rate {share:.2%} is below the allowed threshold. System is stable.")
