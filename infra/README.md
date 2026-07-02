# Hệ thống Hạ tầng AWS (Terraform)

Thư mục này chứa toàn bộ mã nguồn **Infrastructure as Code (IaC)** được viết bằng Terraform để tự động hóa việc triển khai hạ tầng đám mây trên AWS cho dự án AI PaaS. Hệ thống được thiết kế theo kiến trúc module hóa, giúp dễ dàng tái sử dụng và tinh chỉnh.

## 🚀 Các Thành Phần Hạ Tầng (Modules)

Cấu trúc hạ tầng bao gồm các module chính sau:

1. **`network`**:
   - Thiết lập **Amazon VPC** để cô lập mạng.
   - Tạo Public Subnets và Private Subnets đa vùng (Multi-AZ) để đảm bảo High Availability.
   - Khởi tạo **Internet Gateway (IGW)** cho phép kết nối Internet hai chiều cho Public Subnets.
   - (Tùy chọn) Cấu hình **NAT Gateway** kèm Elastic IP (EIP) để các EC2 Worker Node nằm trong Private Subnet có thể truy cập Internet một chiều (cần thiết khi tải Docker Image hoặc update hệ điều hành).

2. **`compute`**:
   - Khởi tạo các máy chủ ảo (EC2 Instances).
   - Thiết lập cụm K3s (Kubernetes): Gồm các node Master (Control Plane k8s) và Worker.
   - Gắn các IAM Instance Profile để các máy ảo có thể giao tiếp với S3 và Secrets Manager mà không cần hardcode Access Key.

3. **`storage`**:
   - Cung cấp các **Amazon S3 Buckets** để lưu trữ:
     - `Artifacts`: Model weights (ONNX), MLflow artifacts, Reference Data, HTML Reports.
     - `Avatars`: Ảnh đại diện của người dùng trên nền tảng.

4. **`security`**:
   - Định nghĩa các **Security Groups (Firewall)**:
     - `master_sg`: Mở port 6443 (K8s API), 22 (SSH).
     - `worker_sg`: Mở port cho NodePort, Ingress, Node-to-node communication.
     - `lb_sg`: Mở port 80/443 cho Load Balancer.

5. **`iam`**:
   - Khởi tạo **IAM Roles & Policies**:
     - Cấp quyền cho K8s Worker Nodes được phép đọc/ghi vào S3 Buckets.
     - Cấp quyền lấy dữ liệu nhạy cảm từ AWS Secrets Manager thông qua External Secrets Operator (ESO).
     - Gắn policy `AmazonEBSCSIDriverPolicy` để K3s Worker Nodes có thể tự động cấp phát ổ cứng AWS EBS (ví dụ khi tạo Persistent Volume Claims cho CSDL).
   - Thiết lập **GitHub Actions OIDC Provider**: Cho phép GitHub Actions tự động xác thực với AWS (Assume Role) để cập nhật Secret và thao tác hạ tầng CI/CD mà không cần cung cấp Access Key tĩnh rủi ro dài hạn.

6. **`secrets`**:
   - Khởi tạo AWS Secrets Manager lưu trữ các biến môi trường nhạy cảm (như Database Password, JWT Keys, GitHub Actions Secrets) để Kubernetes tự động đồng bộ xuống cluster.

7. **`alb` & `dns` (Tùy chọn)**:
   - Triển khai **Application Load Balancer (ALB)** để cân bằng tải traffic HTTP/HTTPS vào các Worker nodes.
   - **Route 53**: Cấu hình bản ghi DNS để ánh xạ tên miền gốc và xin chứng chỉ bảo mật (ACM Certificate).

## 🛠️ Hướng dẫn Triển Khai (Deployment)

Yêu cầu chuẩn bị: Cài đặt `terraform`, `aws-cli` và cấu hình tài khoản AWS hợp lệ.

1. Khởi tạo Terraform:
   ```bash
   terraform init
   ```

2. Tùy chỉnh tham số (Tùy chọn):
   Tạo file `terraform.tfvars` và điều chỉnh các cờ bật/tắt tính năng (ví dụ: `enable_compute = true`).

3. Xem trước cấu trúc hạ tầng sẽ thay đổi:
   ```bash
   terraform plan
   ```

4. Áp dụng triển khai lên AWS:
   ```bash
   terraform apply
   ```

5. Hủy hạ tầng (Khi không còn sử dụng để tiết kiệm chi phí):
   ```bash
   terraform destroy
   ```

## 🔐 Lưu ý Bảo Mật

- **KHÔNG BAO GIỜ** commit các file `.tfstate` chứa trạng thái hạ tầng thực tế lên GitHub (Đã được chặn bởi `.gitignore`).
- Các chứng chỉ nhạy cảm sẽ không được lưu trong Terraform script mà quản lý độc lập tại AWS Secrets Manager.
