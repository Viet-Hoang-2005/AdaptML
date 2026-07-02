# Control Plane (Django Backend)

Control Plane là "bộ não" trung tâm của nền tảng AI PaaS, chịu trách nhiệm quản lý định danh (Identity), metadata, và điều phối toàn bộ các nghiệp vụ liên quan đến vòng đời mô hình học máy.

## 🚀 Vai Trò & Chức Năng Chính

- **Identity Provider (IdP) & RBAC**: Quản lý tài khoản người dùng, OAuth2 (GitHub/Google), cấp phát và quản lý API Keys.
- **Asymmetric JWT Authentication**: Sinh ra JWT bằng Private Key (RS256) cho các API Keys để người dùng có thể giao tiếp với các Model Server (Data Plane) mà không bị độ trễ mạng (Network Overhead).
- **Metadata Management**: Lưu trữ thông tin về Models, API Endpoints, và Drift Monitoring Jobs vào CSDL PostgreSQL (`django_schema`).
- **Orchestration qua Argo Workflows**: Thay vì trực tiếp can thiệp vào Kubernetes, Control Plane gọi Webhook sang **Argo Events** để kích hoạt các tiến trình:
  - `build-model-job`: Đóng gói mô hình thành Docker Image.
  - `deploy-model-job`: Triển khai mô hình lên K8s.
  - `delete-model-job`: Xóa tài nguyên mô hình trên K8s và xóa Image trên Harbor.
  - `evidently-job`: Chạy kiểm tra Data Drift.

## 🛠️ Công Nghệ Sử Dụng

- **Framework**: Django, Django REST Framework (DRF).
- **Database**: PostgreSQL (CloudNativePG).
- **Storage**: AWS S3 (Boto3) để lưu trữ Reference Data và Model Artifacts.
- **Registry**: Tích hợp API của Harbor để quản lý Image.

## 📂 Cấu Trúc Thư Mục

- `src/authentication/`: Quản lý User, Tenant, JWT, API Keys, Models, và Billing.
- `src/registry/`: Quản lý vòng đời tải lên mô hình, proxy MLflow, tương tác Harbor.
- `src/deployment/`: Chứa các Adapter (Docker/Argo) để kích hoạt quá trình Build/Deploy.
- `src/drift/`: Cấu hình giám sát Drift và xử lý Webhook nhận kết quả từ Argo Workflows.
