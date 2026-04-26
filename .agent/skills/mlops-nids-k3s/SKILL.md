---
name: mlops-nids-k3s
description: Hướng dẫn quản trị Kubernetes manifesting và Cụm PostgreSQL HA (High Availability).
---

# K3s & CloudNativePG Operations

## 1. Hạ tầng Ký Hiệu trên AWS & Luồng Mạng (Networking)

- Cluster K3s sinh ra trên VPC AWS EC2 bằng code Terraform thư mục (`infra/main.tf`). Gồm 1 máy Master Node `t3.small` (Control-plane, IP: 10.0.1.112) và 2 Worker Nodes `t3.large` (Worker 1: IP: 10.0.2.221, Worker 2: 10.0.2.206).
- AWS Application Load Balancer định tuyến lưu lượng TCP đi thẳng vào cổng 80 của các Worker. Tại đây, bộ định tuyến `Traefik Ingress` (được tích hợp sẵn trong K3s) sẽ đón luồng traffic và điều hướng tới Service nội bộ của FastAPI thông qua `type: ClusterIP`.
- Các file Manifest chính: `k8s/api-deployment.yaml` (Deploy API, InitContainer, Ingress), `k8s/postgres-cluster.yaml` (HA Database Cluster), `k8s/redpanda-statefulset.yaml` (Kafka Broker stateful), `k8s/mlflow-deployment.yaml` (MLflow server ép chạy trên Worker Node bằng nodeAffinity).

## 2. Quản trị PostgreSQL Cao Tần (High Availability)

- Kubernetes CRD được setup là Cluster trong `k8s/postgres-cluster.yaml`. Định nghĩa bằng Operator [CloudNativePG].
- Sử dụng dạng ổ đĩa nội tại Node `storageClass: local-path`. Tự động bố trí điều khiển Policy `antiAffinity` không phân 2 pod PostgreSQL đè nghẹt 1 worker duy nhất. Primary ở Worker 1, và Server lưu dòng `WAL Streaming Replication` Standby ở Worker 2.
- Khi Primary hỏng kết nối, Operator tự động bầu chọn (Promote) Standby lên gánh quyền Read/Write Primary thay thế chỉ trong khoảng 5-10 giây và tự động định tuyến lại Service.

## 3. Secret Management

- Không cất giấu Token / Mật khẩu AWS (S3 Deploy) - DB/PG - Kaggle / Docker - Github qua chuỗi Hard-code hay config maps thông thường vòng quanh file Deploy. Hãy nhắc User đẩy vào `K8s Secret`.

## 4. Troubleshooting Support Operations

- Gặp lỗi không Start API với mã `psycopg2.OperationalError`: Xem lại YAML và DB_HOST. CloudNativePG chỉ sinh ra dịch vụ với tên `nids-postgres-rw`, `nids-postgres-ro`, `nids-postgres-r`.
- CrashLoopBackOff từ khâu Init Container: Dùng lệnh Logs theo cụm `kubectl logs <name_pod_api> -c aws-s3-model-sync`, tra kiểm tra xem các biến `RUN_ID` và `EXPERIMENT_ID` truyền từ GitHub Action có chính xác với đường dẫn MLflow S3 Artifacts hay không.
