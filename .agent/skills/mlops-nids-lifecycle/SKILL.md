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
3. Chạy Kaggle Kernel thông qua Kaggle API (`train.py`), pipeline sẽ tải Data Manifest đẩy model `.pkl` kèm bảng metrics `.json` lên các bucket folder S3 (`models/<version>/`).
4. Tại bước đánh giá Cổng Chất Lượng **Quality Gate** (`evaluate_model.py`), Challenger Metrics (Model Mới tạo) và Champion Metrics (Model Nằm Production) được load về để đối chiếu logic thông minh.
5. Nếu **Approve**: Trigger K3s Rolling Update (`kubectl rollout restart`). Cuối cùng, khép kín vòng lặp MLOps bằng cách tạo **K8s Job (`k8s/sync-job.yaml`)** chạy ngầm trong cụm K3s. Job này sẽ thực thi `update_reference_data.py` để lấy CSV mới chèn vào Postgres làm baseline sạch cho chu kỳ giám sát Data Drift mà KHÔNG cần mở cổng DB ra ngoài Internet.

## 3. Quality Gate (`evaluate_model.py`)

Quy tắc xét duyệt Promotion (Trọng tâm để xem xét log nếu pipeline không cho phép lên Production):

- **Rejection Threshold:** Bất cứ Challenger Model nào có F1-score thấp hơn ngưỡng `< 0.85` sẽ bị Cấn Hồi lập tức, bỏ qua mọi tham số.
- **Capability Upgrade:** Challenger Model phân loại đánh nhãn được nhiều nhãn (classes) tấn công hơn -> Chuyển thành Trạng thái **Approve** ngay lập tức, ngay cả khi F1 tổng có hơi tụt hậu so với Champion (đảm bảo F1 vẫn phải trên 0.85).
- **Head-to-Head:** Lấy Challenger bằng hoặc hơn -> **Approve**. F1 Challenger thấp hơn nhưng nằm trong ngưỡng dung sai Drift-Tolerance `<= 0.01` -> **Approve** (Điều này thể hiện Model mới đang bám sát đúng phân phối thực tế mới). Ngược lại, F1 tụt xa khỏi `0.01` -> **Reject**.
