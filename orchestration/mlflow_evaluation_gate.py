# -*- coding: utf-8 -*-
"""
mlflow_evaluation_gate.py
=========================
Trạm kiểm duyệt (Evaluation Gate) cho MLOps NIDS Pipeline.

Quy trình 4 giai đoạn:
  1. Ghi nhận logic đánh giá 3 quy tắc (giữ nguyên từ .github/scripts/evaluate_model.py)
  2. Kết nối MLflow Tracking Server qua MlflowClient, trích xuất metrics từ SQLite
  3. Đối soát Champion (Production) vs Challenger (Staging) qua evaluate_challenger()
  4. Thực hiện stage transition và kích hoạt webhook nếu được phê duyệt

Author  : MLOps NIDS Team
Version : 1.0.0
"""

import os
import sys
import warnings
import platform
import sqlite3
from typing import Dict, Tuple, Optional

import mlflow
from mlflow.tracking import MlflowClient

warnings.simplefilter(action='ignore', category=FutureWarning)
warnings.warn(
    "Legacy evaluation gate: this script still depends on local SQLite and stage transitions. "
    "It is not aligned with the current public MLflow + alias-based flow.",
    DeprecationWarning,
    stacklevel=2,
)

# ══════════════════════════════════════════════════════════════════════════════
# CẤU HÌNH KẾT NỐI
# ══════════════════════════════════════════════════════════════════════════════

# Đường dẫn tuyệt đối tới thư mục project
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# Xây dựng SQLite URI tương thích Windows/macOS/Linux
# Windows: D:\path\to\db -> sqlite:///D:/path/to/db
# macOS/Linux: /path/to/db -> sqlite:////path/to/db
_db_abs = os.path.abspath(
    os.path.join(PROJECT_ROOT, "mlflow_artifacts", "mlflow.db")
).replace("\\", "/")

if platform.system() == "Windows" and _db_abs[1] == ":":
    _drive, _rest = _db_abs[0], _db_abs[2:]       # "D", "/UIT/..."
    _db_uri = f"sqlite:///{_drive}:{_rest}"       # sqlite:///D:/UIT/...
else:
    _db_uri = f"sqlite:///{_db_abs}"               # sqlite:////path/to/db

MLFLOW_TRACKING_URI = os.environ.get("MLFLOW_TRACKING_URI", _db_uri)
MODEL_NAME = "NIDS-XGBoost"


# ══════════════════════════════════════════════════════════════════════════════
# GIAI ĐOẠN 2: TRÍCH XUẤT DỮ LIỆU TỪ SQLITE
# Dùng SQLite trực tiếp thay vì MlflowClient API để tránh lỗi
# phiên bản (MLflow 3.x đổi API get_metric_history).
# ══════════════════════════════════════════════════════════════════════════════

def _get_db_conn() -> sqlite3.Connection:
    """
    Tạo kết nối SQLite tới MLflow tracking database.
    Chuyển đổi URI sqlite:///path thành đường dẫn file thuần.
    """
    # sqlite:///D:/UIT/.../mlflow.db -> D:/UIT/.../mlflow.db
    return sqlite3.connect(_db_uri.replace("sqlite:///", ""))


def get_run_metrics(run_id: str) -> Dict[str, float]:
    """
    Lấy toàn bộ metrics của một MLflow Run từ bảng 'metrics' trong SQLite.

    Args:
        run_id: UUID của run cần truy vấn.

    Returns:
        Dict {metric_key: metric_value} — tất cả metrics của run.
    """
    conn = _get_db_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT key, value FROM metrics WHERE run_uuid = ?",
        (run_id,)
    )
    result = {row[0]: float(row[1]) for row in cur.fetchall()}
    conn.close()
    return result


def get_run_params(run_id: str) -> Dict[str, str]:
    """
    Lấy toàn bộ params của một MLflow Run từ bảng 'params' trong SQLite.

    Args:
        run_id: UUID của run cần truy vấn.

    Returns:
        Dict {param_key: param_value} — tất cả params của run.
    """
    conn = _get_db_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT key, value FROM params WHERE run_uuid = ?",
        (run_id,)
    )
    result = {row[0]: str(row[1]) for row in cur.fetchall()}
    conn.close()
    return result


# ══════════════════════════════════════════════════════════════════════════════
# GIAI ĐOẠN 2 (tiếp): TRÍCH XUẤT TỪ MODEL REGISTRY
# ══════════════════════════════════════════════════════════════════════════════

def _get_mlflow_client() -> MlflowClient:
    """Khởi tạo MlflowClient với tracking URI đã cấu hình."""
    mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
    return MlflowClient()


def _find_version_by_stage(stage: str) -> Optional[int]:
    """
    Tìm version MỚI NHẤT của model đang ở stage cho trước.

    Khi có nhiều version cùng stage (do nhiều lần đăng ký test),
    lấy version có creation_time lớn nhất (mới nhất).
    Truy vấn trực tiếp SQLite để đảm bảo đúng version.

    Args:
        stage: Tên stage cần tìm (ví dụ: "Production", "Staging").

    Returns:
        Số version (int) nếu tìm thấy, None nếu không có model nào ở stage đó.
    """
    conn = _get_db_conn()
    cur = conn.cursor()
    # Lấy version mới nhất (creation_time lớn nhất) trong stage đó
    cur.execute(
        "SELECT version FROM model_versions "
        "WHERE name = ? AND current_stage = ? AND status = 'READY' "
        "ORDER BY creation_time DESC LIMIT 1",
        (MODEL_NAME, stage)
    )
    row = cur.fetchone()
    conn.close()
    if row:
        return int(row[0])
    return None


def build_model_dict(version: int) -> Dict:
    """
    Trích xuất metrics và params của một model version từ Model Registry.

    Gộp dữ liệu từ hai nguồn:
      - run_id: lấy từ model_versions (qua MlflowClient)
      - metrics/params: lấy trực tiếp từ SQLite (không qua API)

    Args:
        version: Số version của model trong Registry.

    Returns:
        Dict cùng cấu trúc với metrics_v*.json để tương thích evaluate_challenger().
    """
    client = _get_mlflow_client()
    mv = client.get_model_version(MODEL_NAME, version)
    run_id = mv.run_id

    metrics = get_run_metrics(run_id)
    params = get_run_params(run_id)

    return {
        "model_version":       params.get("model_version", str(version)),
        "num_classes":        int(params.get("num_classes", 2)),
        "objective":          params.get("objective", "unknown"),
        "evaluation_metrics": {
            "accuracy":  metrics.get("accuracy",  0.0),
            "precision": metrics.get("precision", 0.0),
            "recall":    metrics.get("recall",     0.0),
            "f1_score":  metrics.get("f1_score",  0.0),
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# GIAI ĐOẠN 1: LOGIC ĐÁNH GIÁ (GIỮ NGUYÊN 100%)
# ══════════════════════════════════════════════════════════════════════════════

def evaluate_challenger(
    champion_metrics: Dict,
    challenger_metrics: Dict,
    
    min_f1: float,
    drift_tolerance: float,
) -> Tuple[bool, str]:
    """
    So sánh Challenger với Champion theo 3 quy tắc ưu tiên:

    1. REJECTION THRESHOLD: Challenger F1 < min_f1 -> Reject ngay, bất kể số class.
    2. CAPABILITY UPGRADE:  Challenger có nhiều class hơn -> Approve
                           (model mới nhận biết nhiều loại tấn công hơn).
    3. HEAD-TO-HEAD:       Cùng số class -> So sánh F1 với drift_tolerance.

    Args:
        champion_metrics:  Dict metrics của model đang production.
        challenger_metrics: Dict metrics của model mới vừa train.
        min_f1: Ngưỡng F1 tối thiểu tuyệt đối để được xét duyệt.
        drift_tolerance: Mức giảm F1 tối đa cho phép khi cùng số class.

    Returns:
        (is_approved, reason_string)
    """
    champ_f1 = champion_metrics.get("evaluation_metrics", {}).get("f1_score", 0.0)
    champ_classes = champion_metrics.get("num_classes", 2)

    chall_f1 = challenger_metrics.get("evaluation_metrics", {}).get("f1_score", 0.0)
    chall_classes = challenger_metrics.get("num_classes", 2)
    chall_version = challenger_metrics.get("model_version", "unknown")

    print("=" * 52)
    print("  [GATE] MLOps NIDS - Model Evaluation Gate")
    print("=" * 52)
    print(f"  [CHAMPION]  F1={champ_f1:.4f}  |  Classes={champ_classes}")
    print(f"  [CHALLENGER] F1={chall_f1:.4f}  |  Classes={chall_classes}  |  ver={chall_version}")
    print(f"  Min F1 threshold : {min_f1}")
    print(f"  Drift tolerance  : {drift_tolerance}")
    print("-" * 52)

    # --- Quy tắc 1: Rejection Threshold ---
    # Nếu F1 của Challenger thấp hơn ngưỡng tối thiểu -> từ chối ngay.
    if chall_f1 < min_f1:
        return False, (
            f"Challenger F1={chall_f1:.4f} is below minimum threshold ({min_f1}). "
            f"Model quality is unacceptable. REJECTED."
        )

    # --- Quy tắc 2: Capability Upgrade ---
    # Nếu Challenger nhận biết được nhiều class hơn Champion -> chấp nhận
    # (năng lực phát hiện tấn công cao hơn, có giá trị thực tế).
    if chall_classes > champ_classes:
        return True, (
            f"Challenger detects MORE attack classes ({chall_classes} > {champ_classes}). "
            f"Capability upgrade with F1={chall_f1:.4f}. APPROVED."
        )

    # --- Quy tắc 3a: Capability Downgrade ---
    # Nếu Challenger nhận biết ít class hơn -> từ chối
    # (đây là sự thoái hóa năng lực, không được phép).
    if chall_classes < champ_classes:
        return False, (
            f"Challenger supports FEWER classes ({chall_classes} < {champ_classes}). "
            f"Capability downgrade is unacceptable. REJECTED."
        )

    # --- Quy tắc 3b: Head-to-Head ---
    # Cùng số class:
    #   - Challenger thắng tuyệt đối (F1 >= Champion) -> Approve.
    #   - Challenger thua nhẹ (F1 drop <= tolerance) nhưng có training data mới -> Approve.
    #   - Challenger thua nặng (F1 drop > tolerance) -> Reject.
    if chall_f1 >= champ_f1:
        return True, (
            f"Challenger OUTPERFORMS Champion: F1 {chall_f1:.4f} >= {champ_f1:.4f}. APPROVED."
        )

    f1_drop = champ_f1 - chall_f1
    if f1_drop <= drift_tolerance:
        return True, (
            f"Challenger F1 slightly lower (drop={f1_drop:.4f} <= tolerance={drift_tolerance}), "
            f"but resolves Data Drift with fresh training data. APPROVED."
        )

    return False, (
        f"Challenger significantly underperforms Champion "
        f"(F1 drop={f1_drop:.4f} > tolerance={drift_tolerance}). REJECTED."
    )


# ══════════════════════════════════════════════════════════════════════════════
# GIAI ĐOẠN 3: THỰC HIỆN STAGE TRANSITION
# ══════════════════════════════════════════════════════════════════════════════

def promote_challenger(challenger_ver: int, champion_ver: Optional[int]):
    """
    Thăng cấp Challenger lên Production và hạ cấp Champion cũ xuống Archived.

    Được gọi khi evaluate_challenger() trả về is_approved=True.

    Args:
        challenger_ver: Version của Challenger được phê duyệt.
        champion_ver:   Version của Champion cũ (có thể None nếu không có).
    """
    client = _get_mlflow_client()

    # Thăng cấp Challenger
    client.transition_model_version_stage(
        MODEL_NAME, challenger_ver, stage="Production"
    )
    print(f"  [ACTION] Challenger v{challenger_ver} -> Production")

    # Hạ cấp Champion cũ (nếu có)
    if champion_ver is not None:
        client.transition_model_version_stage(
            MODEL_NAME, champion_ver, stage="Archived"
        )
        print(f"  [ACTION] Champion v{champion_ver} -> Archived")


def archive_challenger(challenger_ver: int):
    """
    Hạ cấp Challenger xuống Archived và giữ nguyên Champion.

    Được gọi khi evaluate_challenger() trả về is_approved=False.

    Args:
        challenger_ver: Version của Challenger bị từ chối.
    """
    client = _get_mlflow_client()
    client.transition_model_version_stage(
        MODEL_NAME, challenger_ver, stage="Archived"
    )
    print(f"  [ACTION] Challenger v{challenger_ver} -> Archived (REJECTED)")


# ══════════════════════════════════════════════════════════════════════════════
# GIAI ĐOẠN 4: HAM CHÍNH
# ══════════════════════════════════════════════════════════════════════════════

def main():
    """
    Trạm kiểm duyệt (Evaluation Gate) cho MLOps NIDS Pipeline.

    Quy trình:
      1. Tìm Champion (Production) và Challenger (Staging) trong Model Registry.
      2. Nếu chưa có Production nào → Challenger đầu tiên lên Production (lần chạy đầu).
      3. Gọi evaluate_challenger() để đối soát.
      4. Thực hiện stage transition và kích hoạt webhook nếu được phê duyệt.

    Exit codes:
      0 = Approved  (Challenger được deploy)
      1 = Rejected  (Challenger bị từ chối)
    """
    # Đọc ngưỡng từ biến môi trường (mặc định: F1 >= 0.85, drift tolerance = 0.01)
    MIN_F1          = float(os.environ.get("MIN_F1",          "0.85"))
    DRIFT_TOLERANCE = float(os.environ.get("DRIFT_TOLERANCE",  "0.01"))

    print(f"\n{'='*62}")
    print(f"  MLflow Evaluation Gate")
    print(f"  Tracking URI : {MLFLOW_TRACKING_URI}")
    print(f"  Model Name  : {MODEL_NAME}")
    print(f"  Min F1      : {MIN_F1}")
    print(f"  Drift Tol.  : {DRIFT_TOLERANCE}")
    print(f"{'='*62}\n")

    # ── Bước 1: Tìm Champion (Production) ───────────────────────────────
    champion_data, champion_ver = None, None

    try:
        champion_ver = _find_version_by_stage("Production")
    except Exception:
        champion_ver = None

    # ── Trường hợp đặc biệt: Lần chạy đầu tiên ──────────────────────
    # Nếu chưa có model Production nào → Challenger đầu tiên lên Production.
    if champion_ver is None:
        print("[INFO] No Production model found. Looking for Challenger in Staging...")

        challenger_ver = _find_version_by_stage("Staging")
        if challenger_ver is None:
            print("[ERROR] No Challenger (Staging) model found in Model Registry.")
            print("        At least 1 model must be in Staging to begin evaluation.")
            sys.exit(1)

        # Lần chạy đầu tiên: Challenger đầu tiên được thăng cấp Production.
        print(f"\n[FIRST RUN] Challenger v{challenger_ver} -> Production (first model)")
        client = _get_mlflow_client()
        client.transition_model_version_stage(
            MODEL_NAME, challenger_ver, stage="Production"
        )
        print(f"  [ACTION] Challenger v{challenger_ver} -> Production")

        challenger_data = build_model_dict(challenger_ver)
        print()
        print("[GATE] [MÔ PHỎNG] Gửi Webhook dispatch tới GitHub Actions deploy_pipeline")
        print(f"  Model: {MODEL_NAME}/v{challenger_ver} "
              f"| F1={challenger_data['evaluation_metrics']['f1_score']:.4f} "
              f"| Classes={challenger_data['num_classes']}")
        sys.exit(0)

    champion_data = build_model_dict(champion_ver)

    # ── Bước 2: Tìm Challenger (Staging) ────────────────────────────
    challenger_ver = _find_version_by_stage("Staging")
    if challenger_ver is None:
        print("[ERROR] No Challenger (Staging) model found in Model Registry.")
        print("        No new model to evaluate. Evaluation aborted.")
        sys.exit(1)

    challenger_data = build_model_dict(challenger_ver)

    # ── Bước 3: Đối soát Champion vs Challenger ───────────────────
    is_approved, reason = evaluate_challenger(
        champion_metrics=champion_data,
        challenger_metrics=challenger_data,
        min_f1=MIN_F1,
        drift_tolerance=DRIFT_TOLERANCE,
    )

    print(f"\n  RESULT: {reason}")
    print()

    # ── Bước 4: Thực hiện hành động dựa trên kết quả ─────────────
    if is_approved:
        # Challenger được phê duyệt → thăng cấp Production
        print("[GATE] [MÔ PHỎNG] Gửi Webhook dispatch tới GitHub Actions deploy_pipeline")
        promote_challenger(challenger_ver, champion_ver)
        sys.exit(0)
    else:
        # Challenger bị từ chối → hạ xuống Archived
        print("[GATE] Dừng Pipeline - Model mới không đủ điều kiện.")
        archive_challenger(challenger_ver)
        sys.exit(1)


if __name__ == "__main__":
    main()
