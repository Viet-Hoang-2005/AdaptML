---
name: mlops-nids-monitoring
description: Phương pháp tính toán Error / Drift và logic của Webhook.
---

# Data Drift Monitoring bằng Evidently AI

Script giám sát trạng thái Data Drift tĩnh `monitoring/detect_drift.py` được đóng gói trong Docker Container và Deploy dưới dạng hệ thống K3s `Job`. Thay vì chạy định kỳ (CronJob), Job này được khởi chạy tự động (Event-Driven) thông qua Webhook từ Redpanda Consumer khi số lượng dữ liệu sản xuất vượt ngưỡng.

## 1. Bối Cảnh So Sánh

- **Dữ liệu tham chiếu (Reference):** Lưu trữ trong `nids_reference_data`. Bảng này được đồng bộ từ S3 thông qua Github Action script `update_reference_data.py`.
- **Dữ liệu sản xuất (Production):** Lưu trữ trong `nids_production_data`. Chứa nhật ký dự đoán từ FastAPI trong 24 giờ qua.
- **Tối ưu hóa hiệu suất:** Để hỗ trợ xử lý lượng dữ liệu khổng lồ (Big Data), script sử dụng kỹ thuật **DB-level sampling** (`TABLESAMPLE SYSTEM`) trực tiếp trong PostgreSQL khi số lượng bản ghi vượt quá `100,000`. Điều này giúp tiết kiệm tài nguyên RAM đáng kể mà vẫn đảm bảo tính đại diện thống kê.

## 2. Công nghệ Phân tích (v0.4.15 Stable)

- Sử dụng thư viện **Evidently AI phiên bản 0.4.15** (Bản ổn định nhất cho cấu trúc JSON Report hiện tại). 
- **DataDriftPreset:** Tự động thực hiện các kiểm định thống kê (KS-test cho tham số liên tục, Chi-Square cho tham số phân loại).
- **Threshold:** Ngưỡng cảnh báo mặc định là `0.6` (60% thuộc tính bị lệch). 
- **Lưu ý Schema:** Cần giữ lại nhãn dự đoán `Predicted_Label` để Evidently có thể phát hiện sự thay đổi trong bản chất của các cuộc tấn công mạng mới.

## 3. Webhook Action Logic

- Khi phát hiện Drift, script gửi một HTTP POST Request tới GitHub API (`repository_dispatch`).
- Trường `event_type`: `data_drift_detected`.
- Workflow `retrain_pipeline.yml` sẽ lắng nghe sự kiện này để tự động kích hoạt tiến trình Retrain trên Kaggle.
