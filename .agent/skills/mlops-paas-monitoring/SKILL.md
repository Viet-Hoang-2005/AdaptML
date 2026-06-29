---
name: mlops-paas-monitoring
description: Giám sát Data Drift bằng Evidently AI qua Argo Workflows, xử lý Schema Drift bằng JSONB, Text Label Mapping, và giám sát hạ tầng.
---

# Giám sát Data Drift & Hệ thống (AI PaaS)

## 1. Giải quyết bài toán Dữ liệu Đa hình thái (Schema Drift) và Label Mapping

Hệ thống cũ lưu log dự đoán theo các cột Database cố định. Trong nền tảng PaaS, các mô hình của khách hàng khác nhau sẽ có số lượng Features (đặc trưng) khác nhau (Mô hình A có 5 features, Mô hình B có 100 features). Đồng thời, output dự đoán không còn giới hạn ở số nguyên (0, 1).

- **Giải pháp**: PostgreSQL sử dụng cột định dạng **`JSONB`** cho `features` để lưu trữ linh hoạt, và cột **`TEXT`** cho `prediction` để hỗ trợ Label Mapping (ví dụ: "DDoS", "BENIGN").
- Cấu trúc log đẩy từ FastAPI vào Redpanda và lưu vào Database:
  ```json
  {
    "tenant_id": "T-123",
    "model_id": "M-ABC",
    "timestamp": "2024-05-11...",
    "features": { "age": 25, "income": 50000 },
    "prediction": "DDoS"
  }
  ```

## 2. Multi-tenant Drift Detection (Evidently AI qua Argo Workflows)

- Chức năng Drift Monitoring được kích hoạt tự động qua **Argo Events** và thực thi bởi **Argo Workflows (evidently-job)** để cô lập tài nguyên tính toán.
- Khi Argo Workflow khởi chạy, nó sử dụng `postgres-secrets` để truy cập Database, query bảng `paas_production_logs` theo `model_id`, bung cột `features` (JSONB) ra thành DataFrame Pandas và so khớp với Reference Data lấy từ S3.
- Output của Evidently (HTML Report & JSON Summary) được đẩy trực tiếp lên S3 bucket, sau đó Workflow gọi Webhook về Control Plane để Control Plane tạo bản ghi kết quả `DriftMonitoringResult` vào DB. Control Plane sẽ chờ Workflow này chạy xong một cách đồng bộ (polling DB) để cập nhật trạng thái UI.

## 3. Infrastructure Monitoring (Prometheus & KEDA)

- **Prometheus ServiceMonitors**: Giám sát metrics HTTP Request của các Pod FastAPI (Data Plane) và số lượng kết nối tới Django (Control Plane).
- Tích hợp số liệu Prometheus với **KEDA (Kubernetes Event-driven Autoscaling)** để thực thi chính sách Scale-from-Zero hoặc Scale-Out tự động cho từng Model Deployment dựa trên số lượng request.
- Thiết lập Alertmanager báo động khi có một Tenant gây đột biến tiêu thụ tài nguyên có nguy cơ gây hại hệ thống (CPU > 90% kéo dài).
