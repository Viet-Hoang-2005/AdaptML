---
name: mlops-paas-monitoring
description: Giám sát Data Drift bằng Evidently AI trong môi trường đa người dùng (Multi-tenant), xử lý Schema Drift bằng JSONB, và giám sát hạ tầng.
---

# Giám sát Data Drift & Hệ thống (AI PaaS)

## 1. Giải quyết bài toán Dữ liệu Đa hình thái (Schema Drift)

Hệ thống cũ lưu log dự đoán theo các cột Database cố định. Trong nền tảng PaaS, các mô hình của khách hàng khác nhau sẽ có số lượng Features (đặc trưng) khác nhau (Mô hình A có 5 features, Mô hình B có 100 features).

- **Giải pháp**: PostgreSQL sử dụng cột định dạng **`JSONB`** (hoặc ClickHouse sử dụng Map/Tuple) để lưu trữ log linh hoạt.
- Cấu trúc log đẩy từ FastAPI vào Redpanda:
  ```json
  {
    "tenant_id": "T-123",
    "model_id": "M-ABC",
    "timestamp": "2024-05-11...",
    "features": { "age": 25, "income": 50000 },
    "prediction": 1
  }
  ```

## 2. Multi-tenant Drift Detection (Evidently AI)

- Job Evidently không còn chạy chung cho toàn hệ thống mà chạy theo phạm vi từng Mô hình (`model_id`).
- Khi K8s Job Evidently khởi chạy, nó query CSDL bằng `model_id`, "bung" cột JSONB `features` ra thành DataFrame Pandas tiêu chuẩn và nạp vào thư viện Evidently.
- Output JSON của Evidently được lưu trữ lại trên CSDL hoặc S3 để Frontend ReactJS lấy hiển thị thành các Dashboard báo cáo chất lượng mô hình.

## 3. Infrastructure Monitoring (Prometheus & KEDA)

- **Prometheus ServiceMonitors**: Giám sát metrics HTTP Request của các Pod FastAPI (Data Plane) và số lượng kết nối tới Django (Control Plane).
- Tích hợp số liệu Prometheus với **KEDA (Kubernetes Event-driven Autoscaling)** để thực thi chính sách Scale-from-Zero hoặc Scale-Out tự động cho từng Model Deployment dựa trên số lượng request.
- Thiết lập Alertmanager báo động khi có một Tenant gây đột biến tiêu thụ tài nguyên có nguy cơ gây hại hệ thống (CPU > 90% kéo dài).
