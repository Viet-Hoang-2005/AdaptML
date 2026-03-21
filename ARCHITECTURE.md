# System Architecture

Detailed architecture documentation for the MLOps Weather Classification System.

---

## High-Level Architecture

```mermaid
flowchart TB
    subgraph INPUT["Input Layer"]
        IMG[Weather Image]
    end

    subgraph SERVICES["Services"]
        GRADIO[Gradio Demo<br/>Port 7860]
        API[Flask API<br/>Port 5000]
        DRIFT[Drift Detection<br/>Evidently AI]
        TRAIN[Training<br/>XGBoost]
    end

    subgraph STORAGE["Storage Layer"]
        PG[(PostgreSQL<br/>Logs)]
        MLF[(MLflow<br/>Model Registry)]
        S3[(AWS S3<br/>Data & Artifacts)]
        REF[Reference<br/>Data CSV]
    end

    subgraph DEPLOY["Deployment"]
        K8S[K3s<br/>Kubernetes]
        REGISTRY[Docker<br/>Registry]
        GH[GitHub<br/>Actions]
    end

    IMG --> GRADIO
    IMG --> API
    API <--> PG
    API <--> MLF
    DRIFT --> REF
    DRIFT <--> PG
    DRIFT --> GH
    GH --> TRAIN
    TRAIN --> MLF
    TRAIN --> REGISTRY
    REGISTRY --> K8S
```

---

## Component Architecture

### 1. API Layer

```mermaid
flowchart LR
    subgraph INPUT["Image Input"]
        IMG[Weather Image]
    end

    subgraph PREPROCESS["Preprocessing"]
        RESIZE[Resize 256x256]
    end

    subgraph FEATURES["Feature Extraction"]
        HSV[HSV Color]
        GRAY[Grayscale]
        HOG[HOG Vector]
        GLCM[GLCM Matrix]
    end

    subgraph STATS["Statistics"]
        CM[Color Moments<br/>6 features]
        HS[HOG Stats<br/>3 features]
        GS[GLCM Stats<br/>8 features]
    end

    subgraph MODEL["Prediction"]
        FEAT[17 Features]
        XGB[XGBoost]
        PRED[Prediction]
    end

    IMG --> RESIZE
    RESIZE --> HSV
    RESIZE --> GRAY
    HSV --> CM
    GRAY --> HOG
    GRAY --> GLCM
    HOG --> HS
    GLCM --> GS
    CM --> FEAT
    HS --> FEAT
    GS --> FEAT
    FEAT --> XGB
    XGB --> PRED
```

---

### 2. Training Pipeline

```mermaid
flowchart TB
    subgraph DATA["Data Pipeline"]
        RAW[Raw Images]
        FE[Feature Extraction]
        REF[Reference Data]
        PROD[Production Data]
    end

    subgraph TRAINING["Training Pipeline"]
        SPLIT[Train/Test Split]
        TRAIN[XGBoost Training]
        EVAL[Evaluation]
    end

    subgraph OUTPUT["Artifacts"]
        MODEL[XGBoost Model]
        ENCODER[Label Encoder]
    end

    subgraph REGISTRY["Model Registry"]
        MLFLOW[MLflow]
        DOCKER[Docker Registry]
    end

    RAW --> FE
    FE --> SPLIT
    SPLIT --> TRAIN
    TRAIN --> EVAL
    EVAL --> MODEL
    EVAL --> ENCODER
    MODEL --> MLFLOW
    ENCODER --> MLFLOW
    MLFLOW --> DOCKER
```

---

### 3. Drift Detection

```mermaid
flowchart TB
    subgraph INPUT["Data Sources"]
        PROD_FEAT[Production Features<br/>from API logs]
        REF[Reference Data<br/>baseline_features.csv]
    end

    subgraph ANALYSIS["Drift Analysis"]
        COMP[Compare Distributions]
        PSI[Calculate PSI Score]
        THRESH[Threshold Check]
    end

    subgraph OUTPUT["Actions"]
        LOG[Log Result]
        TRIGGER[Trigger Retrain]
        ALERT[Send Alert]
    end

    PROD_FEAT --> COMP
    REF --> COMP
    COMP --> PSI
    PSI --> THRESH

    THRESH -->|PSI > 0.2| TRIGGER
    THRESH -->|PSI < 0.2| LOG
    THRESH -->|PSI 0.1-0.2| ALERT
```

---

## Data Flow

### Prediction Flow

```mermaid
sequenceDiagram
    participant User
    participant API as Flask API
    participant DB as PostgreSQL
    participant Model as XGBoost

    User->>API: Upload Image
    API->>API: Extract Features (17)
    API->>Model: Predict
    Model-->>API: Prediction Result
    API->>DB: Log Features + Prediction
    DB-->>API: Confirm
    API-->>User: Return Prediction
```

### Retraining Flow

```mermaid
flowchart TB
    A[Scheduled Drift Check<br/>Every 6 hours] --> B[Load Production Features]
    B --> C[Compare with Reference Data]
    C --> D[Calculate PSI Scores]

    D --> E{PSI > 0.2?}

    E -->|Yes| F[Trigger Retrain Pipeline]
    F --> G[Pull New Data]
    G --> H[Retrain XGBoost]
    H --> I[Evaluate Model]
    I --> J{F1 >= 95%?}

    J -->|Yes| K[Register to MLflow]
    K --> L[Deploy to K3s]
    L --> M[Zero-Downtime Update]

    J -->|No| N[Alert: Model Quality Check]
    N --> O[Manual Review Required]

    E -->|No| P[Log: Stable]
    P --> Q[Continue Monitoring]
```

---

## Database Schema

### Predictions Table

```mermaid
erDiagram
    PREDICTIONS {
        int id PK
        timestamp timestamp
        string image_hash
        string predicted_class
        float confidence
        json features
        float processing_time_ms
        string model_version
    }
```

### Drift Logs Table

```mermaid
erDiagram
    DRIFT_LOGS {
        int id PK
        timestamp timestamp
        string feature_name
        float psi_score
        string status
        string action_taken
        json details
    }
```

---

## Kubernetes Deployment

```mermaid
flowchart TB
    subgraph CLUSTER["K3s Cluster"]
        subgraph API_DEPLOY["API Deployment"]
            POD1[API Pod 1]
            POD2[API Pod 2]
            POD3[API Pod 3]
        end

        subgraph SERVICE["Service Layer"]
            SVC[ClusterIP Service]
            ING[Ingress]
        end

        subgraph STORAGE["Storage"]
            PG[(PostgreSQL)]
            MLF[(MLflow)]
        end
    end

    SVC --> POD1
    SVC --> POD2
    SVC --> POD3
    ING --> SVC
    POD1 --> PG
    POD2 --> PG
    POD3 --> PG
```

### Rolling Update Strategy

```mermaid
flowchart TB
    subgraph STEP1["Step 1: Initial State"]
        V1A[v1 Pod - Active]
        V1B[v1 Pod - Active]
    end

    subgraph STEP2["Step 2: Deploy v2"]
        V1C[v1 Pod - Active]
        V2A[v2 Pod - Starting]
    end

    subgraph STEP3["Step 3: Route Traffic"]
        V1D[v1 Pod - Draining]
        V2B[v2 Pod - Active]
    end

    subgraph STEP4["Step 4: Complete"]
        V2C[v2 Pod - Active]
        V2D[v2 Pod - Active]
    end

    STEP1 -->|kubectl set image| STEP2
    STEP2 -->|Readiness Probe OK| STEP3
    STEP3 -->|Terminate v1| STEP4

    style V2C fill:#90EE90
    style V2D fill:#90EE90
    style V2B fill:#90EE90
```

---

## CI/CD Pipeline

```mermaid
flowchart LR
    subgraph TRIGGER["Triggers"]
        PUSH[Push to Main]
        SCHEDULE[Schedule]
        MANUAL[Manual Dispatch]
    end

    subgraph CI["CI Pipeline"]
        TEST[Test]
        BUILD[Build Docker]
        PUSH_REG[Push to Registry]
    end

    subgraph CD["CD Pipeline"]
        DEPLOY[Deploy to K3s]
        HEALTH[Health Check]
    end

    subgraph MONITOR["Monitoring"]
        DRIFT[Drift Detection]
        RETRAIN[Auto Retrain]
    end

    PUSH --> TEST
    SCHEDULE --> DRIFT
    MANUAL --> TEST
    MANUAL --> DRIFT

    TEST --> BUILD
    BUILD --> PUSH_REG
    PUSH_REG --> DEPLOY
    DEPLOY --> HEALTH

    DRIFT -->|PSI > 0.2| RETRAIN
    RETRAIN --> DEPLOY
```

---

## Infrastructure

### AWS Resources

```mermaid
flowchart TB
    subgraph AWS["AWS Cloud"]
        subgraph COMPUTE["Compute"]
            LAMBDA[Lambda]
            SAGEMAKER[SageMaker]
        end

        subgraph STORAGE["Storage"]
            S3_REF[S3 Bucket<br/>Reference Data]
            S3_PROD[S3 Bucket<br/>Production Data]
        end

        subgraph REGISTRY["Registry"]
            ECR[ECR<br/>Docker Images]
        end

        subgraph DATABASE["Database"]
            RDS[(RDS<br/>PostgreSQL)]
        end
    end

    LAMBDA --> S3_PROD
    SAGEMAKER --> S3_REF
    SAGEMAKER --> ECR
    SAGEMAKER --> RDS
    ECR --> LAMBDA
```

---

## Monitoring Stack

```mermaid
flowchart TB
    subgraph METRICS["Metrics Collection"]
        API[Flask API]
        EXPORT[Prometheus Exporter]
        PROM[Prometheus]
    end

    subgraph VISUALIZATION["Visualization"]
        GRAFANA[Grafana]
        EVidently[Evidently AI<br/>Drift Reports]
        MLFLOW[MLflow UI]
    end

    subgraph ALERTING["Alerting"]
        ALERT[Alert Manager]
        SLACK[Slack]
        EMAIL[Email]
    end

    API --> EXPORT
    EXPORT --> PROM
    PROM --> GRAFANA
    PROM --> ALERT
    API --> EVidently
    EVidently --> ALERT
    MLFLOW --> GRAFANA
    ALERT --> SLACK
    ALERT --> EMAIL
```

---

## Security

### Secrets Management

```mermaid
flowchart TB
    subgraph SECRETS["Secrets"]
        DB_URL[DATABASE_URL]
        AWS_KEY[AWS Access Key]
        MLFLOW_URI[MLFLOW_TRACKING_URI]
    end

    subgraph STORAGE["Secret Storage"]
        GH[GitHub Secrets]
        K8S[Kubernetes Secrets]
        AWS_SM[AWS Secrets Manager]
    end

    subgraph CONSUMERS["Consumers"]
        CI[GitHub Actions]
        K8S_POD[Kubernetes Pods]
        APP[Application]
    end

    DB_URL --> GH
    AWS_KEY --> AWS_SM
    MLFLOW_URI --> K8S

    GH --> CI
    K8S --> K8S_POD
    K8S_POD --> APP
```

---

## Scalability

### Horizontal Pod Autoscaling

```mermaid
flowchart TB
    subgraph SCALE["Auto Scaling Rules"]
        CPU[CPU > 80%]
        MEM[Memory > 80%]
        REQ[Requests > 100/s]
    end

    subgraph ACTION["Scale Action"]
        UP[Scale Up<br/>Max 10 pods]
        DOWN[Scale Down<br/>Min 1 pod]
    end

    CPU -->|OR| ACTION
    MEM -->|OR| ACTION
    REQ -->|OR| ACTION
```

---

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| API Latency (P95) | < 500ms | - |
| Throughput | 100 req/sec | - |
| Model Load Time | < 5s | - |
| Drift Detection | < 60s | - |
| MTTR | < 30 min | - |
| Zero Downtime | 100% | - |

---

Created for NT114 - MLOps Architecture Project
Department: Computer Networks and Data Communications
