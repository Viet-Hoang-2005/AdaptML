<div align="center">

# MLOps NIDS System

### An End-to-End MLOps Architecture for Data Drift Monitoring and Continuous Retraining in Network Intrusion Detection Systems

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![XGBoost](https://img.shields.io/badge/XGBoost-F1%3E99%25-FF6600?style=flat-square)](https://xgboost.readthedocs.io)
[![Kubernetes](https://img.shields.io/badge/K3s-v1.34-326CE5?style=flat-square&logo=kubernetes&logoColor=white)](https://k3s.io)
[![AWS](https://img.shields.io/badge/AWS-Terraform-FF9900?style=flat-square&logo=amazonaws&logoColor=white)](https://aws.amazon.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

**Học phần:** NT114 - Đồ án Chuyên ngành · Khoa Mạng máy tính và Truyền thông dữ liệu · UIT

| Thành viên | Email | Phụ trách |
|---|---|---|
| Trần Nguyễn Việt Hoàng | 23520541@gm.uit.edu.vn | MLOps Architecture + FastAPI + Evidently AI + Training Pipeline |
| Bùi Ngọc Thái          | 23521412@gm.uit.edu.vn | K3s Operations + Terraform/AWS + CI/CD + CloudNativePG          |

</div>


---

## 1. Tổng quan

Hệ thống này là một **MLOps pipeline hoàn chỉnh end-to-end** được xây dựng chuyên biệt cho bài toán phát hiện tấn công mạng (NIDS). Điểm nổi bật là khả năng **tự vận hành khép kín**: tự phát hiện khi dữ liệu thực tế bị lệch so với dữ liệu training, tự kích hoạt quá trình tái huấn luyện, và tự triển khai model mới mà **không gây gián đoạn dịch vụ** (zero-downtime).

```
Client Traffic → FastAPI (Inference) → PostgreSQL (Logging)
                                              ↓
                                   Evidently AI (Daily Drift Check)
                                              ↓ drift detected
                                   run_ai_pipeline.py (Local Orchestrator)
                                              ↓
                              Kaggle Compute → MLflow Registry → Evaluation Gate
                                              ↓ approved
                                   GitHub Actions (Deploy + Sync)
```

> **Kiến trúc MLflow-Centric:** `run_ai_pipeline.py` (Local Orchestrator) đóng vai trò nhạc trưởng — gọi Kaggle, ghi metrics vào MLflow, chạy Evaluation Gate, và bắn webhook sang GitHub Actions chỉ để deploy. GitHub Actions giảm từ **4 jobs → 2 jobs**.

---

## 2. Tính năng Cốt lõi

| # | Tính năng | Công nghệ |
|---|---|---|
| 1 | **Phân loại tấn công mạng** BENIGN / DDoS / PortScan với F1 > 99% | XGBoost + CIC-IDS2017 |
| 2 | **Low-latency inference** < 100ms, model nạp vào RAM | FastAPI + Uvicorn |
| 3 | **Async logging** mọi request vào DB mà không tăng latency | BackgroundTasks + PostgreSQL |
| 4 | **PostgreSQL HA** Primary + Standby, auto failover < 60s | CloudNativePG + K3s |
| 5 | **Daily drift detection** 0h UTC, phân tích phân phối 70+ features | Evidently AI + CronJob |
| 6 | **Automated retraining** khi drift ≥ 50%, không cần can thiệp thủ công | Kaggle API + Local Orchestrator |
| 7 | **MLflow Model Registry** — Nguồn sự thật DUY NHẤT về model versions | MLflow + PostgreSQL Backend |
| 8 | **Model quality gate** — chỉ promote model mới khi vượt Champion | `mlflow_evaluation_gate.py` |
| 9 | **Zero-downtime deployment** Rolling update + Init Container kéo model từ S3 | K3s + AWS S3 |
| 10 | **Closed-loop feedback** — baseline tự cập nhật sau mỗi lần retrain | K8s Job + PostgreSQL |
| 11 | **Load testing & drift simulation** giả lập DDoS / PortScan đồng thời | Locust |

---
## 3. Kiến trúc Hệ thống

> Xem sơ đồ Mermaid chi tiết tại: [ARCHITECTURE.md](ARCHITECTURE.md)

```
                        ┌──────────────────────────────────────────────┐
                        │              AWS ap-southeast-1              │
 Users / Locust ───────►│ ALB (Public)                                 │
                        │   │                                          │
                        │   ▼                                          │
                        │ K3s Cluster (1 Master + 2 Workers)           │
                        │ ┌──────────────────────────────────────────┐ │
                        │ │ FastAPI Pods (x2, ClusterIP)             │ │
                        │ │   Ingress: Traefik (Port 80)             │ │
                        │ └─────────┬────────────────────────────────┘ │
                        │           │ INSERT (async)                   │
                        │           ▼                                  │
                        │ ┌──────────────────────────────────────────┐ │
                        │ │ CloudNativePG PostgreSQL                 │ │
                        │ │ Primary ←→ Standby (HA)                  │ │
                        │ │ ┌─────────┬──────────┐                   │ │
                        │ │ │ nids_db │ mlflow   │ ← DB chia sẻ      │ │
                        │ │ └─────────┴──────────┘                   │ │
                        │ └──────────────────────────────────────────┘ │
                        │           │ SELECT (daily)                   │
                        │           ▼                                  │
                        │ ┌──────────────────────────────────────────┐ │
                        │ │ Evidently CronJob                        │ │
                        │ │ 0h UTC · Drift Analysis                  │ │
                        │ └─────────┬────────────────────────────────┘ │
                        │           │ drift detected                   │
                        │           ▼                                  │
                        │ ┌──────────────────────────────────────────┐ │
                        │ │ run_ai_pipeline.py                       │ │ ← ★ Nhạc
                        │ │ (Local Orchestrator)                     │ │   trưởng
                        │ └─────────┬────────────────────────────────┘ │
                        │           │ Kaggle API                       │
                        │           ▼                                  │
                        │ ┌──────────────────────────────────────────┐ │
                        │ │ Kaggle Compute Engine                    │ │
                        │ │ train.py · XGBoost                       │ │
                        │ └─────────┬────────────────────────────────┘ │
                        │           │ upload artifact to S3            │
                        │           ▼                                  │
                        │ ┌──────────────────────────────────────────┐ │
                        │ │ MLflow Server                            │ │ ← ★ MLflow
                        │ │ Master Node :30000                       │ │   Centric
                        │ │ PostgreSQL Backend                       │ │
                        │ └─────────┬────────────────────────────────┘ │
                        │           │ query + register                 │
                        │           ▼                                  │
                        │ ┌──────────────────────────────────────────┐ │
                        │ │ mlflow_evaluation_gate.py                │ │
                        │ │ → Webhook if APPROVED                    │ │
                        │ └─────────┬────────────────────────────────┘ │
                        │           │ webhook: deploy_new_champion     │
                        │           ▼                                  │
                        │ ┌──────────────────────────────────────────┐ │
                        │ │ GitHub Actions (2 Jobs)                  │ │
                        │ │ Deploy + Sync only                       │ │
                        │ └──────────────────────────────────────────┘ │
                        └──────────────────────────────────────────────┘
                                                   ▲
                                                   │ model artifacts
                                        S3 (mlops-nids-artifacts)
```
---

## 4. Technology Stack

| Layer | Technology |
|---|---|
| **Machine Learning** | XGBoost + Scikit-learn + Pandas + MLflow |
| **Model Serving** | FastAPI + Uvicorn + Python 3.10 |
| **Model Registry** | MLflow Model Registry (K3s Master Node) |
| **Database (HA)** | PostgreSQL 15 + CloudNativePG + SQLAlchemy |
| **Drift Monitoring** | Evidently AI + DataDriftPreset + K8s CronJob |
| **Orchestration** | Local Python (`run_ai_pipeline.py`) |
| **Load Testing** | Locust |
| **Compute Engine** | Kaggle Kernels API |
| **CI/CD** | GitHub Actions (2 Jobs: Deploy + Sync) |
| **Container Registry** | Docker Hub + GHCR (MLflow) |
| **Artifact Storage** | AWS S3 (`mlops-nids-artifacts`) |
| **Orchestration K8s** | K3s (Kubernetes) |
| **Infrastructure** | Terraform + AWS (VPC + EC2 + ALB + S3) |

---

## 5. Hướng dẫn Cài đặt

### Yêu cầu Hệ thống

| Thành phần | Tối thiểu | Khuyến nghị |
|---|---|---|
| Python | 3.10+ | 3.10 |
| Docker & Docker Compose | v24+ | Latest |
| RAM | 4 GB | 8 GB |
| OS | Windows 10+ / Ubuntu 20.04+ | Ubuntu 22.04 |

---

### 5.1 Chạy Local (Docker Compose)

**Bước 1: Clone repository**

```bash
git clone https://github.com/Viet-Hoang-2005/MLOps-nids-system.git
cd mlops-nids-system
```

**Bước 2: Cấu hình biến môi trường**

```bash
cp .env.example .env
```

**Bước 3: Build và khởi chạy**

```bash
docker-compose up --build

# Theo dõi log API
docker-compose logs -f api

# Theo dõi Data Drift bằng Evidently
docker-compose logs -f evidently
```

**Bước 4: Kiểm tra hoạt động**

```bash
# Health check
curl http://localhost:5000/

# Test predict endpoint
python web/src/test_api.py

# Locust test
locust -f web/src/locustfile.py --host=http://localhost:5000
```

Locust Dashboard: `http://localhost:8089`
API Swagger UI: `http://localhost:5000/docs`

**Dừng hệ thống:**

```bash
docker-compose down
```

---

### 5.2 Triển khai Production (K3s trên AWS EC2)

#### Bước 1: Khởi tạo hạ tầng AWS bằng Terraform

```bash
cd infra/
terraform init
terraform plan
terraform apply
```

#### Bước 2: Cài đặt K3s

```bash
# Tren Master Node
curl -sfL https://get.k3s.io | sh -
sudo cat /etc/rancher/k3s/k3s.yaml  # Copy vao GitHub Secret KUBE_CONFIG

# Tren moi Worker Node (thay TOKEN va MASTER_IP)
curl -sfL https://get.k3s.io | K3S_URL=https://<MASTER_IP>:6443 K3S_TOKEN=<TOKEN> sh -
```

#### Bước 3: Cài đặt CloudNativePG Operator

```bash
kubectl apply --server-side -f \
  https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.22/releases/cnpg-1.22.0.yaml
kubectl wait --for=condition=ready pod -n cnpg-system \
  -l app.kubernetes.io/name=cloudnative-pg --timeout=120s
```

#### Bước 4: Tạo Kubernetes Secrets

```bash
# AWS credentials (cho Init Container keo model tu S3)
kubectl create secret generic aws-secrets \
  --from-literal=AWS_ACCESS_KEY_ID="<your-key>" \
  --from-literal=AWS_SECRET_ACCESS_KEY="<your-secret>"

# MLflow PostgreSQL credentials
kubectl create secret generic postgres-secrets \
  --from-literal=POSTGRES_USER="postgres" \
  --from-literal=POSTGRES_PASSWORD="<strong-password>"

# GitHub Token (cho run_ai_pipeline.py ban webhook)
kubectl create secret generic github-secrets \
  --from-literal=GITHUB_TOKEN="<your-token>"
```

#### Bước 5: Khởi tạo MLflow Database (chi 1 lan)

```bash
kubectl apply -f k8s/init-mlflow-db.yaml
kubectl wait --for=condition=complete job/mlflow-db-init --timeout=120s
```

#### Bước 6: Deploy MLflow Server (NodePort 30000)

```bash
kubectl apply -f k8s/mlflow-deployment.yaml
kubectl get pods -l app=mlflow-server
# Truy cap: http://<master-ip>:30000
```

#### Bước 7: Deploy toàn bộ hệ thống

```bash
# PostgreSQL Cluster (Primary + Standby)
kubectl apply -f k8s/postgres-cluster.yaml
kubectl wait --for=condition=Ready cluster/nids-postgres --timeout=180s

# FastAPI Server
kubectl apply -f k8s/api-deployment.yaml

# Evidently CronJob
kubectl apply -f k8s/evidently-cronjob.yaml

kubectl get pods,services,cronjob -o wide
```

#### Bước 8: Cấu hình GitHub Secrets

| Secret | Mô tả |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub username |
| `DOCKERHUB_TOKEN` | Docker Hub Access Token |
| `AWS_ACCESS_KEY_ID` | AWS IAM Access Key |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM Secret Key |
| `KUBE_CONFIG` | Nội dung file `~/.kube/config` từ Master Node |
| `KAGGLE_USERNAME` | Kaggle username |
| `KAGGLE_KEY` | Kaggle API Key |
| `DB_HOST` | IP Public của PostgreSQL / Master Node |
| `DB_USER` | `postgres` |
| `DB_PASSWORD` | Password đã đặt ở Bước 4 |

---

### 5.3 Kiểm thử Hệ thống

```bash
# Test API
python web/src/test_api.py

# Load test
pip install locust
locust -f web/src/locustfile.py --host=http://localhost:5000
# Locust Dashboard: http://localhost:8089

# Chạy MLflow Evaluation Gate thủ công
python orchestration/mlflow_evaluation_gate.py
# Exit code 0 = APPROVED, Exit code 1 = REJECTED

# Chạy Local Orchestrator thủ công
python orchestration/run_ai_pipeline.py --trigger manual
```

### 5.4 Xử lý sự cố Thường gặp

| Vấn đề | Nguyên nhân | Giải pháp |
|---|---|---|
| Port 5000/5432 bị chiếm | Có service khác đang chạy | `docker-compose down` |
| `psycopg2.OperationalError` | `DB_HOST` sai | Local: `localhost`; K3s: `nids-postgres-rw` |
| Init Container fail | S3 path hoặc credentials sai | `kubectl logs <pod> -c aws-s3-model-sync` |
| Evidently skip analysis | Production data < 100 mẫu | Chạy Locust thêm để tạo đủ data |
| CloudNativePG cluster pending | Operator chưa ready | `kubectl get pods -n cnpg-system` |
| MLflow UI không truy cập được | NodePort 30000 chưa mở | Kiểm tra Security Group Master Node |

---

## 6. Cấu trúc Thư mục

```
mlops-nids-system/
├── .github/
│   ├── workflows/
│   │   ├── ci_cd_pipeline.yml        # Build -> Push Docker -> Deploy K3s
│   │   └── retrain_pipeline.yml      # ★ TO-BE: 2 Jobs (Deploy + Sync)
│   └── scripts/
│       ├── evaluate_model.py         # Legacy (chỉ dùng trong CI/CD thử nghiệm)
│       ├── update_reference_data.py  # Đồng bộ baseline sau retrain
│       └── extract_data.py           # Trích xuất dataset từ CIC-IDS2017
├── api/
│   ├── src/
│   │   ├── index.py                  # GET + POST /predict
│   │   └── db_manager.py             # Dual-endpoint: engine_rw + engine_ro
│   ├── Dockerfile
│   └── requirements.txt
├── monitoring/
│   ├── detect_drift.py               # Evidently AI + nids-postgres-ro
│   ├── Dockerfile
│   └── requirements.txt
├── orchestration/                    # ★ TO-BE: Local Orchestrator
│   ├── run_ai_pipeline.py           # Nhạc trưởng: Kaggle -> MLflow -> Gate -> Webhook
│   ├── mlflow_evaluation_gate.py    # Evaluation Gate: query MLflow, approve/reject
│   └── register_models_to_mlflow.py  # Đăng ký v1, v2 vào MLflow Registry
├── kaggle_training/
│   ├── train.py                     # XGBoost + MLflow logging + Hyperparameter Tuning
│   └── kernel-metadata.json
├── k8s/
│   ├── api-deployment.yaml           # FastAPI + Init Container + ClusterIP
│   ├── postgres-cluster.yaml         # CloudNativePG Primary + Standby
│   ├── mlflow-deployment.yaml        # ★ TO-BE: MLflow Server trên Master Node (Port 30000)
│   ├── init-mlflow-db.yaml           # ★ TO-BE: Khởi tạo database + user mlflow
│   └── evidently-cronjob.yaml        # CronJob 0h UTC daily
├── infra/
│   ├── main.tf                      # VPC + EC2 + ALB + S3 (Terraform)
│   └── variables.tf
├── web/src/
│   ├── test_api.py                  # Basic API test
│   └── locustfile.py                # Stress test + drift simulation
├── models/
│   ├── v1/                          # 2-class: BENIGN + DDoS
│   └── v2/                          # 3-class: + PortScan
├── docs/
│   └── MLFLOW_INTEGRATION_ARCHITECTURE.md  # ★ TO-BE: Kiến trúc MLflow-Centric chi tiết
├── data_manifest.json                # "Source of Trust": target_csv + model_version
├── docker-compose.yml               # Local development environment
└── .env.example                    # Environment variable template
```

---

## 7. Tài liệu Liên quan

| Tài liệu | Mô tả |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kiến trúc chi tiết, diagrams, database schema |
| [CHANGELOG.md](CHANGELOG.md) | Lịch sử phát triển theo từng giai đoạn |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Quy tắc đóng góp, branch naming, commit convention |

---

_Developed for UIT · NT114 · MLOps NIDS System Project_
