# evaluate_model.py: Script đánh giá và so sánh hiệu năng giữa Champion và Challenger model.
import sys
import json
import argparse
from typing import Dict, Tuple

# Hàm load metrics từ file JSON
def load_metrics(filepath: str) -> Dict:
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"❌ Error: Cannot find {filepath}")
        sys.exit(1)
    except json.JSONDecodeError:
        print(f"❌ Error: Invalid JSON in {filepath}")
        sys.exit(1)

# Hàm so sánh hiệu năng giữa Champion và Challenger model
def evaluate_challenger(champion_metrics: Dict, challenger_metrics: Dict, min_f1: float, drift_tolerance: float) -> Tuple[bool, str]:
    # Lấy thông tin từ Champion model
    champ_f1 = champion_metrics.get("evaluation_metrics", {}).get("f1_score", 0.0)
    champ_classes = champion_metrics.get("num_classes", 2)
    
    # Lấy thông tin từ Challenger model
    chall_f1 = challenger_metrics.get("evaluation_metrics", {}).get("f1_score", 0.0)
    chall_classes = challenger_metrics.get("num_classes", 2)
    chall_version = challenger_metrics.get("model_version", "v2")

    # In thông tin so sánh
    print("=== MLOps Model Evaluation ===")
    print(f"🥇 Champion (v1): F1-Score = {champ_f1:.4f} | Classes = {champ_classes}")
    print(f"🚀 Challenger ({chall_version}): F1-Score = {chall_f1:.4f} | Classes = {chall_classes}")
    print("--------------------------------")

    # Kiểm tra F1-Score có đạt ngưỡng tối thiểu không
    if chall_f1 < 0.85:
        return False, f"Challenger F1-Score ({chall_f1:.4f}) is below minimum acceptable threshold (0.85). REJECTED."

    # Ưu tiên model có nhiều nhãn attack classes hơn
    if chall_classes > champ_classes:
        return True, f"Challenger supports MORE attack classes ({chall_classes}) than Champion ({champ_classes}). Even with F1={chall_f1:.4f}, it is APPROVED for deployment."

    # Nếu số lượng attack classes bằng nhau
    if chall_classes == champ_classes:
        # Chấp nhận model mới nếu F1-Score của Challenger >= F1-Score của Champion
        if chall_f1 >= champ_f1:
            return True, f"Challenger OUTPERFORMS Champion in F1-Score ({chall_f1:.4f} >= {champ_f1:.4f}). APPROVED."
        
        # Chấp nhận model mới nếu F1-Score của Challenger giảm nhẹ nhưng vẫn trong ngưỡng cho phép
        f1_diff = champ_f1 - chall_f1
        if f1_diff <= 0.01:
            return True, f"Challenger F1-Score is slightly lower (drop={f1_diff:.4f}) but fixes Data Drift. APPROVED."
        
        # Từ chối model mới nếu F1-Score của Challenger giảm đáng kể
        return False, f"Challenger significantly UNDERPERFORMS Champion (drop={f1_diff:.4f}). REJECTED."

    # Từ chối model mới nếu số lượng attack classes ít hơn
    return False, f"Challenger supports FEWER classes ({chall_classes} < {champ_classes}). CRITICAL FAILURE. REJECTED."

if __name__ == "__main__":
    # Khởi tạo ArgumentParser để xử lý các tham số dòng lệnh
    parser = argparse.ArgumentParser(description="Evaluate competing XGBoost Models")

    parser.add_argument("--champion", type=str, required=True, help="Path to Champion metrics") # Đường dẫn đến file metrics của Champion model
    parser.add_argument("--challenger", type=str, required=True, help="Path to Challenger metrics") # Đường dẫn đến file metrics của Challenger model
    parser.add_argument("--min-f1", type=float, default=0.85, help="Minimum acceptable F1-Score") # Ngưỡng F1-Score tối thiểu
    parser.add_argument("--drift-tolerance", type=float, default=0.01, help="Acceptable F1 drop margin") # Ngưỡng chấp nhận F1 drop
    
    # Parse các tham số dòng lệnh
    args = parser.parse_args()

    # Load metrics từ file JSON
    champ_data = load_metrics(args.champion)
    chall_data = load_metrics(args.challenger)

    # So sánh hiệu năng giữa Champion và Challenger model
    is_approved, reason = evaluate_challenger(champ_data, chall_data, args.min_f1, args.drift_tolerance)

    print(f"\n=> RESULT: {reason}")
    if is_approved:
        print("✅ PROCEED TO DEPLOYMENT")
        sys.exit(0)
    else:
        print("❌ DEPLOYMENT BLOCKED")
        sys.exit(1)
