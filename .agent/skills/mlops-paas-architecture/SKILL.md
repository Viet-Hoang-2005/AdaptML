---
name: mlops-paas-architecture
description: Hiểu biết về kiến trúc cấp cao của hệ thống AI PaaS, bao gồm luồng Microservices Control/Data Plane, Asymmetric JWT, Argo Workflows, Kubeflow Training, và Karpenter.
---

# Kiến trúc MLOps AI PaaS

Hệ thống hoạt động dưới dạng **Platform-as-a-Service (PaaS)** chuyên phục vụ nhiều khách hàng (Multi-tenant AI). Hãy nhớ các nguyên tắc kiến trúc sau:

## 1. Microservices Architecture (Control Plane vs Data Plane)

- **Django (Control Plane)**: Đảm nhận các chức năng như Đăng nhập, API Keys, quản lý danh sách Projects/Models của Users, cấu hình Drift Monitoring, và điều phối Training Jobs.
- **FastAPI / Model Server (Data Plane)**: Chuyên trách phục vụ Inference tốc độ cao (Predict endpoint) cho từng Model Endpoint độc lập của khách hàng.
- Kiến trúc tách bạch để nếu Inference bị lỗi, người dùng vẫn có thể đăng nhập vào UI bình thường.

## 2. Xác thực Asymmetric JWT (RS256)

- Dùng cho xác thực API Key từ bên ngoài vào Endpoint của khách hàng, giải quyết bài toán độ trễ mạng (Network Overhead).
- **Django** dùng Private Key sinh ra JWT.
- **FastAPI** lưu Public Key để xác thực JWT ngay tại chỗ mà không cần gọi HTTP sang Django, và bóc tách `tenant_id`, `model_id`.

## 3. Điều phối Huấn luyện & Vòng đời tự động bằng Argo Workflows, Kubeflow, và Karpenter

- Hệ thống ứng dụng GitOps và MLOps Orchestration thông qua **Argo Workflows** và **Argo Events**.
- **Training Orchestration**: Các tác vụ huấn luyện mô hình được điều phối qua Argo Workflows khởi tạo CRD **`PyTorchJob`** (`kubeflow.org/v1`), loại bỏ hoàn toàn sự phụ thuộc vào AWS Batch hay SageMaker.
- **Karpenter Dynamic Autoscaling**: Các Pod huấn luyện được cấp phát tài nguyên động qua Karpenter K8s Autoscaler, tự động tạo node CPU/GPU khi có job và thu hồi node (scale-in về 0) ngay sau khi hoàn tất.
- **Real-time Monitoring qua Redis HTTP Polling**: Loại bỏ WebSocket; log của quá trình build và train mô hình được ghi liên tục vào Redis List (`training_logs:{job_id}` / `build_logs:{id}`). React Frontend poll log theo `offset` định kỳ mỗi 3 giây.
- **Harbor** được sử dụng làm Private Registry lưu trữ Docker Images của từng mô hình khách hàng. Control Plane đồng bộ việc xóa Image khi người dùng xóa mô hình.

## 4. Kiến trúc Event-Driven (Redpanda Kafka & Postgres)

- Data Plane (các Model Endpoint) không lưu dữ liệu log trực tiếp vào DB để tránh thắt cổ chai.
- Khi có Request dự đoán, Data Plane bắn sự kiện dữ liệu (Log) vào topic **Redpanda Kafka**.
- Một **Consumer Worker** (chạy ngầm trong cluster) sẽ gom dữ liệu từ Kafka theo từng lô (Batching) và lưu vào bảng `paas_production_logs` của CSDL **PostgreSQL**.
- Do mỗi mô hình có cấu trúc Data Schema (số lượng đặc trưng, features) khác nhau, PostgreSQL sử dụng cột định dạng `JSONB` cho features, và cột `TEXT` cho prediction (hỗ trợ Label Mapping string).

## 5. Distributed Tracing & Routing

- Traefik API Gateway điều phối Request đến đúng K8s Ingress của từng khách hàng.
- Không hardcode logic cho 1 mô hình NIDS duy nhất, mã nguồn được thiết kế Generic, định tuyến linh hoạt `/api/models/{model_id}/predict` tới đúng Service.
