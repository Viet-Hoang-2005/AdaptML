---
name: mlops-paas-k3s
description: Quản lý hạ tầng Kubernetes (K3s), chống Noisy Neighbor, thiết lập Resource Quotas, Scale-to-Zero, và PostgreSQL Schemas.
---

# K3s & Hạ tầng Cloud Operations (AI PaaS)

## 1. Giải quyết vấn đề "Hàng xóm ồn ào" (Noisy Neighbor)

Hệ thống PaaS phục vụ nhiều khách hàng (Multi-tenant) dễ gặp rủi ro một khách hàng ngốn sạch tài nguyên Node.

- **Kiến trúc Single-Model Serving**: Mỗi mô hình của khách hàng được tạo thành một Deployment riêng biệt trên K3s.
- **Bắt buộc áp dụng Hard Limits**: Mọi Pod Inference phải được cấp `resources.requests` và `resources.limits` để Kubernetes kiểm soát:
  ```yaml
  resources:
    limits:
      cpu: "500m"
      memory: "512Mi" # K3s sẽ OOMKilled Pod nếu vượt mức
  ```

## 2. Scale-to-Zero (Thu gọn về 0) với KEDA

Để giải quyết bài toán chi phí tài nguyên khi gán 1 Pod cho 1 Mô hình (Resource Overhead):

- **KEDA HTTP Add-on / Knative**: Các Pod Inference nếu không có Request HTTP đến trong khoảng thời gian nhất định sẽ tự động Scale xuống 0 bản sao.
- Khi có request mới, Ingress/KEDA sẽ giữ (hold) request đó lại, đánh thức (Scale-to-1) Pod, sau khi Pod Ready mới đẩy request vào, chấp nhận tình trạng "Khởi động lạnh" (Cold Start) đổi lấy tiết kiệm chi phí.

## 3. Quản trị Cơ sở dữ liệu CloudNativePG & Schema Isolation

- Cluster PostgreSQL được triển khai theo mô hình Primary-Standby bằng CloudNativePG.
- **Schema Isolation**: Cấu hình PostgreSQL hỗ trợ chia 2 Schema độc lập:
  - `django_schema`: Nơi lưu trữ thông tin User, Tenant, Quota, Billing.
  - `fastapi_schema`: Nơi lưu trữ Inference logs, Drift results.
- Đảm bảo User Database của FastAPI chỉ được cấp quyền SELECT trên các bảng cần thiết của `django_schema` (Principle of Least Privilege).

## 4. Quản lý Secret (External Secrets Operator - ESO)

- Hệ thống áp dụng nguyên tắc IAM Instance Profiles (Workers gọi được S3/Secrets Manager không cần Access Key tĩnh).
- External Secrets (ESO) được dùng để đồng bộ Secret giữa AWS Secrets Manager và cụm K3s (Namespace riêng biệt cho từng Tenant nếu cần thiết để cô lập quyền truy cập).

## 5. Tối ưu hóa Khởi động (Base Image Caching)

Để giảm thiểu thời gian Cold Start khi Scale-from-Zero:

- Xây dựng các Docker **Runtime Templates** nhẹ nhàng (Ví dụ: Image chỉ chứa `onnxruntime` siêu mỏng thay vì cài cả PyTorch).
- K3s DaemonSet tải sẵn (pre-pull) các Runtime Templates base này lên mọi Node, giúp thời gian tạo Container giảm xuống chỉ còn 1-3 giây.
