---
name: mlops-paas-security
description: Kỹ năng thiết kế an ninh cho nền tảng AI PaaS, tập trung vào bảo mật đa người thuê (multi-tenant), ngăn chặn RCE, và quản lý giới hạn tài nguyên.
---

# Bảo mật Nền tảng AI PaaS Đa Người Thuê

Khi thiết kế hoặc sửa đổi các tính năng trên nền tảng AI PaaS, hãy tuân thủ nghiêm ngặt các nguyên tắc bảo mật sau:

## 1. Ngăn chặn Thực thi Mã độc (RCE - Remote Code Execution)
- **Zero-Trust File Upload**: Chỉ cho phép người dùng tải lên mô hình ở định dạng chuẩn an toàn (ví dụ: ONNX, MLflow MLmodel phân phối qua Pyfunc). **Tuyệt đối cấm tải lên file `.pkl` (Pickle)** vì nó có thể chứa mã độc thực thi khi được load.
- **Sandboxing Pods (K8s Security Context)**: Tất cả các Pod làm nhiệm vụ phục vụ Inference của khách hàng phải bị vô hiệu hóa quyền bằng cấu hình `securityContext.drop: ["ALL"]` và `runAsNonRoot: true`. Nếu có điều kiện, sử dụng Runtime như gVisor hoặc Kata Containers.

## 2. Cách Ly Không Gian Mạng (Network Isolation)
- **Network Policies**: Phải thiết lập K8s Network Policy cấm các Pod Inference (Data Plane) truy cập ngược lại vào mạng lưới nội bộ của Control Plane (như Database User của Django, API nội bộ) hoặc truy cập Internet ra bên ngoài nhằm ngăn chặn rò rỉ dữ liệu (Data Exfiltration).
- Các Pod Inference chỉ được phép giao tiếp với API Gateway (Traefik) và kết nối xuất ra Redpanda Kafka để log dữ liệu.

## 3. Giới Hạn Quota và Quản Lý Dung Lượng Lưu Trữ
- **Storage Lifecycle (AWS S3)**: Không lưu trữ vĩnh viễn các mô hình cũ. Cấu hình S3 Lifecycle policies tự động chuyển mô hình cũ (không được gán nhãn Production) sang tầng lưu trữ giá rẻ hoặc tự động xóa sau một khoảng thời gian.
- **Tenant Quotas**: Django (Control Plane) phải theo dõi và áp đặt hạn mức (Quota) lưu trữ (S3) và tài nguyên tính toán (Max Pods) cho mỗi khách hàng (Tenant). Khóa tính năng Retrain nếu người dùng vượt quá dung lượng cho phép.

## 4. Bảo Mật Xác Thực Giao Tiếp Dịch Vụ
- **Xác thực Bất đối xứng (Asymmetric JWT - RS256)**: Để ngăn chặn giả mạo token và giảm thiểu độ trễ giao tiếp (Network Overhead), Django đóng vai trò Identity Provider ký JWT bằng Private Key. FastAPI (Model Server) lấy Public Key qua endpoint JWKS để tự kiểm tra token tại chỗ.
- Thời gian sống (TTL) của Access Token cần cực ngắn (ví dụ: 15 phút). Các service luôn cần xử lý Refresh Token flow để lấy token mới.
