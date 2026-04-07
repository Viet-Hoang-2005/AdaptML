---
name: MLOps NIDS Monitoring
description: Phương pháp tính toán Error / Drift và logic của Webhook.
---

# Data Drift Monitoring bằng Evidently AI

Script giám sát trạng thái Data Drift tĩnh `monitoring/detect_drift.py` được đóng gói trong Docker Container và Deploy dưới dạng hệ thống K3s `CronJob`. Chạy phân tích vào đúng 0h00 hàng ngày theo khung giờ UTC.

## 1. Bối Cảnh So Sánh
- **Reference Data (Baseline):** Lưu trữ trong bảng `nids_reference_data`. Bảng này tự động được Clean và làm mới hoàn toàn bằng dữ liệu của tập Train S3 thông qua Github Action script tên `update_reference_data.py`. Đây là một Feedback Loop.
- **Production Data (Latest):** Lưu trữ trong bảng `nids_production_data`. Chứa các dòng log do FastAPI ghi ra trong khoảng 24h qua trong lúc System Production hoạt động.
- Để so sánh phân phối toán học được diễn ra, script Automatically DROP (bỏ qua) các Metadata Columns như `id`, `created_at` hoặc `Confidence_Score` để không làm nhiễu kết quả. Phân tích cả độ lệch tập Network features và độ lệch của nhãn Prediction `Predicted_Label` vs `Label` thật.

## 2. Threshold và Lọc Nghĩa (Semantic Limits)
- Tiêu đề **`DataDriftPreset`** của Evidently được nhúng vào hệ thống. Xây dựng nền bằng Test KS-Test cho feature liên tục (Continuous), và Chi-Square cho nhãn Categorical.
- Biến môi trường ngưỡng cảnh báo `DRIFT_THRESHOLD`: Mặc định xét mức độ Error là `0.5` (50% features bị drift sẽ Alert).
- Để chống nhiễu loạn Alert sai (Báo động giả từ Locust thưa thớt), nó yêu cầu số row production tối thiểu nhúng bằng `100 rows`. Nếu `< 100`, bỏ qua phân tích kết quả qua mạng đêm đó.

## 3. Webhook Action Logic
- Khi tìm thấy Drift-Detected, script đóng vai Client REST gửi đoạn HTTP POST Request tới API GitHub tại endpoint `/dispatches`.
- Trường `event_type`: Cấu hình cố định chuỗi String `data_drift_detected`. Pipeline Workflow bên Github Action tên `retrain_pipeline.yml` của Repos sẽ hứng Event để bật máy trạm điện toán Train Model Kaggle lập tức.
