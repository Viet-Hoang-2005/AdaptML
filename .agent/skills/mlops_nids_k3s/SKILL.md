---
name: MLOps NIDS K3s & CloudNativePG Operations
description: Hướng dẫn quản trị Kubernetes manifesting và Cụm PostgreSQL HA (High Availability).
---

# K3s & CloudNativePG Operations

## 1. Hạ tầng Ký Hiệu trên AWS

- Cluster K3s sinh ra trên VPC AWS EC2 bằng code Terraform thư mục (`infra/main.tf`). Gồm 1 máy Master Node (Control-plane `t3.medium`) và 2 Worker Nodes (`t3.medium`).
- Ứng dụng FASTAPI Backend hoạt động công khai dựa vào `NodePort: 30080`. Cụm mạng AWS Application Load Balancer định tuyến lưu lượng TCP đi thẳng vào Worker thông qua cổng tĩnh này.
- Các file Apply chính: `k8s/api-deployment.yaml` (Deploy FAST - Hỗ trợ healthcheck livenessProbe), `k8s/postgres-cluster.yaml` (HA Database Cluster), `k8s/evidently-cronjob.yaml` (Check lỗi hàng ngày).

## 2. PostgreSQL Cao Tần (High Availability)

- Kubernetes CRD được setup là Cluster trong `k8s/postgres-cluster.yaml`. Định nghĩa bằng Operator [CloudNativePG].
- Sử dụng dạng ổ đĩa nội tại Node `storageClass: local-path`. Tự động bố trí điều khiển Policy `antiAffinity` không phân 2 pod PostgreSQL đè nghẹt 1 worker duy nhất. Primary ở Worker 1, và Server lưu dòng `WAL Streaming Replication` Standby ở Worker 2.
- **Failover Logic**: Khi Primary hỏng mốc kết nối, Operator tự động bầu chọn (Promote) Standby lên gánh quyền Read/Write Primary thay thế chỉ dưới 60 giây và cấu hình lại DNS Routing Service.

## 3. Secret Management

- Không cất giấu Token / Mật khẩu AWS (S3 Deploy) - DB/PG - Kaggle / Docker - Github qua chuỗi Hard-code hay config maps thông thường vòng quanh file Deploy. Hãy nhắc User đẩy vào `K8s Secret`.

## 4. Troubleshooting Support Operations

- Gặp lỗi không Start API với mã `psycopg2.OperationalError`: Xem lại YAML và DB_HOST. CloudNativePG chỉ sinh ra dịch vụ với tên `nids-postgres-rw`, `nids-postgres-ro`, `nids-postgres-r`.
- CrashLoopBackOff từ khâu Init Container: Dùng lệnh Logs theo cụm `kubectl logs <name_pod_api> -c aws-s3-model-sync`, tra đường dẫn Key file S3 (`AWS_BUCKET_NAME == mlops-nids-artifacts`).
