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
        ASM[AWS Secrets Manager<br/>Vault: Két sắt bảo mật]

        subgraph K3S["K3s Production Cluster (1 Master + 2 Workers)"]
            ESO[External Secrets Operator<br/>Secret Synchronizer]
            API[FastAPI NIDS Server<br/>2 Replicas]
            REDPANDA[Redpanda Cluster<br/>Message Broker]
            CONSUMER[NIDS Consumer<br/>Batch DB Writer]

            subgraph CNPG["CloudNativePG PostgreSQL HA"]
                PG_PRIMARY[(Primary Node<br/>READ + WRITE)]
                PG_STANDBY[(Standby Node<br/>READ-ONLY)]
            end

            EVIDENTLY[Evidently AI<br/>Event-driven Job]
        end

        S3[(AWS S3<br/>mlops-nids-artifacts)]
        LAMBDA[AWS Lambda<br/>S3 Trigger → Webhook]
    end

    subgraph CICD["CI/CD Orchestration (GitHub Actions)"]
        GH_CICD[ci_cd_pipeline.yml<br/>Build → Deploy]
        GH_RETRAIN[retrain_pipeline.yml<br/>Retrain → Evaluate → Deploy → Sync]
        GH_DRIFT[trigger_drift_check.yml<br/>Run Evidently Job]
    end

    USER -->|POST /predict| ALB
    LOCUST -->|Stress Test| ALB
    ALB --> API

    API -->|Produce Message| REDPANDA
    REDPANDA -->|Consume Batch| CONSUMER
    CONSUMER -->|Batch INSERT| PG_PRIMARY
    CONSUMER -->|Threshold reached| GH_DRIFT
    ASM -->|IAM Role| ESO
    ESO -->|K8s Secrets| API

    PG_PRIMARY -.->|Streaming Replication| PG_STANDBY
    EVIDENTLY -->|SELECT Production + Reference| PG_STANDBY

    GH_DRIFT -->|kubectl apply| EVIDENTLY
    EVIDENTLY -->|Webhook: data_drift_detected| GH_RETRAIN

    S3 -->|Object Created| LAMBDA
    LAMBDA -->|Webhook: data_manifest_updated| GH_RETRAIN

    GH_RETRAIN -->|SageMaker SDK| TRAIN[SageMaker Training Job]
    TRAIN -->|Upload artifacts| S3

    GH_CICD -->|Docker Build + Push| API
    GH_CICD -->|Docker Build + Push| CONSUMER
```

---

## 2. Chi tiết Từng Thành phần

### 2.1. Lớp Suy diễn và Ghi log (Inference & Logging Layer)

Request được xử lý song song theo 2 nhánh: **Inference** (đồng bộ, trả kết quả ngay) và **Logging** (bất đồng bộ, không ảnh hưởng latency).

```mermaid
flowchart LR
    subgraph REQUEST["Request"]
        JSON["JSON Payload"]
    end

    subgraph FASTAPI["FastAPI (Producer)"]
        MODEL["XGBoost Model"]
        PRED[Predicted_Label]
        K_PROD[Kafka Producer]
    end

    subgraph BROKER["Redpanda (Buffer)"]
        TOPIC["Topic: nids_production_data"]
    end

    subgraph WORKER["Consumer Service"]
        BATCH[Batching 500 rows]
        TRIGGER[Threshold Check]
    end

    subgraph STORAGE["PostgreSQL Primary"]
        TABLE[(nids_production_data)]
    end

    JSON --> MODEL --> PRED
    PRED -->|Response < 100ms| REQUEST
    PRED --> K_PROD --> TOPIC
    TOPIC --> BATCH --> TABLE
    BATCH --> TRIGGER
```

**File model được nạp từ emptyDir Volume** do Init Container kéo từ S3 mỗi khi Pod khởi động - không bao giờ baked vào Docker Image.

### 2.2. Lớp Cơ sở Dữ liệu HA (CloudNativePG)

```mermaid
flowchart LR
    subgraph W1["Worker Node 1"]
        PRIMARY[("mlops-nids-postgres-1<br/>PRIMARY<br/>READ + WRITE")]
    end

    subgraph W2["Worker Node 2"]
        STANDBY[("mlops-nids-postgres-2<br/>STANDBY<br/>READ-ONLY")]
    end

    subgraph SERVICES["K8s Services (tự động tạo bởi Operator)"]
        RW_SVC["mlops-nids-postgres-rw<br/>→ Primary"]
        RO_SVC["mlops-nids-postgres-ro<br/>→ Load-balanced"]
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
    subgraph CONSUMER["NIDS Consumer"]
        COUNT[Đếm bản ghi mới]
        THREC{"Vượt ngưỡng<br/>Threshold?"}
    end

    subgraph GH_ACTION["GitHub Actions"]
        WF[trigger_drift_check.yml]
    end

    subgraph EVIDENTLY["Evidently K8s Job"]
        LOAD[Tải dữ liệu từ RO Node]
        REPORT[Phân tích Data Drift]
        DECISION{"Drift ≥ 50%?"}
    end

    subgraph RETRAIN["Retrain Pipeline"]
        WEBHOOK["Trigger: data_drift_detected"]
    end

    COUNT --> THREC -->|Có| WF
    WF -->|kubectl apply| EVIDENTLY
    EVIDENTLY -->|Có| WEBHOOK
```

### 2.4. Lớp Orchestration (GitHub Actions + CronJob)

Toàn bộ pipeline được điều phối bởi **GitHub Actions Workflows** và một **K8s CronJob** chạy trong cluster, không cần script local.

#### Luồng Retrain & Deploy đầy đủ (Sequence Diagram)

```mermaid
sequenceDiagram
    participant EVD as Evidently K8s Job
    participant GH_DRIFT as trigger_drift_check.yml
    participant GH_RETRAIN as retrain_pipeline.yml
    participant SM as SageMaker Training
    participant MLF as MLflow Server
    participant HUMAN as Data Scientist (HitL)
    participant CRON as dispatch_production_model.py<br/>(K8s CronJob / 5 phút)
    participant GH_DEPLOY as deploy_from_mlflow.yml
    participant K3S as K3s Cluster
    participant S3 as AWS S3

    Note over EVD,GH_DRIFT: Trigger 1: Drift Detection
    EVD->>GH_DRIFT: Webhook: data_drift_detected
    GH_DRIFT->>EVD: kubectl replace --force evidently-job.yaml
    EVD->>GH_RETRAIN: Webhook: drift confirmed → trigger retrain

    Note over S3,GH_RETRAIN: Trigger 2: Data Manifest Update
    S3->>GH_RETRAIN: Lambda → Webhook: data_manifest_updated

    GH_RETRAIN->>S3: 1. Load data_manifest.json
    GH_RETRAIN->>SM: 2. Trigger SageMaker Spot Job (trigger_sagemaker.py)
    SM-->>SM: 3. XGBoost training trên SageMaker Spot Instance
    SM->>MLF: 4. mlflow.log_metrics() + mlflow.register_model()<br/>→ Stage: Staging
    SM->>S3: 5. Upload deployment_exports/ (model.pkl + label.json)

    HUMAN->>MLF: 6. Assign alias "production" (HitL)

    CRON->>MLF: 7. get_model_version_by_alias("production")
    MLF-->>CRON: RUN_ID + MODEL_VERSION
    CRON->>GH_DEPLOY: 8. repository_dispatch<br/>event: mlflow_production_selected

    GH_DEPLOY->>K3S: 9. kubectl set env RUN_ID + MODEL_VERSION
    GH_DEPLOY->>K3S: 10. kubectl rollout restart → Rolling Update
    K3S->>S3: 11. Init Container: aws s3 cp model.pkl
    GH_DEPLOY->>K3S: 12. kubectl replace sync-data-job.yaml
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

### 2.6. Luồng Tự động Retrain qua S3 Artifact Notification

Hệ thống hỗ trợ việc kích hoạt huấn luyện lại khi Data Engineer tải dữ liệu manifest mới lên S3.

1. **User/System** tải `data_manifest.json` lên S3 Bucket.
2. **S3 Event Notification** bắt được sự kiện `ObjectCreated`.
3. **AWS Lambda** được kích hoạt, trích xuất thông tin manifest.
4. **Lambda** gửi `repository_dispatch` tới GitHub API với `event_type: data_manifest_updated`.
5. **GitHub Actions** nhận tín hiệu và khởi chạy `retrain_pipeline.yml`.

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
│   ├── ip-10-0-1-61    - t3.small:  K3s Master (control-plane only)
│   ├── ip-10-0-2-193   - t3.large:  K3s Worker 1 + Postgres PRIMARY
│   │                       ★ MLflow chạy nội bộ trong K3s trên Worker Node
│   │                       ★ Public qua Cloudflare Tunnel -> Nginx
│   │                       ★ Backend: CloudNativePG PostgreSQL
│   └── ip-10-0-2-114   - t3.large:  K3s Worker 2 + Postgres STANDBY
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

## 5. Khả năng Mở rộng và Chịu tải (Scalability)

Việc chuyển đổi từ ghi log trực tiếp sang mô hình **Data Streaming (Redpanda)** mang lại các ưu điểm vượt trội:

| Đặc điểm             | Ghi trực tiếp (Cũ)                       | Data Streaming (Mới)             | Lý do cải thiện                                                               |
| -------------------- | ---------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| **Latency**          | Phụ thuộc vào tốc độ phản hồi của DB     | < 5ms (ghi vào RAM broker)       | API không phải chờ DB xử lý logic INSERT phức tạp.                            |
| **Throughput**       | Bị giới hạn bởi số lượng connection pool | Hàng trăm nghìn tin nhắn/giây    | Redpanda xử lý I/O theo mô hình đĩa tuần tự (Sequential I/O) cực nhanh.       |
| **Độ bền dữ liệu**   | Có thể mất data nếu DB sập khi đang log  | Được lưu trữ an toàn trên Broker | Redpanda lưu message vào đĩa trước khi Consumer lấy đi, tránh mất dữ liệu.    |
| **Khả năng mở rộng** | Khó mở rộng vì DB gắn chặt với API       | Dễ dàng tăng số lượng Consumer   | Có thể chạy nhiều Consumer song song để đẩy dữ liệu vào nhiều đích khác nhau. |

---

## 6. Mục tiêu Hiệu năng (Performance SLA)

| Chỉ số                   | Mục tiêu                   | Cơ chế đạt được                             |
| ------------------------ | -------------------------- | ------------------------------------------- |
| **Độ trễ API Inference** | < 100ms                    | Model cache trong RAM (emptyDir Volume)     |
| **Bảo toàn Dữ liệu**     | 100% requests được ghi log | Async Background Task trong FastAPI         |
| **Downtime khi Deploy**  | 0%                         | Rolling Update + Init Container             |
| **Phục hồi DB khi sập**  | < 60 giây                  | CloudNativePG Auto Failover                 |
| **Chu kỳ Retrain**       | < 2 giờ                    | SageMaker Spot → MLflow Registry → K3s      |
| **Phát hiện Drift**      | Theo ngưỡng bản ghi        | Evidently Job (kích hoạt qua Webhook)       |
| **Dispatch Model mới**   | Mỗi 5 phút                 | K8s CronJob: dispatch_production_model.py   |
| **MLflow Query**         | < 1s                       | PostgreSQL backend (database: mlflow riêng) |

---

## 7. MLflow Model Registry — Chi tiết

### 7.1. Vòng đời Model

| Stage          | Ý nghĩa                                                          | Ai thực hiện           |
| -------------- | ---------------------------------------------------------------- | ---------------------- |
| **Staging**    | Model vừa được đăng ký sau khi train xong trên SageMaker         | `train.py` tự động     |
| **Production** | Model được chọn phục vụ inference, được gán alias `"production"` | Data Scientist (HitL)  |
| **Archived**   | Model cũ đã bị thay thế bởi phiên bản mới, giữ lại để rollback   | Tự động khi deploy mới |

### 7.2. Public Access & Security (Cloudflare Tunnel)

Thay vì mở NodePort hoặc sử dụng nhiều Tunnel riêng lẻ, hệ thống sử dụng **duy nhất một cụm Cloudflare Tunnel** (`cloudflared-tunnel.yaml`) để expose các Dashboard nội bộ ra internet:

- **Unified Routing**: Một Tunnel ID duy nhất xử lý nhiều Public Hostnames.
- **Cross-Namespace Routing**: Nhờ mạng phẳng của K8s, Tunnel Pod trong namespace `default` có thể trỏ tới:
  - `mlflow.mlops-nids-nt114.id.vn` -> `http://mlflow-service:5000`
  - `grafana.mlops-nids-nt114.id.vn` -> `http://monitoring-grafana.monitoring.svc.cluster.local:80`
- **Security**: Toàn bộ traffic được mã hóa TLS từ Edge của Cloudflare đến Tunnel Pod, không cần mở port trên Firewall của AWS.

### 7.3. Truy cập Dashboard

| Dịch vụ       | URL                                      | Authentication        |
| ------------- | ---------------------------------------- | --------------------- |
| **MLflow UI** | `https://mlflow.mlops-nids-nt114.id.vn`  | Nginx Basic Auth      |
| **Grafana**   | `https://grafana.mlops-nids-nt114.id.vn` | Grafana Internal Auth |

---

_Last updated: 2026-05-01 - UIT · NT114 · MLOps NIDS System Project_
