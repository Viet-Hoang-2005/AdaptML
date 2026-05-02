<div align="center">

# MLOps NIDS System

### An End-to-End MLOps Architecture for Data Drift Monitoring and Continuous Retraining in Network Intrusion Detection Systems

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![XGBoost](https://img.shields.io/badge/XGBoost-F1%3E99%25-FF6600?style=flat-square)](https://xgboost.readthedocs.io)
[![MLflow](https://img.shields.io/badge/MLflow-2.x-0194E2?style=flat-square&logo=mlflow&logoColor=white)](https://mlflow.org)
[![Evidently AI](https://img.shields.io/badge/Evidently_AI-0.4.x-6D31FF?style=flat-square)](https://evidentlyai.com)
[![Kubernetes](https://img.shields.io/badge/K3s-v1.34-326CE5?style=flat-square&logo=kubernetes&logoColor=white)](https://k3s.io)
[![AWS](https://img.shields.io/badge/AWS-Terraform-FF9900?style=flat-square&logo=amazonaws&logoColor=white)](https://aws.amazon.com)

**Học phần:** NT114 - Đồ án Chuyên ngành · Khoa Mạng máy tính và Truyền thông dữ liệu · UIT

| Thành viên             | Email                  | Phụ trách                                                       |
| ---------------------- | ---------------------- | --------------------------------------------------------------- |
| Trần Nguyễn Việt Hoàng | 23520541@gm.uit.edu.vn | MLOps Architecture + FastAPI + Evidently AI + Training Pipeline |
| Bùi Ngọc Thái          | 23521412@gm.uit.edu.vn | K3s Operations + Terraform/AWS + CI/CD + MLflow                 |

</div>

---

## 1. Tổng quan ⭐

Hệ thống này là một **MLOps pipeline hoàn chỉnh end-to-end** được xây dựng chuyên biệt cho bài toán phát hiện hành vi trôi dữ liệu (Data Drift) cho mô hình học máy phân loại các hình thức tấn công mạng (NIDS). Điểm nổi bật là khả năng **tự vận hành khép kín**: tự phát hiện khi dữ liệu thực tế bị lệch so với dữ liệu training, tự kích hoạt quá trình tái huấn luyện, và tự triển khai model mới mà **không gây gián đoạn dịch vụ** (zero-downtime).

```
Inference Traffic
        │
        │ (/predict)
        ▼
FastAPI (Producer) ────► Redpanda (Message Queue) + Consumer (Batch DB Writer)
        ▲                                           │
        │                                           │
        │                                           ▼
    K3s Deploy (Rolling Update)             PostgreSQL (Production + References)
        ▲                                           │
        │                                           │
        │                                           ▼
    Sync Data + AWS S3 (Upload)             Evidently AI (Drift Check Job)
        ▲                                           │
        │                                           │
        │                                           ▼
    Kaggle + MLflow Registry ◄──── GitHub Actions (Retrain Pipeline) ◄──── AWS S3 + Lambda
```

---

## 2. Tính năng Cốt lõi ✨

| #   | Tính năng                                                                     | Công nghệ                  |
| --- | ----------------------------------------------------------------------------- | -------------------------- |
| 1   | **Phân loại tấn công mạng** BENIGN / DDoS / PortScan với F1 > 99%             | XGBoost + CIC-IDS2017      |
| 2   | **Low-latency inference** < 100ms, model nạp vào RAM                          | FastAPI + Uvicorn          |
| 3   | **Event-driven streaming** chịu tải dữ liệu lớn với cơ chế Producer-Consumer  | Redpanda + Consumer        |
| 4   | **PostgreSQL HA** Primary + Standby, auto failover < 60s                      | CloudNativePG              |
| 5   | **Automated drift detection** tự động kích hoạt qua Webhook theo ngưỡng mẫu   | Evidently AI               |
| 6   | **Automated retraining** kích hoạt bởi S3/Evidently, train trên Kaggle GPU    | AWS Lambda + Kaggle        |
| 7   | **Model Registry & HitL** - Quản lý vòng đời model và phê duyệt thủ công      | MLflow Registry            |
| 8   | **Zero-downtime deployment** Rolling update + Kéo model bằng RUN_ID từ MLflow | GitHub Actions + K3s       |
| 9   | **Load testing & drift simulation** giả lập DDoS / PortScan đồng thời         | Locust                     |
| 10  | **Zero-trust & Keyless Security** - Xác thực OIDC, loại bỏ mật khẩu tĩnh      | AWS OIDC + Secrets Manager |
| 11  | **Full-stack Observability** - Giám sát API, DB, Redpanda và ML metrics       | Prometheus + Grafana       |
| 12  | **Smart Alerting** - Cảnh báo DDoS, Latency cao qua Slack                     | AlertManager + Slack       |

---

## 3. Kiến trúc Hệ thống 🏛️

![MLOPs NIDS System Architecture](assets/pictures/MLOps-NIDS-Architecture.png)

> Xem chi tiết kiến trúc và các diagram tại [ARCHITECTURE.md](ARCHITECTURE.md)

---

## 4. Công nghệ sử dụng ⚙️

| Layer                  | Technology                                 |
| ---------------------- | ------------------------------------------ |
| **Machine Learning**   | XGBoost + Scikit-learn + Pandas + MLflow   |
| **Model Serving**      | FastAPI + Uvicorn + Python 3.10            |
| **Message Broker**     | Redpanda (Kafka-compatible)                |
| **Database (HA)**      | PostgreSQL 15 + CloudNativePG + SQLAlchemy |
| **Drift Monitoring**   | Evidently AI                               |
| **Load Testing**       | Locust                                     |
| **Compute Engine**     | Kaggle Kernels API                         |
| **CI/CD/CT/Orch**      | GitHub Actions + AWS Lambda                |
| **Container Registry** | Docker Hub                                 |
| **Model Registry**     | MLflow + AWS S3                            |
| **Orchestration**      | K3s (Kubernetes)                           |
| **Infrastructure**     | Terraform + AWS (VPC + EC2 + ALB + S3)     |
| **Secrets Mgmt**       | AWS Secrets Manager + External Secrets Op  |
| **Observability**      | Prometheus + Grafana + AlertManager        |

---

## 5. Cấu trúc Thư mục 📁

```
mlops-nids-system/
│
├── .github/workflows/
│   ├── ci_cd_pipeline.yml           # Build Docker Image -> Push Docker Hub -> Rolling Deploy K3s
│   ├── retrain_pipeline.yml         # Nhận Webhook -> Tải dữ liệu S3 -> Kích hoạt Kaggle Kernel
│   ├── deploy_from_mlflow.yml       # Nhận RUN_ID từ Dispatch -> Rolling Update API trên K3s
│   ├── trigger_drift_check.yml      # Lắng nghe Webhook từ Consumer -> Chạy Evidently Job
│   └── drift_alert.yml              # Gửi Slack Alert khi phát hiện Data Drift
│
├── api/
│   ├── src/
│   │   ├── index.py                 # FastAPI: POST /predict -> Ghi vào Redpanda
│   │   ├── consumer.py              # Redpanda Consumer: Batch insert DB -> Bắn Drift Webhook
│   │   └── db_manager.py            # Dual-endpoint SQLAlchemy: engine_rw + engine_ro
│   ├── Dockerfile
│   └── requirements.txt
│
├── mlflow/
│   ├── dispatch_production_model.py # CronJob: Đọc MLflow Registry -> Bắn Deploy Webhook
│   ├── Dockerfile
│   └── requirements.txt
│
├── monitoring/
│   ├── detect_drift.py              # Evidently AI: Query DB -> So sánh với Baseline -> Report
│   ├── Dockerfile
│   └── requirements.txt
│
├── kaggle/
│   ├── train.py                     # XGBoost Training: S3 Data -> MLflow Tracking + Artifact
│   └── kernel-metadata.json         # Kaggle Kernel config (source, dataset, environment)
│
├── k8s/
│   ├── api-deployment.yaml          # FastAPI (2 replicas) + Init Container kéo model từ S3
│   ├── consumer-deployment.yaml     # NIDS Log Consumer
│   ├── dispatch-cronjob.yaml        # CronJob chạy dispatch_production_model.py mỗi 5 phút
│   ├── evidently-job.yaml           # Batch Job phát hiện Data Drift (trigger qua Webhook)
│   ├── mlflow-deployment.yaml       # MLflow Tracking Server + PostgreSQL Backend + S3 Artifacts
│   ├── mlflow-nginx.yaml            # Nginx Reverse Proxy + Basic Auth cho MLflow
│   ├── mlflow-init-job.yaml         # One-time Job: Tạo role/database mlflow trong PostgreSQL
│   ├── postgres-cluster.yaml        # CloudNativePG Cluster (Primary + Standby HA)
│   ├── redpanda-statefulset.yaml    # Redpanda Message Broker (Kafka-compatible)
│   ├── cloudflared-tunnel.yaml      # Cloudflare Tunnel: Expose MLflow qua HTTPS không cần IP
│   ├── cluster-secret-store.yaml    # ESO ClusterSecretStore: Kết nối K3s với AWS Secrets Manager
│   ├── external-secrets.yaml        # ExternalSecret: Đồng bộ 6 nhóm Secret từ AWS về K3s
│   ├── sync-data-job.yaml           # One-time Job: Nạp Reference Data vào PostgreSQL
│   ├── eso-install.sh               # Script cài đặt External Secrets Operator qua Helm
│   ├── monitoring-install.sh        # Script cài đặt Prometheus & Grafana Stack
│   ├── api-servicemonitor.yaml      # Cấu hình Prometheus scrape FastAPI
│   ├── redpanda-servicemonitor.yaml # Cấu hình Prometheus scrape Redpanda
│   ├── postgres-exporter.yaml       # Exporter cho PostgreSQL (RO endpoint)
│   ├── grafana-alertrules.yaml      # Định nghĩa luật cảnh báo (DDoS, Latency...)
│   └── grafana-cloudflared.yaml     # Expose Grafana Dashboard ra internet
│
├── infra/
│   ├── main.tf                      # Terraform: VPC + EC2 + ALB + S3 + Lambda + IAM + OIDC
│   └── lambda/
│       ├── s3_webhook_trigger.py    # Lambda: S3 Event -> Lấy Secret từ AWS -> Bắn GitHub Webhook
│       └── s3_webhook_trigger.zip   # Lambda deployment package
│
├── web/src/
│   ├── test_api.py                  # Script test API: Đo latency + Đánh giá kết quả dự đoán
│   └── locustfile.py                # Stress test: Giả lập traffic + Kích hoạt Data Drift
│
├── models/
│   ├── v1/                          # Model 2-class: BENIGN + DDoS
│   │   ├── xgb_nids_model_v1.pkl
│   │   ├── label_classes_v1.json
│   │   └── metrics_v1.json
│   └── v2/                          # Model 3-class: + PortScan
│
├── data/
│   ├── test_data.csv                # Dữ liệu kiểm thử API (đa nhãn)
│   ├── train_2_classes.csv          # Dữ liệu huấn luyện 2 nhãn (BENIGN/DDoS)
│   ├── train_3_classes.csv          # Dữ liệu huấn luyện 3 nhãn (BENIGN/DDoS/PortScan)
│   └── drift_portscan.csv           # Dữ liệu giả lập drift PortScan
│
├── data_manifest.json               # "Source of Truth": target_csv + model_version -> Trigger Lambda
├── docker-compose.yml               # Môi trường phát triển local (API + DB + Redpanda + Evidently)
└── .env.example                     # Template biến môi trường
```

---

## 6. Hướng dẫn Cài đặt 🛠️

### 6.1 Chạy Local (Docker Compose)

#### Yêu cầu Hệ thống

| Thành phần | Tối thiểu                   | Khuyến nghị  |
| ---------- | --------------------------- | ------------ |
| Python     | 3.10                        | 3.10+        |
| Docker     | v24                         | Latest       |
| RAM        | 4 GB                        | 8 GB         |
| OS         | Windows 10+ / Ubuntu 20.04+ | Ubuntu 22.04 |

#### Bước 1: Clone repository

```bash
git clone https://github.com/Viet-Hoang-2005/MLOps-nids-system.git
cd MLOps-nids-system
```

#### Bước 2: Cấu hình biến môi trường

```bash
cp .env.example .env
```

#### Bước 3: Build và khởi chạy

```bash
docker-compose up --build

# Theo dõi log API
docker-compose logs -f api

# Theo dõi log Consumer
docker-compose logs -f consumer

# Theo dõi Data Drift bằng Evidently
docker-compose logs -f evidently
```

#### Bước 4: Kiểm tra hoạt động

```bash
# Health check
curl http://localhost:5000/

# Test predict endpoint
python web/src/test_api.py

# Stress test
locust -f web/src/locustfile.py --host=http://localhost:5000
```

API Swagger UI: `http://localhost:5000/docs`  
Locust Dashboard: `http://localhost:8089`  
Redpanda Console: `http://localhost:8080`  
MLflow Tracking Server: `http://localhost:5001`  
Grafana Dashboard: `http://localhost:3000`  
PostgreSQL: `http://localhost:5432`

---

### 6.2 Triển khai Production (K3s trên AWS EC2)

#### Bước 1: Khởi tạo hạ tầng AWS bằng Terraform

```bash
cd infra/
terraform init
terraform plan
terraform apply
```

#### Bước 2: Khởi tạo dữ liệu trên AWS Secrets Manager

1. Secret Name: `mlops/github-actions-secrets` (Dành cho CI/CD)

```json
{
  "DOCKERHUB_USERNAME": "<your-dockerhub-username>",
  "DOCKERHUB_TOKEN": "<your-dockerhub-token>",
  "KAGGLE_USERNAME": "<your-kaggle-username>",
  "KAGGLE_API_TOKEN": "<your-kaggle-api-token>",
  "SLACK_WEBHOOK_URL": "<your-slack-webhook-url>",
  "MLFLOW_TRACKING_URI": "<your-mlflow-tracking-uri>",
  "KUBE_CONFIG": "<your-kube-config-base64>"
}
```

2. Secret Name: `mlops/github-secrets` (Dành cho Lambda Webhook)

```json
{
  "GITHUB_REPO": "<your-github-repo>",
  "GITHUB_TOKEN": "<your-github-token>"
}
```

3. Secret Name: `mlops/postgres-secrets` (Dành cho Database)

```json
{
  "POSTGRES_USER": "<your-postgres-user>",
  "POSTGRES_PASSWORD": "<your-postgres-password>",
  "POSTGRES_DB": "<your-postgres-db>"
}
```

4. Secret Name: `mlops/aws-secrets` (Dành cho K3s S3 Sync)

```json
{
  "AWS_ACCESS_KEY_ID": "<your-aws-access-key-id>",
  "AWS_SECRET_ACCESS_KEY": "<your-aws-secret-access-key>"
}
```

5. Secret Name: `mlops/tunnel-token` (Dành cho CloudFlare Tunnel)

```json
{
  "token": "<your-tunnel-token>"
}
```

6. Secret Name: `mlflow-basic-auth` (Dành cho MLflow Basic Auth)

```json
{
  "auth": "<your-mlflow-basic-auth-base64>"
}
```

#### Bước 3: Cấu hình GitHub Actions Variables (OIDC)

1. Truy cập Website AWS -> **IAM** -> **Roles** -> **mlops-github-actions-role**
2. Copy mã ARN vừa tìm được
3. Vào GitHub Repo -> **Settings** -> **Secrets and variables** -> **Actions** -> "Variables".
4. Tạo một biến mới tên là `AWS_ROLE_ARN` và dán giá trị ARN vào

#### Bước 4: Cài đặt K3s

```bash
# SSH vào Master Node
ssh -i .ssh/<your-aws-key> ubuntu@<public-ip-master-node>

# Cài đặt K3s trên Master Node
curl -sfL https://get.k3s.io | sh -

# Lấy chìa khóa gia nhập cụm K3s
sudo cat /var/lib/rancher/k3s/server/node-token

# SSH vào Worker Node từ Master Node
ssh ubuntu@<private-ip-worker-node>

# Worker Node gia nhập cụm K3s của Master Node
curl -sfL https://get.k3s.io | K3S_URL=https://<MASTER_IP>:6443 K3S_TOKEN=<TOKEN> sh -

# Kiểm tra trạng thái các node trên Master Node
kubectl get nodes

```

#### Bước 5: Triển khai hệ thống lên K3s Cluster

1. Cài đặt các Trình quản lý (Operators)

```bash
# Cài đặt CloudNativePG
kubectl apply --server-side -f https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.22/releases/cnpg-1.22.0.yaml
# Cài đặt External Secrets Operator
bash k8s/eso-install.sh
```

2. Kích hoạt hệ thống Bảo mật

```bash
# Đồng bộ Secret từ AWS về K3s
kubectl apply -f k8s/cluster-secret-store.yaml
kubectl apply -f k8s/external-secrets.yaml
# Kiểm tra các secrets
kubectl get secrets
```

3. Triển khai CloudFlare Tunnel

```bash
kubectl apply -f k8s/cloudflared-tunnel.yaml
```

4. Triển khai Database & Message Queue

```bash
# Khởi chạy cụm PostgreSQL HA
kubectl apply -f k8s/postgres-cluster.yaml
# Chạy Job insert dữ liệu References Data
kubectl apply -f k8s/sync-data-job.yaml
# Khởi chạy Redpanda (Kafka)
kubectl apply -f k8s/redpanda-statefulset.yaml
```

5. Triển khai MLflow Registry Server

```bash
# Chạy Job tạo bảng dữ liệu cho MLflow (chỉ chạy 1 lần)
kubectl apply -f k8s/mlflow-init-job.yaml
# Triển khai MLflow Server + Nginx Bảo mật + Cloudflare Tunnel
kubectl apply -f k8s/mlflow-deployment.yaml
kubectl apply -f k8s/mlflow-nginx.yaml
# Chạy lịch trình kiểm tra Model mới tự động mỗi 5 phút
kubectl apply -f k8s/dispatch-cronjob.yaml
```

6. Triển khai API & Consumer

```bash
# Triển khai API Server
kubectl apply -f k8s/api-deployment.yaml
# Triển khai Consumer
kubectl apply -f k8s/consumer-deployment.yaml
```

7. Kiểm tra Data drift

```bash
kubectl apply -f k8s/evidently-job.yaml
```

8. Triển khai Hệ thống Giám sát (Observability)

```bash
# Cài đặt Prometheus Stack (Prometheus + Grafana)
bash k8s/monitoring-install.sh

# Triển khai các ServiceMonitor và Exporters
kubectl apply -f k8s/postgres-exporter.yaml
kubectl apply -f k8s/api-servicemonitor.yaml
kubectl apply -f k8s/redpanda-servicemonitor.yaml

# Cấu hình Alerting và Expose Dashboard
kubectl apply -f k8s/grafana-alertrules.yaml
kubectl apply -f k8s/grafana-cloudflared.yaml
```

---

### 6.3 Kiểm thử Toàn bộ Pipeline (Demo Hội đồng)

#### Giai đoạn 0: Xác nhận hệ thống sẵn sàng

```bash
# 1. Kiểm tra trạng thái các pod
kubectl get pods,svc,cronjob

# 2. Kiểm tra init container đã kéo model từ S3
kubectl logs <api-pod-name> -c aws-s3-model-sync
```

#### Giai đoạn 1: Kiểm thử API Service

```bash
# 1. Theo dõi Consumer ghi dữ liệu vào DB
kubectl logs -f -l app=mlops-nids-consumer

# 2. Bắn tải với Locust (chạy trên máy local)
cd "MLOps-nids-system"
locust -f web/src/locustfile.py --host=http://mlops-api-lb-226955044.ap-southeast-1.elb.amazonaws.com

# 3. Kết nối PostgreSQL để đếm số bản ghi đã ghi
kubectl exec -it mlops-nids-postgres-1 -- psql -U postgres -d mlops_nids_db \
  -c "SELECT COUNT(*), label FROM nids_production_data GROUP BY label ORDER BY label;"
```

#### Giai đoạn 2: Kiểm thử phát hiện Data Drift

```bash
# 1. Xóa job cũ và chạy lại job kiểm tra drift ngay lập tức
kubectl replace --force -f k8s/evidently-job.yaml

# 2. Theo dõi kết quả kiểm tra
kubectl logs -f -l app=evidently-data-drift
```

#### Giai đoạn 3: Kiểm thử Continuous Training Pipeline

1. Upload `data_manifest.json` lên S3 để kích hoạt Lambda:

```bash
aws s3 cp data_manifest.json s3://mlops-nids-artifacts/data_manifest.json
```

2. Xác nhận Lambda đã nhận event (trên AWS Console):

```
AWS Console -> Lambda -> s3-webhook-trigger -> Monitor -> View CloudWatch Logs
Mong đợi: "Successfully triggered GitHub Actions retraining workflow"
```

3. Theo dõi GitHub Actions Retrain Pipeline:

```
GitHub Repo -> Tab Actions -> "MLOps NIDS - Controlled Retraining Pipeline"
```

4. Quan sát quá trình Retraining:

```
Setup -> Download Data from S3 -> Train on Kaggle GPU -> Quality Gate -> Register to MLflow
```

5. Xem model mới xuất hiện trên MLflow Registry:

```
MLflowUI (https://mlflow.mlops-nids-nt114.id.vn) -> Models -> NIDS-XGBoost
```

Kết quả mong đợi: Model mới ở stage `Staging` với metrics F1 > 0.99

#### Giai đoạn 4: Demo Zero-Downtime Deployment

1. Promote model lên `Production` trên MLflow UI:

```
MLflow UI -> Models -> NIDS-XGBoost -> Phiên bản mới -> Assign alias "production"
```

2. Dispatch CronJob tự phát hiện model mới và kích hoạt deploy:

```bash
# Ép CronJob chạy ngay
kubectl create job --from=cronjob/mlops-nids-dispatch dispatch-manual-$(date +%s)
kubectl logs -f -l job-name=dispatch-manual-<timestamp>
```

Mong đợi: `Production model found -> Dispatching deploy workflow to GitHub...`

3. Theo dõi GitHub Actions Deploy:

```
GitHub Repo -> Tab Actions -> "Deploy Production Model from MLflow"
```

4. Quan sát Rolling Update không gián đoạn (giữ Locust chạy xuyên suốt):

```bash
# Quan sát quá trình pod cũ -> pod mới mà không có downtime
kubectl get pods -l app=mlops-nids-api -w
```

Mong đợi trên Locust Dashboard: **Failure rate vẫn = 0%** trong toàn bộ quá trình rolling update.

5. Xác nhận API đang chạy model phiên bản mới:

```bash
curl http://mlops-api-lb-226955044.ap-southeast-1.elb.amazonaws.com/health
# Mong đợi: {"status": "ok", "model_version": "v2", ...}
```

#### Giai đoạn 5: Kiểm tra Giám sát & Cảnh báo (Observability)

1. Truy cập Grafana Dashboard:

- URL: `https://grafana.mlops-nids-nt114.id.vn`
- Đăng nhập bằng credentials trong AWS Secrets Manager (`mlflow-basic-auth`).

2. Quan sát các Dashboard quan trọng:

- **NIDS Performance:** Theo dõi `nids_predictions_total` và `nids_prediction_confidence`.
- **FastAPI Overview:** Theo dõi Request Latency (p95) và Error Rate.
- **PostgreSQL / Redpanda:** Theo dõi sức khỏe database và message queue.

3. Thử nghiệm Cảnh báo (Slack):

- Chạy Locust với số lượng user cực lớn để tạo traffic "DDoS" giả lập.
- Mong đợi: Nhận thông báo Slack từ AlertManager: `[FIRING] DDoSSpikeDetected`.

---

## 7. Tài liệu Tham khảo 📚

| Tài liệu                           | Mô tả                                              |
| ---------------------------------- | -------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kiến trúc chi tiết, diagrams, database schema      |
| [CHANGELOG.md](CHANGELOG.md)       | Lịch sử phát triển theo từng giai đoạn             |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Quy tắc đóng góp, branch naming, commit convention |

---

<div align="center">

_Developed for UIT · NT114 · MLOps NIDS System Project_

</div>
