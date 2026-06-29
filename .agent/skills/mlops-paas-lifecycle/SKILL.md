---
name: mlops-paas-lifecycle
description: Vòng đời của mô hình AI PaaS, từ việc User Upload, Build Image, Deploy API động, giám sát Drift qua Argo Workflows và Quản lý phiên bản.
---

# Luồng Vòng Đời Mô Hình (AI PaaS ML Lifecycle)

Kiến trúc PaaS chuyển từ việc hardcode cho một mô hình NIDS sang một quy trình generic cho nhiều người dùng:

## 1. Upload Model, Build Image & Dynamic API Generation

1. **Upload**: AI Engineer (Tenant) đăng nhập vào Dashboard (ReactJS), upload mô hình dạng ONNX hoặc MLflow (Pyfunc) lên Control Plane.
2. **Registration**: Django backend nhận thông tin, lưu metadata, và đẩy model weights lên AWS S3. Đăng ký model vào MLflow Registry dưới dạng `tenantID_modelName`.
3. **Build Image**: Hệ thống tự động kích hoạt **Argo Workflow (build-model-job)** thông qua Argo Events để đóng gói mô hình thành Docker Image và đẩy lên **Harbor**.
4. **API Provisioning**: Khi Build xong, Control Plane tiếp tục gọi **Argo Workflow (deploy-model-job)** tạo K8s Deployment và Ingress Controller để cấp phát một Public API Endpoint.

## 2. Reference Data & Data Drift Alert

1. **Upload Data**: Người dùng upload tệp dữ liệu huấn luyện chuẩn (Reference Data) lên S3 thông qua UI.
2. **Production Data**: Khi Endpoint API của người dùng phục vụ dự đoán, log sẽ được đẩy qua Redpanda và consumer lưu vào CSDL Postgres bảng `paas_production_logs` (lưu JSONB cho features và TEXT cho labels).
3. **Drift Check**: Hệ thống tự động (hoặc người dùng bấm Manual Run) kích hoạt **Argo Workflow (evidently-job)** tải Reference Data từ S3 và Production Logs từ Postgres, chạy Evidently tính toán Drift, và xuất HTML Report lên S3.

## 3. Quản lý Phiên bản và Xóa Mô hình

1. **Versioning**: Toàn bộ các mô hình của người dùng được hiển thị trên UI. API của Django đóng vai trò **Proxy** đứng trước MLflow API để đảm bảo Multi-tenancy.
2. **Deletion**: Khi người dùng xóa mô hình, hệ thống thực hiện hai việc:
   - Gọi API tới Harbor để xóa Docker Image cũ.
   - Kích hoạt **Argo Workflow (delete-model-job)** để gỡ bỏ K8s resources (Deployment, Ingress, ScaledObject) của mô hình đó. Mọi thứ dọn dẹp sạch sẽ, giải phóng tài nguyên hệ thống.
