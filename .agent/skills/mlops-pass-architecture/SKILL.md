---
name: mlops-paas-architecture
description: Hiểu biết về kiến trúc cấp cao của hệ thống AI PaaS, bao gồm luồng Microservices Control/Data Plane, Asymmetric JWT, Single Source of Truth DB, và Event-Driven.
---

# Kiến trúc MLOps AI PaaS

Hệ thống hoạt động dưới dạng **Platform-as-a-Service (PaaS)** chuyên phục vụ nhiều mô hình học máy (Multi-tenant AI) cho các Data Scientist/AI Engineer. Hãy nhớ các nguyên tắc kiến trúc sau:

## 1. Microservices Architecture (Control Plane vs Data Plane)

- **Django (Control Plane)**: Đảm nhận các chức năng như Đăng nhập, OAuth, RBAC, Billing, quản lý danh sách Projects/Models của Users. Đây là Identity Provider của hệ thống.
- **FastAPI / Model Server (Data Plane)**: Chuyên trách phục vụ Inference tốc độ cao (Predict endpoint), xử lý throughput lớn.
- Kiến trúc tách bạch để nếu Inference bị lỗi, người dùng vẫn có thể đăng nhập vào UI bình thường.

## 2. Xác thực Asymmetric JWT (RS256)

- Giải quyết bài toán độ trễ mạng (Network Overhead) giữa các Microservices.
- **Django** dùng Private Key sinh ra JWT.
- **FastAPI** lưu Public Key (thông qua JWKS cache) để xác thực JWT ngay tại chỗ (<0.1ms) mà không cần gọi HTTP sang Django.

## 3. Single Source of Truth Database (Chia Schema)

- Để tránh cơn ác mộng Distributed Transactions ở giai đoạn đầu, hệ thống dùng chung **Cụm CloudNativePG PostgreSQL**, nhưng được phân ranh giới quyền:
  - `django_schema`: Django quản lý bảng User, Tenant. FastAPI chỉ được quyền cấp `SELECT` (Read-only) trên các bảng cần thiết.
  - `fastapi_schema`: FastAPI tạo và quản lý bảng như `prediction_logs`.
- Chỉ Django mới được phép chạy lệnh Migration trên các thực thể cốt lõi (User, Organization).

## 4. Kiến trúc Event-Driven (Redpanda Kafka & Outbox Pattern)

- Giải quyết bài toán Nhất quán dữ liệu (Data Consistency) giữa các services.
- Khi Django xóa/tạo một User, nó không gọi API sang FastAPI (dễ lỗi HTTP Timeout). Thay vào đó, Django bắn một sự kiện (ví dụ: `TENANT_DELETED`) vào topic **Redpanda**.
- FastAPI lắng nghe sự kiện từ Redpanda và tự động dọn dẹp tài nguyên.
- **Outbox Pattern**: Để đảm bảo Guarantee Delivery, Django lưu Event vào bảng `outbox_events` cùng lúc với lưu User (cùng DB Transaction), sau đó worker mới đẩy từ bảng Outbox sang Redpanda.

## 5. Distributed Tracing (Truy Vết Phân Tán)

- Traefik API Gateway tự động sinh ra header **`X-Request-ID`** cho mọi Request từ phía Client.
- Header này phải được truyền qua mọi Microservices (từ Django -> FastAPI -> Celery Worker).
- Hệ thống Log phải luôn gắn `X-Request-ID` vào để có thể truy vết toàn bộ vòng đời Request, khắc phục cơn ác mộng đọc log phân mảnh.

## 6. Dynamic Model Routing

- Khi người dùng tải lên mô hình (ONNX/MLflow), hệ thống sẽ cấp phát linh hoạt một endpoint riêng biệt (vd: `/api/v1/models/{tenant_id}_{model_id}/predict`).
- Không hardcode logic cho 1 mô hình NIDS duy nhất, mã nguồn cần được thiết kế generic cho mọi mô hình dạng bảng (Tabular classification).
