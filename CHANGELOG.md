# Nhật ký Thay đổi (Changelog)

Tài liệu ghi lại toàn bộ lịch sử phát triển của dự án **MLOps Network Intrusion Detection System (NIDS)**.

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) và [Semantic Versioning](https://semver.org/).

---

## [Unreleased] - 2026-04-11

### Giai đoạn 4: Tái Cấu Trúc MLflow-Centric (Infrastructure & Orchestration Overhaul)

Giai đoạn chuyển đổi từ kiến trúc "GitHub Actions làm nhạc trưởng" sang **MLflow-Centric Architecture** — `run_ai_pipeline.py` (Local Orchestrator) đóng vai trò điều phối pipeline, MLflow Model Registry là nguồn sự thật DUY NHẤT về model versions, và GitHub Actions giảm từ 4 Jobs xuống còn 2 Jobs.

### ✨ Added - Tính năng mới

- **MLflow Server trên K3s Master Node** (`k8s/mlflow-deployment.yaml`):
  - Chạy trên Control Plane Node (Master Node), ổn định, không chạy workload người dùng
  - NodePort 30000 — MLflow UI truy cập từ bên ngoài cluster
  - Backend: CloudNativePG PostgreSQL (dùng chung cluster với `nids_db`) ★
  - Artifact root: `s3://mlops-nids-artifacts/mlflow-artifacts/`
  - Resource limits: `250m-1000m CPU`, `512Mi-2Gi RAM` — không ảnh hưởng etcd
  - AWS credentials từ Kubernetes Secret (`aws-secrets`)

- **Khởi tạo MLflow Database** (`k8s/init-mlflow-db.yaml`):
  - Kubernetes Job chạy 1 lần duy nhất khi setup hạ tầng
  - Tạo database `mlflow`, user `mlflow` với password `mlflow_password`
  - Retry loop `pg_isready` (60s timeout) — đợi CloudNativePG Primary sẵn sàng
  - Auto-cleanup sau 300s nhờ `ttlSecondsAfterFinished`

- **MLflow Evaluation Gate** (`orchestration/mlflow_evaluation_gate.py`):
  - Query trực tiếp PostgreSQL MLflow backend bằng SQLite (tránh MLflow 3.x API changes)
  - `_find_version_by_stage()` dùng `ORDER BY creation_time DESC LIMIT 1` — luôn lấy bản mới nhất trong stage
  - 3 quy tắc đánh giá: F1 ≥ min_f1 (0.85), capability upgrade, head-to-head comparison
  - Gọi `client.transition_model_version_stage()` để promote/reject

- **Local Orchestrator** (`orchestration/run_ai_pipeline.py`):
  - ★ **Nhạc trưởng mới** của toàn bộ pipeline — thay thế 2 jobs GitHub Actions
  - Luồng: Kaggle API → poll status → tải artifact S3 → log MLflow → Evaluation Gate → webhook GitHub
  - Exponential backoff polling: 30s → 60s → 120s
  - Bắn `repository_dispatch: deploy_new_champion` khi APPROVED, kèm `client_payload.model_version`

- **MLflow Model Registration Script** (`orchestration/register_models_to_mlflow.py`):
  - Đăng ký v1 (2-class, Staging) và v2 (3-class, Production) vào MLflow Model Registry
  - Log metrics, params, artifacts vào MLflow run
  - Gọi `client.transition_model_version_stage()` để set đúng stage ban đầu

### 🔧 Fixed - Sửa lỗi

- **S3 Bucket Name nhất quán** (`kaggle_training/kernel-metadata.json`, `.github/workflows/retrain_pipeline.yml`):
  - `mlops-nids-models-bucket` → `mlops-nids-artifacts` (đúng bucket Terraform tạo)
  - Fix Deep Audit Issue #1 (CRITICAL)

- **GITHUB_REPO đúng repo** (`k8s/evidently-cronjob.yaml`):
  - `Viet-Hoang-2005/MLOps-weather-system` → `Viet-Hoang-2005/MLOps-nids-system`
  - Fix Deep Audit Issue #2 (CRITICAL — webhook 404 ngăn hoàn toàn auto-retrain)

- **`postgres.yaml` → `postgres-cluster.yaml`** (`.github/workflows/ci_cd_pipeline.yml`):
  - Fix Deep Audit Issue #3 (HIGH — apply file không tồn tại)

### 🔄 Changed - Thay đổi

- **Cấu trúc thư mục**:
  - Thêm `orchestration/` — chứa `run_ai_pipeline.py`, `mlflow_evaluation_gate.py`, `register_models_to_mlflow.py`
  - Scripts cũ trong `.github/scripts/` vẫn giữ lại (legacy cho CI/CD thử nghiệm)

- **Technology Stack** (`README.md`):
  - `Model Registry: AWS S3` → `MLflow Model Registry (K3s Master Node)`
  - `Orchestration: K3s (Kubernetes)` → `Local Python (run_ai_pipeline.py)`
  - Thêm `MLflow` vào ML Stack

- **README.md flow**:
  - GitHub Actions làm nhạc trưởng → `run_ai_pipeline.py` (Local Orchestrator)
  - Thêm MLflow Server vào sơ đồ topology
  - Cập nhật sơ đồ luồng: Evidently → Orchestrator → Kaggle → MLflow → Gate → GitHub Deploy

### 🗑️ Deprecated - Lỗi thời

- **`.github/scripts/evaluate_model.py`**:
  - Chuyển logic vào `orchestration/mlflow_evaluation_gate.py`
  - Query MLflow trực tiếp thay vì đọc file JSON
  - Vẫn giữ trong `.github/scripts/` để CI/CD thử nghiệm có thể dùng tạm

### 📋 Architecture Changes — Before vs After

| Tiêu chí | Before (GitHub Actions Orchestrator) | After (MLflow-Centric) |
|---|---|---|
| Trigger | CRON + Webhook + Manual | Webhook (`deploy_new_champion`) |
| Kaggle training | GitHub Actions poll | Local script (`run_ai_pipeline.py`) |
| Metrics storage | File JSON (S3 + GitHub Artifacts) | MLflow Model Registry (PostgreSQL) |
| Evaluation | `evaluate_model.py` đọc JSON | `mlflow_evaluation_gate.py` query MLflow |
| MODEL_VERSION | Hardcoded trong YAML | Từ `client_payload.model_version` webhook |
| GitHub Jobs | 4 jobs | 2 jobs (Deploy + Sync) |
| Orchestrator | GitHub Actions | Local Python |
| MLflow | Chỉ logging (train.py) | Central Brain — Registry + Evaluation + Lineage |

---

## [3.0.0]: 2026-04-05

### Giai đoạn 3: Hạ tầng & Triển khai Production

### ✨ Added

- **Hạ tầng AWS bằng Terraform** (`infra/main.tf`): VPC, K3s, ALB, S3
- **K3s Kubernetes Manifests** (`k8s/`): `api-deployment.yaml`, `postgres-cluster.yaml`, `evidently-cronjob.yaml`
- **CloudNativePG High Availability**: Primary + Standby, auto failover
- **Dual DB Endpoint Architecture** (`api/src/db_manager.py`): `engine_rw` + `engine_ro`
- **Health Check Endpoint** (`api/src/index.py`)
- **CI/CD Pipeline hoàn chỉnh** (`.github/workflows/`)

### 🔧 Fixed

- Init Container kéo sai tên file model
- S3 bucket name không nhất quán (đã được fix lại trong Unreleased)
- Kaggle Kernel slug sai
- Evidently CronJob dùng `hostPath` (đã xóa, dùng DB làm nguồn dữ liệu)
- Monitoring Dockerfile Python 3.9 → 3.10
- Master Node EC2 `t3.small` → `t3.medium`
- Champion metrics hardcode path v1 → đọc động từ `data_manifest.json`
- `kernel-metadata.json` thiếu `environment_variables`

---

## [2.0.0]: 2026-03-30

### Giai đoạn 2: Vòng lặp MLOps - Giám sát & Tái huấn luyện Tự động

### ✨ Added

- **Evidently AI Drift Detection** (`monitoring/detect_drift.py`)
- **Kaggle Training Pipeline** (`kaggle_training/train.py`)
- **Model Evaluation Quality Gate** (`.github/scripts/evaluate_model.py`)
- **Reference Data Sync** (`.github/scripts/update_reference_data.py`)
- **Data Manifest** (`data_manifest.json`)
- **Retrain Pipeline** (`.github/workflows/retrain_pipeline.yml`)
- **Load Testing & Drift Simulation** (`web/src/locustfile.py`)
- **Data Extraction** (`.github/scripts/extract_data.py`)

### 🔄 Changed

- Chuyển API từ Flask sang FastAPI
- `db_manager.py` hỗ trợ connection pooling

---

## [1.0.0]: 2026-03-19

### Giai đoạn 1: Xây dựng Nền tảng Core ML

### ✨ Added

- Nghiên cứu lý thuyết: CIC-IDS2017, XGBoost, MLOps lifecycle
- Tiền xử lý dữ liệu CIC-IDS2017
- Mô hình XGBoost V1 & V2
- FastAPI Inference Server
- PostgreSQL Logging
- Docker hóa

---

## Quy ước Đánh số Phiên bản (Versioning)

| Loại | Ý nghĩa | Ví dụ thực tế trong dự án |
|---|---|---|
| **MAJOR** | Thay đổi kiến trúc lớn, phá vỡ cấu trúc cũ | `1.0->2.0`: Flask->FastAPI; `2.0->3.0`: thêm K3s+CloudNativePG |
| **MINOR** | Tính năng mới, tương thích ngược | Thêm endpoint mới, thêm class phân loại mới |
| **PATCH** | Sửa lỗi nhỏ, vá bảo mật | Sửa path S3, fix connection string |

---

_Last updated: 2026-04-11 - UIT · NT114 · MLOps NIDS System Project_
