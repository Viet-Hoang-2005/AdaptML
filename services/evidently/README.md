# Evidently Job (Drift Monitoring)

Đây là thành phần thực thi tính toán Data Drift, được khởi chạy ngầm (isolated) dưới dạng **Argo Workflows** bên trong Kubernetes cluster.

## 🚀 Vai Trò & Chức Năng Chính

- **Phát hiện Data Drift**: So sánh phân phối của dữ liệu Production (thực tế sinh ra trong quá trình chạy) với Reference Data (dữ liệu huấn luyện chuẩn).
- **Hỗ trợ Schema Động**: Lấy dữ liệu log từ cột `JSONB` của PostgreSQL và bung (flatten) ra thành cấu trúc DataFrame Pandas chuẩn hóa để Evidently AI phân tích mà không cần hardcode số lượng features.
- **Tự Động Hóa Báo Cáo**: Sau khi tính toán, mã nguồn tự động xuất báo cáo dưới dạng giao diện trực quan (HTML Report) và dữ liệu thô (JSON Summary).
- **Webhook Giao Tiếp**: Gửi kết quả (Drift Score) và đường dẫn S3 của báo cáo về cho Control Plane thông qua Webhook nội bộ.

## 🛠️ Luồng Hoạt Động

1. Workflow được kích hoạt với các tham số (Job ID, Model ID, S3 URIs...) và Secrets.
2. Tải tệp Reference Data từ AWS S3 (thông qua URL Presigned cung cấp bởi Control Plane).
3. Truy vấn Production Logs từ PostgreSQL (sử dụng mật khẩu từ `postgres-secrets`).
4. Khởi chạy `DataDriftPreset` của Evidently AI.
5. Upload các tệp báo cáo `report.html` và `summary.json` ngược lại lên AWS S3.
6. Gửi một HTTP POST Webhook chứa `drift_summary` cho Control Plane để hoàn tất Job.

## 🛠️ Công Nghệ Sử Dụng

- **Thư Viện Cốt Lõi**: `evidently`, `pandas`, `sqlalchemy`.
- **Hạ Tầng Khởi Chạy**: Kubernetes Pod / Argo Workflow (Docker Image được pull từ Harbor).
