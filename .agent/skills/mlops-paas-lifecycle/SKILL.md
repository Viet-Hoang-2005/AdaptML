---
name: mlops-paas-lifecycle
description: Vòng đời của mô hình AI PaaS, từ việc User Upload, tạo API động, giám sát Drift, kích hoạt Retrain trên SageMaker và Quản lý phiên bản.
---

# Luồng Vòng Đời Mô Hình (AI PaaS ML Lifecycle)

Kiến trúc PaaS chuyển từ việc hardcode cho một mô hình NIDS sang một quy trình generic cho nhiều người dùng:

## 1. Upload Model & Dynamic API Generation

1. **Upload**: AI Engineer (Tenant) đăng nhập vào Dashboard (ReactJS), upload mô hình dạng ONNX hoặc MLflow (Pyfunc).
2. **Registration**: Django backend nhận thông tin, lưu metadata, và đẩy model weights lên AWS S3. Đăng ký model vào MLflow Registry dưới dạng `tenantID_modelName`.
3. **API Provisioning**: Kích hoạt quy trình tạo K8s Deployment cho Model đó. Ingress Controller cấp phát ngay lập tức một Public API Endpoint (hoặc Private API Endpoint kèm JWT authentication).

## 2. Reference Data & Data Drift Alert

1. **Upload Data**: Người dùng upload tệp dữ liệu huấn luyện chuẩn (Reference Data).
2. **Production Data**: Khi Endpoint API của người dùng phục vụ dự đoán, log sẽ được đẩy qua Redpanda và lưu vào CSDL.
3. **Drift Check**: Hệ thống tự động kích hoạt Evidently AI (CronJob theo lịch của Tenant hoặc khi đạt ngưỡng số lượng logs). Hệ thống thông báo cảnh báo (Alert) trên UI nếu phát hiện Drift.

## 3. Retraining Flow (Offload sang AWS SageMaker)

Khi người dùng nhận cảnh báo Drift, họ có thể tải lên tập Reference Data mới kèm mã nguồn (hoặc chọn thuật toán có sẵn) và bấm nút **Retrain**.

1. **Trigger**: Django gọi API tới hệ thống Orchestrator (ví dụ: Apache Airflow, Celery).
2. **Training Job**: Khởi tạo AWS SageMaker Training Job để offload gánh nặng tính toán khỏi cụm K3s.
3. **Register**: SageMaker chạy xong, đẩy Artifacts lên S3 và đăng ký phiên bản mô hình mới vào MLflow Registry. Thông báo cho người dùng.

## 4. Quản lý Phiên bản (Model Registry Versioning)

- Toàn bộ các mô hình của người dùng được hiển thị trên UI.
- API của Django đóng vai trò **Proxy** đứng trước MLflow API để đảm bảo **Multi-tenancy** (Người dùng nào chỉ được phép gọi API MLflow và xem các mô hình thuộc Tenant đó).
- Khi người dùng chọn một phiên bản mô hình trên UI và gán nó làm **Production**, hệ thống GitOps (ArgoCD) hoặc API Kubernetes sẽ thay đổi K8s Deployment của người dùng đó sang Image Tag / Model Path mới. Mọi thứ diễn ra tự động mà không cần can thiệp hạ tầng thủ công.
