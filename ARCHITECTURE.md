# Thiết kế Kiến trúc Hệ thống (System Architecture)

Tài liệu này đặc tả chi tiết kiến trúc của **Hệ thống MLOps Phát hiện Trôi Dữ liệu và Tái huấn luyện Tự động cho Mô hình Phát hiện Tấn công Mạng (NIDS)** dựa trên tập dữ liệu CIC-IDS2017.

---

## 1. Kiến trúc Tổng thể (High-Level Architecture)

Hệ thống được thiết kế theo vòng lặp khép kín **Closed-Loop MLOps**: Data → Inference → Monitor → Retrain → Deploy → Data.

```mermaid
flowchart TB
    subgraph CLIENT["Môi trường Khách (Client)"]
        USER[Người Dùng Cuối<br/>NetFlow Traffic]
        LOCUST[Locust Load Testing<br/>Giả lập Tấn Công mạng]
    end

    subgraph AWS_INFRA["Hạ tầng AWS (Terraform)"]
        ALB[Application Load Balancer<br/>Public Endpoint]

        subgraph K3S["K3s Production Cluster (1 Master + 2 Workers)"]
            API[FastAPI NIDS Server<br/>2 Replicas · NodePort 30080]
            subgraph CNPG["CloudNativePG PostgreSQL HA"]
                PG_PRIMARY[(Primary Node<br/>READ + WRITE)]
                PG_STANDBY[(Standby Node<br/>READ-ONLY · Streaming Replica)]
            end
            EVIDENTLY[Evidently AI<br/>CronJob · 0h hằng ngày]
        end

        S3[(AWS S3<br/>mlops-nids-artifacts<br/>Model Registry + Data)]
    end

    subgraph CICD["CI/CD Orchestration (GitHub Actions)"]
        GH_CICD[ci_cd_pipeline.yml<br/>Build → Deploy]
        GH_RETRAIN[retrain_pipeline.yml<br/>Retrain → Evaluate → Deploy → Sync]
        EVAL[evaluate_model.py<br/>Quality Gate · Promotion Rules]
        SYNC[update_reference_data.py<br/>Đồng bộ Reference Data]
    end

    subgraph KAGGLE["Kaggle Compute Engine"]
        TRAIN[train.py<br/>XGBoost · MLflow · Hyperparameter Tuning]
    end

    USER -->|POST /predict| ALB
    LOCUST -->|Stress Test| ALB
    ALB -->|NodePort 30080| API
    API -->|Async INSERT| PG_PRIMARY
    PG_PRIMARY -.->|Streaming Replication| PG_STANDBY
    EVIDENTLY -->|SELECT 24h gần nhất| PG_STANDBY
    API -->|Load Model pkl + json| S3

    EVIDENTLY -->|Webhook: data_drift_detected| GH_RETRAIN
    GH_RETRAIN -->|Kaggle API Push Kernel| TRAIN
    TRAIN -->|Upload artifacts| S3
    GH_RETRAIN -->|Challenger vs Champion| EVAL
    EVAL -->|Passed| GH_RETRAIN
    GH_RETRAIN -->|kubectl rollout restart| K3S
    GH_RETRAIN -->|Sync new dataset| SYNC
    SYNC -->|UPDATE nids_reference_data| PG_PRIMARY

    GH_CICD -->|Docker Build + Push| API
    GH_CICD -->|Docker Build + Push| EVIDENTLY
```

---

## 2. Chi tiết Từng Thành phần

### 2.1. Lớp Suy diễn và Ghi log (Inference & Logging Layer)

Request được xử lý song song theo 2 nhánh: **Inference** (đồng bộ, trả kết quả ngay) và **Logging** (bất đồng bộ, không ảnh hưởng latency).

```mermaid
flowchart LR
    subgraph REQUEST["Request"]
        JSON["JSON Payload<br/>Network Flow Features"]
    end

    subgraph FASTAPI["FastAPI Container"]
        PARSER[Pydantic Validation]
        MODEL["XGBoost Model<br/>xgb_nids_model_v1.pkl"]
        LABELS["Label Mapper<br/>label_classes_v1.json"]
        PRED[Predicted_Label<br/>+ Confidence_Score]
        BT[Background Task<br/>Async Logging]
    end

    subgraph STORAGE["CloudNativePG · Read-Write Endpoint"]
        RW[("nids-postgres-rw<br/>PRIMARY")]
    end

    JSON --> PARSER --> MODEL
    MODEL --> LABELS --> PRED
    PRED -->|Response < 100ms| REQUEST
    PRED --> BT
    BT -->|Async INSERT<br/>nids_production_data| RW
```

**File model được nạp từ emptyDir Volume** do Init Container kéo từ S3 mỗi khi Pod khởi động — không bao giờ baked vào Docker Image.

### 2.2. Lớp Cơ sở Dữ liệu HA (CloudNativePG)

```mermaid
flowchart LR
    subgraph W1["Worker Node 1"]
        PRIMARY[("nids-postgres-1<br/>PRIMARY<br/>READ + WRITE")]
    end

    subgraph W2["Worker Node 2"]
        STANDBY[("nids-postgres-2<br/>STANDBY<br/>READ-ONLY")]
    end

    subgraph SERVICES["K8s Services (tự động tạo bởi Operator)"]
        RW_SVC["nids-postgres-rw<br/>→ Primary"]
        RO_SVC["nids-postgres-ro<br/>→ Load-balanced"]
    end

    PRIMARY -->|WAL Streaming<br/>Replication| STANDBY
    RW_SVC --> PRIMARY
    RO_SVC --> PRIMARY
    RO_SVC --> STANDBY

    API_BOX["FastAPI<br/>db_manager.py"] -->|INSERT| RW_SVC
    DRIFT_BOX["detect_drift.py"] -->|SELECT| RO_SVC
    SYNC_BOX["update_reference_data.py"] -->|INSERT| RW_SVC
```

Khi Primary Node sập, CloudNativePG Operator tự động **thăng cấp Standby** lên làm Primary mới trong vòng 30-60 giây.

### 2.3. Lớp Giám sát Drift (Evidently AI CronJob)

```mermaid
flowchart TB
    subgraph SOURCES["Nguồn Dữ liệu"]
        PROD_DB[("nids_production_data<br/>24h gần nhất")]
        REF_DB[("nids_reference_data<br/>Dataset Training gốc")]
    end

    subgraph EVIDENTLY["Evidently CronJob · 0h UTC hằng ngày"]
        LOAD[Tải 2 tập dữ liệu từ<br/>nids-postgres-ro]
        PREPROCESS[Loại bỏ metadata cols<br/>id · created_at · Predicted_Label]
        REPORT["DataDriftPreset<br/>KS-Test · Chi-Square · PSI"]
        DECISION{"Drift Rate<br/>>= 50%?"}
    end

    subgraph ACTION["Hành động"]
        STABLE["✅ Ổn định<br/>Ghi log kết quả"]
        WEBHOOK["🚨 Gửi POST Webhook<br/>GitHub repository_dispatch<br/>event_type: data_drift_detected"]
    end

    PROD_DB --> LOAD
    REF_DB --> LOAD
    LOAD --> PREPROCESS --> REPORT --> DECISION
    DECISION -->|Không| STABLE
    DECISION -->|Có| WEBHOOK
```

### 2.4. Lớp CI/CD Pipeline (GitHub Actions)

#### Pipeline 1: `ci_cd_pipeline.yml` — Code Deployment

Trigger khi có **code thay đổi** được push lên `main`.

```
Lint & Syntax Check → Build Docker Image (API + Monitor) → Push Docker Hub → Apply K8s Manifests → Rolling Update
```

#### Pipeline 2: `retrain_pipeline.yml` — Model Retraining

Trigger bởi **Webhook từ Evidently**, schedule hằng ngày, hoặc thủ công.

```mermaid
sequenceDiagram
    participant E as Evidently CronJob
    participant G as GitHub Actions
    participant K as Kaggle Compute
    participant S as AWS S3
    participant EV as evaluate_model.py
    participant P as K3s Cluster
    participant DB as PostgreSQL Primary

    E->>G: 1. Webhook: data_drift_detected
    G->>S: 2. Đọc data_manifest.json<br/>(target_csv, model_version, champion_version)
    G->>K: 3. Inject env vars → Push Kernel
    K-->>K: 4. train.py: Load CSV từ S3<br/>Hyperparameter Tuning · MLflow logging
    K->>S: 5. Upload model .pkl + metrics .json
    G->>EV: 6. Tải champion_metrics từ S3<br/>Tải challenger_metrics từ Artifacts
    EV-->>EV: 7. So sánh: F1-score, num_classes,<br/>Capability Upgrade Rules
    EV->>G: 8. PROMOTE / REJECT
    G->>P: 9. kubectl set env MODEL_VERSION=v2
    G->>P: 10. kubectl rollout restart → Zero-Downtime
    G->>DB: 11. update_reference_data.py<br/>Sync CSV mới → nids_reference_data
```

### 2.5. Cơ chế Zero-Downtime Deployment (Init Container)

```mermaid
flowchart LR
    subgraph TIMELINE["Thứ tự khởi động Pod mới"]
        INIT["① Init Container<br/>amazon/aws-cli<br/>aws s3 cp → /models/v2/"]
        VOL[("② emptyDir Volume<br/>xgb_nids_model_v2.pkl<br/>label_classes_v2.json")]
        APP["③ App Container<br/>FastAPI<br/>joblib.load(MODEL_PATH)"]
    end

    S3[("AWS S3<br/>mlops-nids-artifacts")]

    S3 -->|Tải file model| INIT
    INIT -->|Ghi vào shared volume| VOL
    VOL -->|Đọc khi khởi động| APP
```

K3s thực hiện Rolling Update: Pod cũ (v1) tiếp tục phục vụ traffic trong khi Pod mới (v2) đang init — không có downtime.

---

## 3. Lược đồ Cơ sở Dữ liệu (Database Schema)

```mermaid
erDiagram
    NIDS_PRODUCTION_DATA {
        uuid id PK "UUID · Tự sinh bởi API"
        float Flow_Duration "Thời gian luồng mạng"
        float Total_Fwd_Packets "Tổng gói tin chiều đến"
        float Bwd_Packet_Length_Max "Kích thước gói tin chiều về lớn nhất"
        float n_features "... 70+ network flow features"
        text Predicted_Label "BENIGN · DDoS · PortScan · ..."
        float Confidence_Score "Xác suất dự đoán [0.0 – 1.0]"
        timestamp created_at "Thời điểm ghi log"
    }

    NIDS_REFERENCE_DATA {
        uuid id PK
        float n_features "Toàn bộ features từ CSV training"
        text Label "Nhãn thực tế từ tập train"
        timestamp created_at "Thời điểm nạp vào DB"
    }

    NIDS_PRODUCTION_DATA }|--|| NIDS_REFERENCE_DATA : "Evidently so sánh phân phối"
```

`nids_reference_data` được **tự động cập nhật** sau mỗi lần retrain thành công bởi `update_reference_data.py` — đảm bảo Evidently luôn dùng dataset training mới nhất làm baseline.

---

## 4. Hạ tầng AWS (Terraform)

```
ap-southeast-1 (Singapore)
├── VPC: 10.0.0.0/16
│   ├── Public Subnet 1a (10.0.1.0/24) — Master Node · NAT Gateway
│   ├── Public Subnet 1b (10.0.3.0/24) — ALB (Multi-AZ)
│   └── Private Subnet 1a (10.0.2.0/24) — Worker Nodes
│
├── EC2 Instances
│   ├── ip-10-0-1-219  · t3.medium · K3s Master (control-plane)
│   ├── ip-10-0-2-244  · t3.medium · K3s Worker 1 + Postgres PRIMARY
│   └── ip-10-0-2-8    · t3.medium · K3s Worker 2 + Postgres STANDBY
│
├── Application Load Balancer (mlops-api-lb)
│   └── Listener :80 → Target Group → Worker NodePort 30080
│
└── S3 Bucket: mlops-nids-artifacts
    ├── models/v1/  ← xgb_nids_model_v1.pkl · label_classes_v1.json · metrics_v1.json
    ├── models/v2/  ← xgb_nids_model_v2.pkl · label_classes_v2.json · metrics_v2.json
    ├── training-data/  ← train_2_classes.csv · train_3_classes.csv
    └── data_manifest.json  ← "Nguồn Sự thật" về dataset hiện tại
```

---

## 5. Mục tiêu Hiệu năng (Performance SLA)

| Chỉ số                   | Mục tiêu                   | Cơ chế đạt được                         |
| ------------------------ | -------------------------- | --------------------------------------- |
| **Độ trễ API Inference** | < 100ms                    | Model cache trong RAM (emptyDir Volume) |
| **Bảo toàn Dữ liệu**     | 100% requests được ghi log | Async Background Task trong FastAPI     |
| **Downtime khi Deploy**  | 0%                         | Rolling Update + Init Container         |
| **Phục hồi DB khi sập**  | < 60 giây                  | CloudNativePG Auto Failover             |
| **Chu kỳ Retrain**       | < 2 giờ                    | Kaggle GPU/CPU → S3 → K3s               |
| **Phát hiện Drift**      | Hằng ngày 0h UTC           | Evidently CronJob                       |

---

_Last updated: April 2026 — MLOps NIDS System Project_
