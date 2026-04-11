# Thiết kế Kiến trúc Hệ thống (System Architecture)

Tài liệu này đặc tả chi tiết kiến trúc của **Hệ thống MLOps Phát hiện Trôi Dữ liệu và Tái huấn luyện Tự động cho Mô hình Phát hiện Tấn công Mạng (NIDS)** dựa trên tập dữ liệu CIC-IDS2017.

---

## 1. Kiến trúc Tổng thể (High-Level Architecture)

Hệ thống được thiết kế theo vòng lặp khép kín **Closed-Loop MLOps**: Data -> Inference -> Monitor -> Retrain -> Deploy -> Data.

```mermaid
flowchart TB
    subgraph CLIENT["Môi trường Khách (Client)"]
        USER[Người Dùng Cuối<br/>NetFlow Traffic]
        LOCUST[Locust Load Testing<br/>Giả lập Tấn Công mạng]
    end

    subgraph AWS_INFRA["Hạ tầng AWS (Terraform)"]
        ALB[Application Load Balancer<br/>Public Endpoint]

        subgraph K3S["K3s Production Cluster (1 Master + 2 Workers)"]
            MLFLOW[MLflow Server<br/>Master Node :30000<br/>PostgreSQL Backend]
            API[FastAPI NIDS Server<br/>2 Replicas · ClusterIP]
            TRAEFIK[Traefik Ingress Controller<br/>Port 80]
            subgraph CNPG["CloudNativePG PostgreSQL HA"]
                PG_PRIMARY[(Primary Node<br/>READ + WRITE)]
                PG_STANDBY[(Standby Node<br/>READ-ONLY · Streaming Replica)]
            end
            EVIDENTLY[Evidently AI<br/>CronJob · 0h hằng ngày]
        end

        S3[(AWS S3<br/>mlops-nids-artifacts)]
    end

    subgraph ORCHESTRATOR["Local Orchestrator (run_ai_pipeline.py)"]
        KAGGLE_PUSH[Kaggle API<br/>kernels push]
        KAGGLE_TRAIN[XGBoost Training<br/>MLflow Logging]
        EVAL_GATE[mlflow_evaluation_gate.py<br/>Champion vs Challenger]
    end

    subgraph KAGGLE["Kaggle Compute Engine"]
        TRAIN[train.py<br/>XGBoost · RandomizedSearchCV]
    end

    USER -->|POST /predict| ALB
    LOCUST -->|Stress Test| ALB
    ALB -->|Port 80 TCP| TRAEFIK
    TRAEFIK -->|Ingress Route| API
    API -->|Async INSERT| PG_PRIMARY
    PG_PRIMARY -.->|Streaming Replication| PG_STANDBY
    EVIDENTLY -->|SELECT 24h| PG_STANDBY

    EVIDENTLY -->|drift detected| KAGGLE_PUSH
    KAGGLE_PUSH -->|kernels push| KAGGLE
    KAGGLE -->|upload artifact| S3
    KAGGLE_PUSH -.->|poll status| KAGGLE
    ORCHESTRATOR -->|download artifact| S3
    ORCHESTRATOR -->|log metrics| MLFLOW
    MLFLOW -->|query stages| EVAL_GATE
    EVAL_GATE -->|APPROVED: Webhook| K3S

    API -->|Load Model pkl + json| S3
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
        MODEL["XGBoost Model<br/>xgb_nids_model_v2.pkl"]
        LABELS["Label Mapper<br/>label_classes_v2.json"]
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

**File model được nạp từ emptyDir Volume** do Init Container kéo từ S3 mỗi khi Pod khởi động - không bao giờ baked vào Docker Image.

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
        STABLE["Ổn định<br/>Ghi log kết quả"]
        TRIGGER_ORCH["Gọi run_ai_pipeline.py<br/>(Local Orchestrator)"]
    end

    PROD_DB --> LOAD
    REF_DB --> LOAD
    LOAD --> PREPROCESS --> REPORT --> DECISION
    DECISION -->|Không| STABLE
    DECISION -->|Có| TRIGGER_ORCH
```

### 2.4. Lớp Orchestration (Local Orchestrator)

**THAY ĐỔI LỚN:** Thay vì GitHub Actions làm nhạc trưởng (4 jobs), `run_ai_pipeline.py` chạy **LOCAL** (hoặc trên server riêng) làm nhạc trưởng của toàn bộ pipeline.

#### Luồng Retrain: run_ai_pipeline.py (Sequence Diagram)

```mermaid
sequenceDiagram
    participant E as Evidently CronJob
    participant ORCH as run_ai_pipeline.py<br/>(Local Orchestrator)
    participant K as Kaggle Compute
    participant S as AWS S3
    participant MLF as MLflow Server<br/>(K3s Master :30000)
    participant GATE as mlflow_evaluation_gate.py
    participant GA as GitHub Actions
    participant P as K3s Cluster
    participant DB as PostgreSQL Primary

    E->>ORCH: 1. drift detected → gọi script
    ORCH->>K: 2. kaggle kernels push (train.py)
    K-->>K: 3. train.py: Load CSV từ S3<br/>XGBoost + RandomizedSearchCV
    K->>S: 4. Upload artifact .pkl<br/>s3://.../models/vN/
    ORCH->>S: 5. kaggle kernels output<br/>Tải artifact về local
    ORCH->>MLF: 6. mlflow.start_run()<br/>mlflow.log_metrics(f1=0.999)
    ORCH->>MLF: 7. mlflow.register_model()<br/>version N → Stage: Staging
    MLF-->>ORCH: Registered: NIDS-XGBoost / vN / Staging
    ORCH->>GATE: 8. mlflow_evaluation_gate.py<br/>query Production vs Staging
    GATE-->>GATE: 9. evaluate_challenger():<br/>F1_challenger >= F1_champion ?
    GATE->>MLF: 10. transition(vN, "Production")<br/>transition(vN-1, "Archived")
    GATE-->>ORCH: 11. APPROVED
    ORCH->>S: 12. aws s3 sync models/vN/<br/>Init Container cần kéo về
    ORCH->>GA: 13. POST /dispatches<br/>event_type: deploy_new_champion<br/>client_payload: {model_version: N}
    GA->>P: 14. kubectl set env MODEL_VERSION=N
    GA->>P: 15. kubectl rollout restart → Zero-Downtime
    P->>DB: 16. sync_reference_data<br/>TRUNCATE + INSERT dataset mới
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

K3s thực hiện Rolling Update: Pod cũ (v1) tiếp tục phục vụ traffic trong khi Pod mới (v2) đang init - không có downtime.

---

## 3. Lược đồ Cơ sở Dữ liệu (Database Schema)

```mermaid
erDiagram
    NIDS_PRODUCTION_DATA {
        string id PK "UUID auto-generated by API"
        float Flow_Duration "Network flow duration (ms)"
        float Total_Fwd_Packets "Total forward packets"
        float Bwd_Packet_Length_Max "Max backward packet length"
        float feature_52_plus "52+ CIC-IDS2017 network flow features"
        string Predicted_Label "BENIGN, DDoS, PortScan"
        float Confidence_Score "Prediction confidence score 0.0 to 1.0"
        string created_at "Log timestamp"
    }

    NIDS_REFERENCE_DATA {
        string id PK "UUID"
        float feature_52_plus "All features from training CSV"
        string Label "Ground truth label from dataset"
        string created_at "Import timestamp"
    }

    NIDS_PRODUCTION_DATA ||--|| NIDS_REFERENCE_DATA : "compared by Evidently AI"
```

`nids_reference_data` được **tự động cập nhật** sau mỗi lần retrain thành công bởi `update_reference_data.py` - đảm bảo Evidently luôn dùng dataset training mới nhất làm baseline.

---

## 4. Hạ tầng AWS (Terraform) - TO-BE

```
ap-southeast-1 (Singapore)
├── VPC: 10.0.0.0/16
│   ├── Public Subnet 1a (10.0.1.0/24)  - Master Node + NAT Gateway
│   ├── Public Subnet 1b (10.0.3.0/24)  - ALB (Multi-AZ)
│   └── Private Subnet 1a (10.0.2.0/24) - Worker Nodes
│
├── EC2 Instances
│   ├── ip-10-0-1-219  - t3.medium: K3s Master (control-plane)
│   │                       ★ MLflow Server Pod chạy tại đây (NodePort 30000)
│   │                       ★ Backend: CloudNativePG PostgreSQL (dùng chung cluster)
│   ├── ip-10-0-2-244  - t3.medium: K3s Worker 1 + Postgres PRIMARY
│   └── ip-10-0-2-8    - t3.medium: K3s Worker 2 + Postgres STANDBY
│
├── Application Load Balancer (mlops-api-lb)
│   └── Listener :80 → Target Group → Worker Port 80 (Traefik Ingress)
│
└── S3 Bucket: mlops-nids-artifacts
    ├── models/v1/  ← xgb_nids_model_v1.pkl + label_classes_v1.json + metrics_v1.json
    ├── models/v2/  ← xgb_nids_model_v2.pkl + label_classes_v2.json + metrics_v2.json
    ├── mlflow-artifacts/  ← ★ MLflow artifact store (model binaries + mlruns)
    ├── training-data/  ← train_2_classes.csv + train_3_classes.csv
    └── data_manifest.json  ← "Source of Truth" about the current dataset
```

---

## 5. Mục tiêu Hiệu năng (Performance SLA)

| Chỉ số | Mục tiêu | Cơ chế đạt được |
| --- | --- | --- |
| **Độ trễ API Inference** | < 100ms | Model cache trong RAM (emptyDir Volume) |
| **Bảo toàn Dữ liệu** | 100% requests được ghi log | Async Background Task trong FastAPI |
| **Downtime khi Deploy** | 0% | Rolling Update + Init Container |
| **Phục hồi DB khi sập** | < 60 giây | CloudNativePG Auto Failover |
| **Chu kỳ Retrain** | < 2 giờ | Kaggle GPU/CPU -> S3 -> K3s |
| **Phát hiện Drift** | Hằng ngày 0h UTC | Evidently CronJob |
| **MLflow Query** | < 1s | PostgreSQL backend (dùng chung với nids_db) |

---

## 6. MLflow Model Registry — Chi tiết

### 6.1. Stages

| Stage | Ý nghĩa |
| --- | --- |
| **Staging** | Model mới train, đang trong quá trình đánh giá |
| **Production** | Model hiện đang phục vụ inference trên production |
| **Archived** | Model cũ đã bị thay thế, giữ lại để so sánh |

### 6.2. Backend

- **PostgreSQL (CloudNativePG)** (recommend): Dùng chung cluster `nids-postgres`, tạo database `mlflow` riêng biệt
- MLflow artifact root: `s3://mlops-nids-artifacts/mlflow-artifacts/` (không lưu trên volume)

### 6.3. Truy cập MLflow UI

```
# Sau khi deploy k8s/mlflow-deployment.yaml:
http://<master-node-public-ip>:30000

# Các chức năng:
# - Experiments: xem tất cả các run với params, metrics, artifacts
# - Models: xem Registry với các version + stage
# - Compare: so sánh các run với nhau
```

---

## 7. So sánh Before vs After (Orchestration)

| Tiêu chí | Before (GitHub Actions Orchestrator) | After (MLflow-Centric Orchestrator) |
|---|---|---|
| **Nhạc trưởng** | GitHub Actions (4 jobs nối tiếp) | `run_ai_pipeline.py` (Local Python) |
| **Trigger** | CRON + Webhook (Evidently) + Manual | Webhook (`deploy_new_champion`) + Manual |
| **Kaggle API** | GitHub Actions poll (trong job) | Local script poll (ngoài CI/CD) |
| **Metrics storage** | File JSON: S3 + GitHub Artifacts + repo | MLflow Model Registry (PostgreSQL) |
| **Evaluation** | `evaluate_model.py` đọc JSON từ S3/Artifacts | `mlflow_evaluation_gate.py` query MLflow trực tiếp |
| **Stage transition** | jq sửa data_manifest.json | `client.transition_model_version_stage()` |
| **MODEL_VERSION** | Hardcoded trong YAML, hoặc jq đọc manifest | Từ `client_payload.model_version` webhook |
| **GitHub Jobs** | 4 jobs (retrain + eval + deploy + sync) | 2 jobs (deploy + sync) |
| **Pipeline complexity** | Cao (nhiều I/O file, nhiều nguồn sự thật) | Thấp (chỉ deploy, không suy nghĩ) |

---

_Last updated: 2026-04-11 - UIT · NT114 · MLOps NIDS System Project_
