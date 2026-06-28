# Model Packager (Build Job)

Model Packager là một dịch vụ kịch bản (script) hoạt động trong quá trình CI/CD nội bộ của hệ thống PaaS. Nó chịu trách nhiệm biến một Artifact tải lên thành một Docker Image chạy được.

## 🚀 Vai Trò & Chức Năng Chính

- **Đóng Gói (Packaging)**: Lấy Artifact của mô hình (thường từ S3, qua đường dẫn MLflow hoặc presigned URL), sao chép nó vào bên trong bộ mã nguồn của một thư mục `model-server` base.
- **Biên dịch Docker Image**: Sử dụng Docker build (thông qua Kaniko trong Kubernetes hoặc thư viện docker Python) để xây dựng Image hoàn chỉnh.
- **Đẩy Image lên Registry**: Tự động đánh thẻ (tag) và đẩy Image mới lên Harbor Private Registry (được thiết lập riêng cho cụm).

## 🛠️ Luồng Hoạt Động (Argo Workflow)

1. Khi người dùng tạo một phiên bản mô hình mới, Control Plane gửi webhook `build` sang Argo Events.
2. Argo Workflow (`build-model-job`) được kích hoạt, pull Image của `model-packager`.
3. Packager script tải Artifact từ S3 xuống và trích xuất.
4. Packager sử dụng Docker Daemon được mount vào, hoặc Kaniko (tùy cấu hình cluster), để build một Docker Image kết hợp Base Image FastAPI và Model Artifact.
5. Image được Push lên Harbor với tag tương ứng với ID mô hình và phiên bản.

## 🛠️ Công Nghệ Sử Dụng

- **Python, Docker SDK**.
- **Hệ sinh thái MLflow** (để parse PyFunc model hoặc lấy ONNX object).
