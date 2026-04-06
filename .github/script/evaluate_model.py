# evaluate_model.py: So sánh hiệu năng giữa Champion và Challenger model.
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
        print(f"❌ Error: Cannot find metrics file at '{filepath}'")
        sys.exit(1)
    except json.JSONDecodeError:
        print(f"❌ Error: Invalid JSON format in '{filepath}'")
        sys.exit(1)

# Hàm so sánh hiệu năng giữa Champion và Challenger model
def evaluate_challenger( champion_metrics: Dict, challenger_metrics: Dict, min_f1: float, drift_tolerance: float) -> Tuple[bool, str]:
    """
    So sánh Challenger với Champion theo 3 quy tắc ưu tiên:

    1. REJECTION THRESHOLD: Challenger F1 < min_f1 -> Reject ngay, bất kể số class.
    2. CAPABILITY UPGRADE:  Challenger có nhiều class hơn -> Approve (model mới nhận biết
                            nhiều loại tấn công hơn, có giá trị hơn dù F1 nhỉnh hơn).
    3. HEAD-TO-HEAD:        Cùng số class -> So sánh F1. Cho phép giảm tối đa drift_tolerance.

    Args:
        champion_metrics  : Dict metrics của model đang production.
        challenger_metrics: Dict metrics của model mới vừa train.
        min_f1            : Ngưỡng F1 tối thiểu tuyệt đối để được xét duyệt.
        drift_tolerance   : Mức giảm F1 tối đa cho phép khi cùng số class.

    Returns:
        (is_approved, reason_string)
    """
    champ_f1 = champion_metrics.get("evaluation_metrics", {}).get("f1_score", 0.0)
    champ_classes = champion_metrics.get("num_classes", 2)

    chall_f1 = challenger_metrics.get("evaluation_metrics", {}).get("f1_score", 0.0)
    chall_classes = challenger_metrics.get("num_classes", 2)
    chall_version = challenger_metrics.get("model_version", "unknown")

    print("=" * 55)
    print("      MLOps NIDS — Model Evaluation Gate")
    print("=" * 55)
    print(f"  🥇 Champion:           F1={champ_f1:.4f}  |  Classes={champ_classes}")
    print(f"  🚀 Challenger ({chall_version}):  F1={chall_f1:.4f}  |  Classes={chall_classes}")
    print(f"  Min F1 threshold:   {min_f1}")
    print(f"  Drift tolerance:    {drift_tolerance}")
    print("-" * 55)

    # Quy tắc 1: Không cho phép các model có F1 < min_f1
    if chall_f1 < min_f1:
        return False, (
            f"Challenger F1={chall_f1:.4f} is below minimum threshold ({min_f1}). "
            f"Model quality is unacceptable. REJECTED."
        )

    # Quy tắc 2: Capability Upgrade: nhiều class hơn -> giá trị thực tế cao hơn
    if chall_classes > champ_classes:
        return True, (
            f"Challenger detects MORE attack classes ({chall_classes}) than Champion ({champ_classes}). "
            f"Capability upgrade with F1={chall_f1:.4f}. APPROVED."
        )

    # Quy tắc 3a: Từ chối nếu Challenger ít class hơn (thoái hóa năng lực)
    if chall_classes < champ_classes:
        return False, (
            f"Challenger supports FEWER classes ({chall_classes} < {champ_classes}). "
            f"Capability downgrade is unacceptable. REJECTED."
        )

    # Quy tắc 3b: Head-to-Head: nếu cùng số class, so sánh F1 với tolerance
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


if __name__ == "__main__":
    # Khởi tạo ArgumentParser để xử lý các tham số dòng lệnh
    parser = argparse.ArgumentParser(
        description="🛡️ MLOps NIDS — Champion vs Challenger Model Evaluation"
    )
    parser.add_argument("--champion", type=str, required=True, help="Path to Champion metrics JSON")
    parser.add_argument("--challenger", type=str, required=True, help="Path to Challenger metrics JSON")
    parser.add_argument("--min-f1", type=float, default=0.85, help="Minimum acceptable F1-Score (default: 0.85)")
    parser.add_argument("--drift-tolerance", type=float, default=0.01, help="Max allowed F1 drop when same num_classes (default: 0.01)")
    args = parser.parse_args()

    champ_data = load_metrics(args.champion)
    chall_data = load_metrics(args.challenger)

    # Chạy đánh giá: sử dụng đúng tham số từ CLI thay vì hardcode
    is_approved, reason = evaluate_challenger(
        champion_metrics=champ_data,
        challenger_metrics=chall_data,
        min_f1=args.min_f1,
        drift_tolerance=args.drift_tolerance,
    )

    print(f"\n RESULT: {reason}")

    # Xuất kết quả dạng JSON để pipeline có thể đọc (upload lên Artifacts)
    result_summary = {
        "approved": is_approved,
        "reason": reason,
        "champion_version": champ_data.get("model_version", "unknown"),
        "champion_f1": champ_data.get("evaluation_metrics", {}).get("f1_score", 0.0),
        "champion_classes": champ_data.get("num_classes", 0),
        "challenger_version": chall_data.get("model_version", "unknown"),
        "challenger_f1": chall_data.get("evaluation_metrics", {}).get("f1_score", 0.0),
        "challenger_classes": chall_data.get("num_classes", 0),
        "min_f1_threshold": args.min_f1,
        "drift_tolerance": args.drift_tolerance,
    }
    with open("evaluation_result.json", "w") as f:
        json.dump(result_summary, f, indent=2)
    print("📄 Saved detailed result -> evaluation_result.json")

    # Kết quả: exit(0) = APPROVE deploy, exit(1) = REJECT deploy.
    if is_approved:
        print("\n✅ DECISION: PROCEED TO DEPLOYMENT")
        sys.exit(0)
    else:
        print("\n❌ DECISION: DEPLOYMENT BLOCKED")
        sys.exit(1)
