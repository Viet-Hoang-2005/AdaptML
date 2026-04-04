# Thiết kế Kiến trúc Hệ thống (System Architecture)

Tài liệu này đặc tả chi tiết kiến trúc của Hệ thống MLOps Phát hiện Trôi Dữ liệu và Tái huấn luyện tự động cho Mô hình Phát hiện Tấn công Mạng (NIDS).

---

## 1. Kiến trúc Tổng thể (High-Level Architecture)

```mermaid
flowchart TB
    subgraph INPUT["Môi trường Khách (Client)"]
        USER[Người Dùng Cuối]
        LOCUST[Locust Load Testing<br/>Giả lập Tấn Công]
    end

    subgraph PROD["K3s Production Cluster"]
        API[FastAPI Server<br/>Inference API]
        PG[(PostgreSQL<br/>Lưu vết Dữ liệu)]
        EVIDENTLY[Evidently AI<br/>CronJob Monitor]
    end

    subgraph CLOUD["Cloud & CI/CD"]
        GH[GitHub Actions<br/>Orchestrator]
        KAGGLE[Kaggle API<br/>Compute Engine]
        S3[(AWS S3<br/>Model Registry)]
    end

    USER -->|Gửi NetFlow| API
    LOCUST -->|DDoS/PortScan| API
    API <-->|Lưu Async Logs| PG
    EVIDENTLY -->|Truy xuất DB 24h| PG
    EVIDENTLY -->|Webhook: drift_detected| GH
    GH -->|Lệnh Retrain| KAGGLE
    KAGGLE -->|Upload model mới| S3
    GH -->|Lệnh Rollout Restart| PROD
    PROD <-->|Init Container kéo Model| S3
```

---

## 2. Thiết kế Mạch Thành phần (Component Diagram)

### 2.1. Lớp Suy diễn và Ghi log (API & Inference Layer)

```mermaid
flowchart LR
    subgraph REQUEST["Request"]
        JSON[JSON Payload<br/>Network Features]
    end

    subgraph FASTAPI["FastAPI App (Container)"]
        PARSER[Pydantic Validation]
        MODEL[XGBoost Model<br/>& Label Encoder]
        PRED[Prediction<br/>Multi-class]
        BT[Background Task]
    end

    subgraph DATABASE["Persistent Storage"]
        DB[(PostgreSQL)]
    end

    JSON --> PARSER
    PARSER --> MODEL
    MODEL --> PRED
    PRED --> BT
    BT -->|Async Insert| DB
```

### 2.2. Lớp Giám sát và Cảnh báo (Monitoring Layer)

```mermaid
flowchart TB
    subgraph DATA["Nguồn Dữ liệu"]
        PROD_DB[(PostgreSQL<br/>Dữ liệu thực tế)]
        REF_CSV[Reference Data CSV<br/>Dữ liệu huấn luyện cũ]
    end

    subgraph EVIDENTLY["Evidently AI CronJob (00:00 hằng ngày)"]
        LOAD[Tải dữ liệu 24h qua]
        COMPARE[DataDriftPreset<br/>Phân tích Khoảng cách Phân phối]
        EVAL{Drift Score >= 0.5?}
    end

    subgraph ACTION["Hành động"]
        HTML[Lưu Report tĩnh HTML]
        WEBHOOK[POST Webhook tới Github API]
    end

    PROD_DB --> LOAD
    REF_CSV --> COMPARE
    LOAD --> COMPARE
    COMPARE --> EVAL
    EVAL -->|Sai lệch Cao| WEBHOOK
    EVAL -->|Mở rộng| HTML
```

### 2.3. Lớp K3s Deployment - Zero Downtime Updates

```mermaid
flowchart TB
    subgraph API_POD["API Pod (Kubernetes)"]
        subgraph VOL["Volume (RAM emptyDir)"]
            PKL[xgb_model.pkl]
        end

        INIT[Init Container<br/>amazon/aws-cli]
        APP[App Container<br/>fastapi-server]
    end

    S3[(AWS S3 Bucket<br/>Version Mới Nhất)]

    INIT -->|1. aws s3 cp| S3
    S3 -->|2. Tải về Volume| PKL
    INIT -->|3. Hoàn tất| APP
    APP -->|4. Khởi động & Load| PKL
```
*(Cơ chế:* Khi nhận lệnh cập nhật từ Github Actions, K3s tạo Pod mới. Pod mới sẽ chạy Init Container trước. Init Container kết nối đến S3, tải file model nặng thả vào RAM ảo, sau đó App Container mới khởi động và lấy file đó để phục vụ. *Zero-downtime)*

---

## 3. Bản đồ Thiết kế Cơ sở Dữ liệu (Database Schema)

Thu thập thông tin Log bằng tính năng Background Tasks để không làm tăng thời gian phản hồi (latency) của API:

```mermaid
erDiagram
    NIDS_PRODUCTION_DATA {
        int id PK "Tự động tăng"
        float feature_1 "Flow Duration"
        float feature_2 "Destination Port"
        float feature_n "Bwd Packet Length Max"
        string Predicted_Label "BENIGN / DDoS / PortScan"
        float Confidence_Score "Độ tin cậy của thuật toán %"
    }
```
*Lưu ý: Bàn NIDS_PRODUCTION_DATA chứa toàn bộ các cặp Key-Value payload mà Client gửi tới cộng với Nhãn dự đoán. Lược đồ động phụ thuộc vào số lượng Feature sinh ra trong quá trình Tiền Xử Lý dữ liệu CIC-IDS2017.*

---

## 4. Luồng Xử lý CI/CD/CT (Continuous Pipelines)

```mermaid
sequenceDiagram
    participant E as Evidently CronJob
    participant G as Github Actions
    participant K as Kaggle Compute
    participant S as AWS S3
    participant P as K3s Production

    E->>G: 1. Webhook: event_type=data_drift_detected
    G->>G: 2. Nhận tín hiệu, Trigger Retrain Pipeline
    G->>K: 3. Gửi lệnh huấn luyện bằng Kaggle API
    K-->>K: 4. Chạy tệp train.py với Dữ liệu mới sinh
    K->>G: 5. Trả kết quả Model F1-score > Cũ
    G->>S: 6. Upload xgb_nids_model_v2.pkl
    G->>P: 7. Lệnh ssh: kubectl rollout restart deployment
    P-->>P: 8. Rolling Update: Init Container lấy v2 và khởi chạy
```

---

## Mục tiêu Hiệu năng (Performance SLA)

| Hệ quy chiếu | Target MLOps |
|--------|--------|
| **Độ trễ API Inference** | < 100ms (Đạt được nhờ cache model vào RAM) |
| **Bảo toàn Dữ liệu** | Lưu vết 100% Request với Async Background Task |
| **Gián đoạn Dịch vụ (Downtime)** | 0% (Rolling update + K3s Init container) |
| **Tự động thay đổi Trọng số** | < 2 giờ (Kể từ khi kích hoạt chạy Kaggle Training đến lúc cập nhật k8s) |

---
*Created for MLOps NIDS System Project*
