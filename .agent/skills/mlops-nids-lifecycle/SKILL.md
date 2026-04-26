---
name: mlops-nids-lifecycle
description: Vòng đời của mô hình Machine Learning, từ Retraining, Cổng chất lượng (Quality Gate), cho đến khi được tự động triển khai.
---

# Luồng Vòng Đời Mô Hình (Continuous Training & Deployment)

Khi cấu hình hoặc sửa lỗi Pipeline tự động của MLOps NIDS, luôn tuân thủ nguyên tắc sau:

## 1. Nguồn Sự Thật Duy Nhất (Single Source of Truth)

File manifest JSON trên thư mục gốc của S3 (`s3://mlops-nids-artifacts/data_manifest.json`) chỉ định dataset hiện tại đang làm chuẩn (`target_csv`) và các phiên bản của mô hình. Trong đó:

- `model_version`: Hướng dẫn pipeline huấn luyện và đặt tên bản weight mới.
- `champion_version`: Hướng dẫn pipeline quá trình Evalutate Models rút kết quả cũ với mới.  
  Pipeline GitHub Actions của dự án luôn khởi đầu từ việc lấy parameters bằng Manifest này.

2. **Tái Huấn Luyện (Retraining Pipeline: `retrain_pipeline.yml`)**

Quy trình End-to-End:

1. Trigger khởi chạy thông qua webhook event từ Evidently (Data Drift) hoặc AWS Lambda (Data Engineer upload dữ liệu mới lên S3). Mọi hoạt động đều là Event-Driven.
2. Download file cấu hình Data Manifest S3.
3. Chạy Kaggle Kernel thông qua Kaggle API (`train.py`). Pipeline sẽ tự động ném metrics và model (`.pkl`) vào MLflow.
4. **Phê duyệt Human-in-the-Loop (HitL)**: Thay vì duyệt tự động bằng script, quá trình phê duyệt chất lượng được chuyển lên Giao diện Web của **MLflow Registry**. AI Engineer đánh giá và chuyển Stage của mô hình mong muốn sang `Production`.
5. Script `dispatch_production_model.py` tóm được Webhook, trích xuất `RUN_ID`, `EXPERIMENT_ID` và gửi cho GitHub Actions kích hoạt K3s Rolling Update. Cuối cùng, một Job đồng bộ Reference Data cũng được kích hoạt ngầm để hỗ trợ phát hiện Data Drift.

## 3. Quản lý Version (MLflow Model Registry)

Quy tắc xét duyệt Promotion:

- **Tracking:** Mọi tham số từ Kaggle đều được bắn về MLflow (Live Tracking).
- **Staging/Pending:** Mô hình mới sinh ra luôn nằm ở trạng thái Staging/Pending.
- **Production (HitL):** AI Engineer xem biểu đồ trên MLflow, so sánh các Run, và bấm chọn "Transition to Production" nếu thấy thỏa mãn tiêu chuẩn. Đây là điểm cắt (Decoupling) hoàn hảo giữa Training và Deployment. Hệ thống là kiến trúc **Phương án A+** với MLflow làm Kho bãi và GitHub làm Nhạc trưởng điều phối K8s.
