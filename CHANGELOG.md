# Nhật ký Thay đổi (Changelog)

Tất cả những thay đổi nổi bật của dự án **Hệ thống MLOps NIDS** sẽ được ghi chép tại đây.

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.0.0] - 2026-03-30
*(Bản cập nhật Kiến trúc MLOps Hoàn chỉnh)*

### Added (Tính năng mới)
- **Kiến trúc K3s Zero-Downtime**: Từ bỏ Docker Compose truyền thống trên Production, chuyển sang sử dụng Manifest Kubernetes (K3s). Bổ sung `api-deployment.yaml` chứa Init-container để chủ động kéo model v2 từ S3 về RAM.
- **Giám sát Drift bằng Evidently AI**: Thêm cấu hình và logic mã nguồn để tự động đo điểm *DataDriftPreset*.
- **Cơ chế Webhook**: Khả năng phân tích DB PostgreSQL qua đêm và bắn tín hiệu `repository_dispatch` kích hoạt quá trình tự động huấn luyện (Continuous Training) trên Kaggle.
- **Kiểm thử chịu tải giả lập (Load Testing)**: Thêm thư mục `load_testing/` tích hợp kịch bản mã hoá bằng **Locust** nhằm đẩy traffic (cả Benign lẫn Attack) vào hệ thống để thử nghiệm mức cảnh báo.

### Changed (Cập nhật lõi)
- Chuyển tiếp toàn bộ API logic từ Flask sang **FastAPI** để tận dụng tốc độ *Asynchronous*. 
- Sửa hàm `predict` của API: Giờ đây API gửi data xuống PostgreSQL bằng **Background Tasks** (luồng nền) để không làm tăng thời gian chờ (latency) của người dùng cuối.
- Cập nhật Git Workflow (`retrain_pipeline.yml`) sang quy trình Rollout Restart Deployment ở môi trường K3s thay vì build lại toàn bộ Image.

### Removed (Đã loại bỏ)
- Giao diện Demo Gradio (chuyển qua giao tiếp hoàn toàn bằng JSON REST API chuyên nghiệp do đặc thù Data Mạng).

---

## [1.0.0] - 2026-01-XX
*(Bản phát hành Nền tảng Core ML)*

### Added (Khởi tạo)
- Thuật toán **XGBoost** xử lý dữ liệu mạng luồng (NetFlow) từ CIC-IDS2017.
- Cơ chế Encoder (Label_encoder) cho bài toán dự đoán Phân lớp đa biến (Multi-class: BENIGN, DDoS, PortScan).
- Dockerfile cơ bản đóng gói model `.pkl` vào hệ điều hành lõi.
- Công cụ Infrastructure as Code: Basic **Terraform** sinh tài nguyên trống trên AWS (S3 Bucket, RDS, ECR).
- Workflow CI/CD cơ bản trên GitHub Actions: tự động chạy kiểm thử Code (Unit Testing).

---

## Thông tin Phiên bản (Versioning)

Dự án này sử dụng [Semantic Versioning](https://semver.org/).

Định dạng: `MAJOR.MINOR.PATCH`

- **MAJOR**: Những thay đổi lớn phá vỡ cấu trúc cũ (Breaking changes - Ví dụ: Chuyển từ Docker sang K3s).
- **MINOR**: Tính năng mới tương thích ngược (Backward compatible).
- **PATCH**: Sửa lỗi nhỏ gọn, vá lỗi bảo mật (Bug fixes).

---
*Created for MLOps NIDS System Project*
