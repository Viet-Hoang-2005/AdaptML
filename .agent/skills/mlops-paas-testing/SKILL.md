---
name: mlops-paas-testing
description: Phương pháp kiểm thử AI PaaS, bao gồm test API Model upload, kiểm tra xác thực JWT Asymmetric, và Stress Test để đảm bảo giới hạn tài nguyên đa người thuê.
---

# Phương pháp Kiểm thử Nền tảng AI PaaS

Trong môi trường AI PaaS, trọng tâm kiểm thử không chỉ là độ chính xác của Mô hình Học máy, mà là sự an toàn, độc lập và tính đúng đắn của toàn bộ Nền tảng.

## 1. Kiểm thử Cách Ly Người Dùng (Tenant Isolation Testing)

- **Data Isolation**: Kiểm thử để chắc chắn rằng Tenant A không thể query được Prediction Logs, Reference Data, hay Model Artifacts (từ S3/MLflow proxy) của Tenant B.
- **RCE Validation**: Thử tải lên một model độc hại chứa mã Pickle (RCE Payload). Hệ thống (FastAPI/Seldon) phải từ chối hoặc bọc nó trong một không gian Sandboxed mà không thể thoát ra (Container Escape) hay ping được vào các service nội bộ của Control Plane.

## 2. Kiểm thử Xác Thực Bất Đối Xứng (JWT RS256 Testing)

- Tạo JWT hợp lệ từ Private Key (mô phỏng Django), sau đó dùng Public Key (mô phỏng FastAPI) để decode và verify nội dung.
- Kiểm thử các ca biên:
  - Token hết hạn (Expired).
  - Token bị chỉnh sửa một payload nhỏ (Signature bị hỏng).
  - FastAPI mất kết nối tới Django JWKS Endpoint (Đảm bảo FastAPI có cơ chế Fallback sử dụng Cache Public Key gần nhất).

## 3. Kiểm Thử Khởi Động Lạnh (Cold-Start) và Noisy Neighbor

- **Locust Stress Test**: Tạo ra một luồng traffic khổng lồ tới Model của Tenant A. Đo đạc xem Pod của Tenant B có bị ảnh hưởng (tăng độ trễ, văng OOM) hay không.
- **KEDA Verification**: Kiểm tra thời gian từ lúc gửi Request HTTP đầu tiên đến khi Pod Scale-from-Zero (0 -> 1) hoàn thành. Đảm bảo Ingress giữ request đúng cách và không ném lỗi `503 Service Unavailable`.
- Đảm bảo Kubernetes Resource Quotas hoạt động đúng bằng cách theo dõi `kubectl describe pod` xem OOMKilled có xuất hiện đúng trên các Pod cố tình ăn quá bộ nhớ cấp phép.
