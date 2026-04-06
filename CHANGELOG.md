# Nhật ký Thay đổi (Changelog)

Tài liệu ghi lại toàn bộ lịch sử phát triển của dự án **MLOps Network Intrusion Detection System (NIDS)**.

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) và [Semantic Versioning](https://semver.org/).

---

## [3.0.0]: 2026-04-05

### Giai đoạn 3: Hạ tầng & Triển khai Production (Infrastructure & Production Deployment)

Giai đoạn hoàn thiện cuối cùng: đưa toàn bộ hệ thống lên hạ tầng AWS thực tế với cụm K3s 3 node, bảo đảm tính sẵn sàng cao (High Availability) cho cơ sở dữ liệu, và viết lại toàn bộ CI/CD pipeline phù hợp với kiến trúc mới.

### ✨ Added - Tính năng mới

- **Hạ tầng AWS bằng Terraform** (`infra/main.tf`):
  - VPC với Public Subnet (Master + ALB) và Private Subnet (Worker Nodes)
  - Cụm K3s: 1 Master (`t3.medium`) + 2 Worker (`t3.medium`) trên EC2
  - Application Load Balancer (ALB) phân phối traffic từ Internet vào Worker NodePort 30080
  - S3 Bucket (`mlops-nids-artifacts`) với Versioning và Block Public Access để lưu model artifacts
  - NAT Gateway cho Worker Nodes truy cập Internet trong Private Subnet

- **K3s Kubernetes Manifests** (`k8s/`):
  - `api-deployment.yaml`: FastAPI Deployment với **Init Container** kéo model từ S3 tự động, `readinessProbe` và `livenessProbe`, NodePort Service
  - `postgres-cluster.yaml`: **CloudNativePG Cluster** - Primary + Standby Streaming Replication tự động failover
  - `evidently-cronjob.yaml`: CronJob Evidently AI chạy 0h UTC hằng ngày

- **CloudNativePG High Availability** (`k8s/postgres-cluster.yaml`):
  - Primary Pod (Worker 1): xử lý INSERT/UPDATE từ FastAPI
  - Standby Pod (Worker 2): xử lý SELECT từ Evidently, tự động sync qua WAL Streaming
  - Hai K8s Service endpoint riêng biệt: `nids-postgres-rw` (ghi) và `nids-postgres-ro` (đọc)
  - Auto Failover: Standby tự động được thăng cấp lên Primary trong vòng 30–60 giây khi Primary sập

- **Dual DB Endpoint Architecture** (`api/src/db_manager.py`):
  - `engine_rw` -> kết nối `nids-postgres-rw` (Primary) cho thao tác ghi log production
  - `engine_ro` -> kết nối `nids-postgres-ro` (Standby) dự phòng cho thao tác đọc
  - `pool_pre_ping=True` giúp engine tự hồi phục kết nối sau sự kiện failover
  - `pool_recycle=1800` tránh stale connection sau thời gian dài không dùng

- **Read-Only endpoint cho Drift Detection** (`monitoring/detect_drift.py`):
  - Đọc `DB_HOST_RO` thay vì `DB_HOST` -> kết nối đến `nids-postgres-ro` (Standby)
  - Tách biệt hoàn toàn workload đọc (Evidently) khỏi workload ghi (FastAPI)

- **Health Check Endpoint** (`api/src/index.py`):
  - `GET /` trả về `{"status": "healthy", "model_version": "v1"}` để ALB và K8s probe kiểm tra

- **CI/CD Pipeline hoàn chỉnh** (`.github/workflows/`):
  - `ci_cd_pipeline.yml`: Lint -> Build Docker (API + Evidently) -> Push Docker Hub (`tnvhoang/`) -> Apply K8s Manifests -> Rolling Update
  - `retrain_pipeline.yml`: Đọc `data_manifest.json` -> Kaggle Retrain -> `evaluate_model.py` -> K3s Deploy -> `update_reference_data.py`

### 🔧 Fixed - Sửa lỗi

- Init Container trong `api-deployment.yaml` kéo sai tên file model (`label_nids_encoder_v1.pkl` -> `label_classes_v1.json`)
- S3 bucket name không nhất quán giữa YAML và pipeline (`mlops-nids-models-bucket` -> `mlops-nids-artifacts`)
- `DB_NAME` không đồng nhất giữa YAML, `db_manager.py` và `detect_drift.py` (thống nhất về `mlops_nids_db`)
- Kaggle Kernel slug sai trong `retrain_pipeline.yml` (`mlops-nids-training` -> `mlops-nids-training-pipeline`)
- Evidently CronJob dùng `hostPath` volume -> không hoạt động trên cụm multi-node (đã xóa, dùng DB làm nguồn dữ liệu)
- Monitoring Dockerfile dùng Python 3.9 không tương thích cú pháp `tuple[...]` type hint (nâng lên 3.10)
- `COPY . /app/monitoring` trong Dockerfile monitoring dẫn đến CMD path sai (đổi thành `COPY . .`)
- `requirements.txt` của monitoring thiếu `sqlalchemy` -> script crash khi khởi động
- Master Node EC2 dùng `t3.small` (2GB RAM) không đủ tài nguyên cho K3s control-plane (nâng lên `t3.medium`)
- Champion metrics trong pipeline `evaluate_model` hardcode path version v1 -> đã động hóa đọc từ `data_manifest.json`
- `kernel-metadata.json` thiếu trường `environment_variables` -> `jq` inject sai khi pipeline chạy

---

## [2.0.0]: 2026-03-30

### Giai đoạn 2: Vòng lặp MLOps - Giám sát & Tái huấn luyện Tự động (Monitoring & Continuous Training)

Giai đoạn xây dựng "trái tim" của hệ thống MLOps: vòng lặp khép kín từ Detection -> Webhook -> Retrain -> Evaluate -> Deploy -> Sync.

### ✨ Added - Tính năng mới

- **Evidently AI Drift Detection** (`monitoring/detect_drift.py`):
  - So sánh `nids_reference_data` (baseline training) và `nids_production_data` (24h gần nhất)
  - Dùng `DataDriftPreset` (kiểm định KS-Test / Chi-Square từng feature) và `DatasetDriftMetric` (kết luận tổng thể)
  - Tự động loại bỏ cột metadata (`id`, `created_at`, `Predicted_Label`, `Confidence_Score`) trước khi so sánh
  - Kích hoạt `repository_dispatch` Webhook đến GitHub nếu drift rate ≥ 50%
  - Kiểm tra tối thiểu 100 mẫu production trước khi phân tích để đảm bảo kết quả thống kê có nghĩa

- **Kaggle Training Pipeline** (`kaggle_training/train.py`):
  - Nạp dataset từ AWS S3 theo `TARGET_CSV` trong `data_manifest.json`
  - Hyperparameter Tuning tự động bằng `RandomizedSearchCV` + `StratifiedKFold`
  - Xử lý class imbalance bằng `compute_sample_weight`
  - Hỗ trợ multi-class động: 2 classes (binary) và 3+ classes (softmax)
  - Theo dõi toàn bộ experiment bằng **MLflow** (params, metrics, artifacts)
  - Xuất `metrics_v*.json` (accuracy, precision, recall, f1, hyperparameters, num_classes)
  - Upload model artifacts lên S3 tự động sau khi train

- **Model Evaluation Quality Gate** (`.github/scripts/evaluate_model.py`):
  - So sánh Challenger (model mới) với Champion (model đang production) theo 3 quy tắc:
    - **Capability Upgrade**: Challenger có nhiều class hơn Champion -> ưu tiên promote
    - **Head-to-Head**: Cùng num_classes -> so sánh F1-score với drift tolerance 1%
    - **Rejection Threshold**: F1 < 0.85 -> tự động reject dù số class nhiều hơn
  - Pipeline fail (exit 1) nếu Challenger bị reject -> chặn deploy model kém

- **Reference Data Sync** (`.github/scripts/update_reference_data.py`):
  - Tải dataset mới từ S3 sau khi deploy thành công
  - Cập nhật bảng `nids_reference_data` trong PostgreSQL -> đảm bảo Evidently dùng baseline mới nhất
  - Khép kín vòng lặp MLOps: Data -> Train -> Deploy -> **Sync Base** -> Monitor -> Drift -> Retrain

- **Data Manifest** (`data_manifest.json`):
  - "Nguồn sự thật" duy nhất cho pipeline: `target_csv`, `model_version`, `champion_version`
  - Thay đổi dataset/version chỉ cần sửa 1 file JSON trên S3, không cần chỉnh code

- **Retrain Pipeline** (`.github/workflows/retrain_pipeline.yml`):
  - Job 1 `retrain_kaggle`: Đọc manifest -> inject env vars -> push Kaggle Kernel -> polling status
  - Job 2 `evaluate_model`: Tải champion metrics từ S3 + challenger từ Artifacts -> chạy evaluation
  - Job 3 `deploy_to_k3s`: `kubectl set env MODEL_VERSION` -> `kubectl rollout restart`
  - Job 4 `sync_reference_data`: Chạy `update_reference_data.py` để cập nhật baseline

- **Load Testing & Drift Simulation** (`web/src/locustfile.py`):
  - Giả lập traffic BENIGN và Attack (DDoS, PortScan) theo tỷ lệ có thể cấu hình
  - Tạo đủ production data cho Evidently phân tích (≥ 100 mẫu)

- **Data Extraction** (`.github/scripts/extract_data.py`):
  - Trích xuất các tập dataset từ CIC-IDS2017 gốc theo số class (2, 3, 4 classes)
  - Tạo các scenario: V1 (2 classes), V2 (3 classes), V3-V4 (4 classes)

### 🔧 Changed - Cập nhật

- Chuyển toàn bộ API từ **Flask** sang **FastAPI** để tận dụng async processing
- `predict` endpoint dùng **BackgroundTasks** để ghi log không làm tăng latency phản hồi
- XGBoost objective tự động chọn `binary:logistic` (2 classes) hoặc `multi:softmax` (3+ classes)
- `db_manager.py` hỗ trợ connection pooling (`pool_size=10`, `max_overflow=20`)

---

## [1.0.0]: 2026-03-19

### Giai đoạn 1: Xây dựng Nền tảng Core ML (Core ML Foundation)

Giai đoạn nghiên cứu, khảo sát và xây dựng prototype đầu tiên: mô hình phân loại tấn công mạng và API inference cơ bản.

### ✨ Added - Khởi tạo

- **Nghiên cứu lý thuyết**:
  - Khảo sát các phương pháp MLOps, ML Lifecycle, Data Drift detection
  - Tìm hiểu bài toán Network Intrusion Detection (NIDS) và tập dữ liệu **CIC-IDS2017**
  - So sánh các thuật toán: Random Forest, SVM, XGBoost -> chọn **XGBoost** vì F1 > 99%

- **Tiền xử lý dữ liệu CIC-IDS2017**:
  - Trích xuất và chuẩn hóa ~70 network flow features
  - Xử lý missing values, infinite values và class imbalance
  - Tạo tập train 2 classes: `BENIGN` và `DDoS` (`train_2_classes.csv`)
  - Tạo tập train 3 classes: thêm `PortScan` (`train_3_classes.csv`)

- **Mô hình XGBoost V1** (`models/v1/`):
  - Accuracy: 99.99%, F1-score: 99.99% trên tập test CIC-IDS2017
  - Xuất `xgb_nids_model_v1.pkl` và `label_classes_v1.json`
  - Ghi chép metrics vào `metrics_v1.json`

- **Mô hình XGBoost V2** (`models/v2/`):
  - Mở rộng lên 3 classes (thêm PortScan)
  - Xuất `xgb_nids_model_v2.pkl` và `label_classes_v2.json`
  - Ghi chép metrics vào `metrics_v2.json`

- **FastAPI Inference Server** (`api/src/index.py`):
  - `POST /predict`: nhận JSON payload network features, trả về `Predicted_Label` + `Confidence_Score`
  - `GET /`: health check endpoint
  - Model được nạp vào RAM khi khởi động - inference < 100ms
  - Hỗ trợ dynamic `MODEL_VERSION` qua biến môi trường

- **PostgreSQL Logging** (`api/src/db_manager.py`):
  - Lưu toàn bộ request + prediction vào bảng `nids_production_data`
  - Bảng `nids_reference_data` lưu training data làm baseline so sánh
  - Connection pooling với SQLAlchemy

- **Docker hóa**:
  - `api/Dockerfile`: đóng gói FastAPI Server
  - `monitoring/Dockerfile`: đóng gói Evidently CronJob
  - `docker-compose.yml`: môi trường local đầy đủ (FastAPI + PostgreSQL)

---

## Quy ước Đánh số Phiên bản (Versioning)

Dự án tuân thủ [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

| Loại      | Ý nghĩa                                    | Ví dụ thực tế trong dự án                                      |
| --------- | ------------------------------------------ | -------------------------------------------------------------- |
| **MAJOR** | Thay đổi kiến trúc lớn, phá vỡ cấu trúc cũ | `1.0->2.0`: Flask->FastAPI; `2.0->3.0`: thêm K3s+CloudNativePG |
| **MINOR** | Tính năng mới, tương thích ngược           | Thêm endpoint mới, thêm class phân loại mới                    |
| **PATCH** | Sửa lỗi nhỏ, vá bảo mật                    | Sửa path S3, fix connection string                             |

---

_Last updated: April 2026 - UIT · NT114 · MLOps NIDS System Project_
