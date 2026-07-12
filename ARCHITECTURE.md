# Thiết kế Kiến trúc Hệ thống (System Architecture)

Tài liệu này đặc tả chi tiết kiến trúc của **MLOps AI PaaS - Nền tảng Quản lý Vòng đời Mô hình AI Đa Người thuê (Multi-Tenant)** phục vụ bài toán Phát hiện Tấn công Mạng (NIDS) dựa trên tập dữ liệu CIC-IDS2017.

---

## 1. Kiến trúc Tổng thể (High-Level Architecture)

Hệ thống hoạt động như một **AI PaaS** với hai mặt phẳng điều phối tách biệt:

- **Control Plane** - Django DRF xử lý API, xác thực đa người thuê (Asymmetric JWT RS256), quản lý vòng đời mô hình và điều phối Argo Workflows.
- **Data Plane** - Các tiến trình nền: Build Image (Kaniko), Deploy Endpoint, Training (Kubeflow), Drift Detection (Evidently AI).

```mermaid
flowchart TB
    subgraph CLIENT["Người dùng / Tenant"]
        USER["Tenant\n(Upload Model, Gửi Request Suy luận)"]
        BROWSER["React Dashboard\nQuản trị PaaS"]
    end

    subgraph AWS_INFRA["Hạ tầng AWS (Terraform)"]
        ALB["Application Load Balancer\nPublic Endpoint HTTPS"]
        ASM["AWS Secrets Manager\nVault bảo mật"]
        S3["AWS S3\nmlops-paas-artifacts\n(Model Artifacts, Training Data)"]
        ECR["Harbor Registry\n(Private Docker Registry\ntrên K3s)"]

        subgraph K3S["K3s Production Cluster (1 Master + 2 Workers)"]
            ESO["External Secrets Operator\nASM → K8s Secrets"]
            TRAEFIK["Traefik Ingress\n(Dynamic IngressRoute)"]
            REDIS["Redis\nJob Status / Build Logs"]

            subgraph CTRL["Control Plane (Django DRF)"]
                AUTH["authentication\n(JWKS + RS256 JWT)"]
                REGISTRY["registry\n(Model API, Deployment)"]
                TRAINING["training\n(Kubeflow Service)"]
                DRIFT["drift\n(Evidently Orchestration)"]
            end

            subgraph ARGO["Argo Event-Driven Layer"]
                EVT["Argo Events\n(EventSource + Sensor)"]
                WF["Argo Workflows\n(WorkflowTemplates)"]
            end

            subgraph KUBEFLOW["Kubeflow Training Operator"]
                KFP_CPU["PyTorchJob (CPU)\nuser-jobs namespace"]
                KFP_GPU["PyTorchJob (GPU)\nKarpenter NodePool"]
            end

            MLFLOW["MLflow Server\nModel Registry"]
            EVIDENTLY["Evidently AI\nDrift Detection Job"]
            MODEL_SVC["Model Endpoint Pods\n(Mỗi tenant có endpoint riêng)"]
        end
    end

    USER -->|"POST /api/models/ (Upload)"| ALB
    BROWSER -->|"Quản lý Model / Job"| ALB
    ALB --> TRAEFIK
    TRAEFIK --> CTRL
    TRAEFIK -->|"/tenant_id/models/project_uuid/version_uuid/predict"| MODEL_SVC

    CTRL -->|"Webhook → Argo Events"| EVT
    EVT -->|"Trigger"| WF
    WF -->|"Build 3-Step Pipeline"| ECR
    WF -->|"Deploy IngressRoute"| MODEL_SVC
    WF -->|"Create PyTorchJob"| KUBEFLOW
    WF -->|"Run Drift Job"| EVIDENTLY

    KUBEFLOW -->|"Log Metrics"| MLFLOW
    KUBEFLOW -->|"Upload Artifacts"| S3
    EVIDENTLY -->|"Download Model / Reference Data"| S3
    EVIDENTLY -->|"Webhook kết quả"| CTRL

    ASM -->|"IAM / ESO"| ESO
    ESO -->|"K8s Secrets"| CTRL
    ESO -->|"K8s Secrets"| KUBEFLOW
    CTRL -->|"Job Status"| REDIS
```

---

## 2. Chi tiết Từng Thành phần

### 2.1. Lớp Xác thực Đa Người thuê (Multi-Tenant Authentication)

Hệ thống sử dụng **Asymmetric RS256 JWT** để xác thực. Access Token được ký bằng Private Key và xác thực bằng Public Key qua chuẩn JWKS - đảm bảo các service khác (Model Endpoints) có thể xác thực Token mà không cần truy cập Control Plane.

```mermaid
sequenceDiagram
    participant USER as Tenant (Browser)
    participant CP as Control Plane (Django)
    participant ENDPOINT as Model Endpoint (FastAPI)

    USER->>CP: POST /api/auth/login/ (username + password)
    CP-->>USER: access_token (RS256 JWT) + refresh_token

    USER->>ENDPOINT: POST /predict (Authorization: Bearer <token>)
    ENDPOINT->>CP: GET /api/auth/.well-known/jwks.json
    CP-->>ENDPOINT: Public Key (JWK)
    ENDPOINT-->>ENDPOINT: Verify Token locally
    ENDPOINT-->>USER: Kết quả suy luận
```

**Kiến trúc cô lập dữ liệu (Multi-Tenant Isolation):**

- Mỗi Tenant có `tenant_id` duy nhất được nhúng vào JWT Payload.
- Tất cả query Django đều tự động lọc theo `request.tenant` - không tenant nào có thể truy cập tài nguyên của tenant khác.
- Resource Quota của Kubeflow được áp dụng theo namespace `user-jobs` để chống Noisy Neighbor.

---

### 2.2. Luồng Đóng gói Mô hình (Model Build & Package Flow)

#### Môi trường Local (Docker Compose)

Control Plane sử dụng **Docker SDK (docker-py)** để khởi tạo container `model-packager` với Docker Socket mount.

```
Control Plane (Django) → DockerBuildAdapter → docker run model-packager → Docker Daemon → Harbor Registry
```

#### Môi trường Production (K3s)

Control Plane sử dụng **ArgoBuildAdapter** để gửi Webhook tới Argo Events. Pipeline được thực thi theo 3 bước tuần tự (DAG Steps) qua volume dùng chung `emptyDir`:

```mermaid
flowchart LR
    CP["Control Plane\nArgoBuildAdapter"] -->|"Webhook"| EVT["Argo Events\n(EventSource /build)"]
    EVT -->|"Trigger"| WF["Argo Workflows\n(build-workflowtemplate)"]

    subgraph WF["Build Pipeline (3 Steps)"]
        direction TB
        S1["① prepare-package\n(model-packager container)\nTải S3 → MLflow format\n→ Sinh Dockerfile + webhook_payload.json\nvào /workspace (emptyDir)"]
        S2["② kaniko-build\n(gcr.io/kaniko-project/executor)\nĐọc /workspace/Dockerfile\nBuild rootless → Push Harbor"]
        S3["③ notify-success\n(model-packager NOTIFY_BUILD)\nĐọc webhook_payload.json\n→ POST Webhook về Control Plane"]
        S1 --> S2 --> S3
    end

    S3 -->|"Webhook: status=success"| CP
    S2 -->|"Push Image"| HARBOR["Harbor Registry"]
```

---

### 2.3. Luồng Deploy Model Endpoint (Dynamic Routing)

Sau khi Build hoàn tất, Control Plane kích hoạt Argo Workflows để tự động tạo Kubernetes Deployment + Service + Traefik IngressRoute cho mỗi mô hình:

```mermaid
flowchart TB
    CP["Control Plane\n(deploy_adapter.py)"] -->|"Webhook → /deploy"| ARGO["Argo Events + Workflows\n(deploy-workflowtemplate)"]
    ARGO -->|"kubectl apply"| K8S

    subgraph K8S["K3s Cluster"]
        DEP["Deployment\nModel Endpoint Pod"]
        SVC["Service\n:5000"]
        INGRESS["Traefik IngressRoute\n/:tenant_id/models/:project_uuid/:version_uuid/predict"]
    end

    CLIENT["Tenant"] -->|"POST /predict"| INGRESS
    INGRESS -->|"RewritePath"| SVC --> DEP
```

**Chiến lược cô lập:** Mỗi deployment có runtime riêng theo UUID. Traefik định tuyến qua model-server gateway, còn gateway kiểm tra tenant và resolve `version_uuid` tới endpoint khỏe mạnh.

---

### 2.4. Luồng Huấn luyện Mô hình (Training Orchestration)

Tenant gửi yêu cầu huấn luyện từ React Dashboard. Control Plane gửi Webhook tới Argo Events để kích hoạt `training-workflowtemplate`:

```mermaid
sequenceDiagram
    participant USER as Tenant
    participant CP as Control Plane (Django)
    participant ARGO as Argo Events + Workflows
    participant KF as Kubeflow PyTorchJob
    participant KARPENTER as Karpenter (Node Autoscaler)
    participant S3 as AWS S3
    participant MLFLOW as MLflow Server
    participant REDIS as Redis (Job Status)

    USER->>CP: POST /api/training/jobs/ (hyperparams, data_uri)
    CP->>ARGO: Webhook → /train (payload: job_id, resources, s3_uri)
    ARGO->>KF: Tạo PyTorchJob CRD (user-jobs namespace)

    alt Yêu cầu GPU
        KF->>KARPENTER: Yêu cầu GPU Node
        KARPENTER-->>KF: Provision EC2 GPU Instance
    end

    KF->>S3: Tải training data + source code
    KF-->>KF: Huấn luyện (runner.py)
    KF->>MLFLOW: Log metrics, Register Model (Staging)
    KF->>S3: Upload model artifact (model.tar.gz)
    KF->>CP: Webhook: status=completed / failed

    CP->>REDIS: Cập nhật trạng thái Job
    CP-->>USER: HTTP Polling → training status
```

**Scale-to-Zero:** Sau khi Job hoàn tất, Karpenter tự động thu hồi GPU Node EC2 - chi phí tính theo thời gian thực tế sử dụng.

---

### 2.5. Luồng Giám sát Drift Dữ liệu (Data Drift Detection)

```mermaid
flowchart TB
    subgraph CP["Control Plane"]
        SCHED["Argo Events\n(drift EventSource)"]
    end

    subgraph DRIFT_PIPELINE["Evidently Drift Pipeline (Argo Workflows)"]
        EV["Evidently Container\n(main.py)"]
        EV --> LOAD["Tải Production Data\n+ Reference Data (S3 / DB)"]
        LOAD --> ANALYSIS["Phân tích Drift\n(DataDrift + DataQuality)"]
        ANALYSIS --> REPORT["Tạo HTML Report\n+ JSON Summary → S3"]
        REPORT --> DECISION{"Drift Score\n≥ Ngưỡng?"}
    end

    DECISION -->|"Có"| WEBHOOK_YES["Webhook về Control Plane\nstatus=drifted"]
    DECISION -->|"Không"| WEBHOOK_NO["Webhook về Control Plane\nstatus=no_drift"]
    WEBHOOK_YES --> CP
    WEBHOOK_NO --> CP

    CP -->|"Trigger"| SCHED
    SCHED -->|"Kích hoạt"| DRIFT_PIPELINE
```

Tenant có thể lập lịch chạy Drift Detection theo định kỳ hoặc kích hoạt thủ công từ Dashboard. Kết quả (HTML Report, JSON Summary) được upload lên S3 và URL được đính kèm trong phản hồi webhook.

---

### 2.6. Lớp Secret Management (External Secrets Operator)

```mermaid
flowchart LR
    ASM["AWS Secrets Manager\n(mlops/production-secrets\nmlops/aws-secrets\nmlops/github-actions-secrets)"]

    subgraph ESO["External Secrets Operator"]
        SYNC1["harbor-registry-secret-sync"]
        SYNC2["harbor-registry-dockerconfig-sync-default"]
        SYNC3["mlops-paas-app-secret-sync"]
    end

    subgraph K8S_SECRETS["K8s Secrets (auto-generated)"]
        S_APP["mlops-paas-secret\n(Django, JWT, OAuth, Webhook)"]
        S_HARBOR["harbor-registry-secret\n(HARBOR_USERNAME/PASSWORD)"]
        S_DOCKER["harbor-registry-dockerconfig\n(config.json → Kaniko Auth)"]
    end

    ASM -->|"Đồng bộ mỗi 1 giờ"| ESO
    ESO --> S_APP
    ESO --> S_HARBOR
    ESO --> S_DOCKER
```

---

## 3. Lược đồ Cơ sở Dữ liệu (Database Schema Overview)

Hệ thống sử dụng **PostgreSQL** với Schema isolation theo module:

```
PostgreSQL (mlops_paas_db)
├── Schema: control_plane (Django ORM)
│   ├── identity_customuser        - Tài khoản và tenant boundary
│   ├── catalog_modelproject - Model workspace
│   ├── registry_modelversion      - Immutable registry versions
│   ├── training_trainingjob       - Training snapshots và execution state
│   ├── deployment_deployment      - Build, deployment và endpoint state
│   └── drift_driftmonitor         - Drift configuration và run history
│
└── Schema: mlflow
    └── (MLflow tự quản lý - Runs, Experiments, Registered Models)
```

---

## 4. Hạ tầng AWS (Terraform)

```
ap-southeast-1 (Singapore)
├── VPC: 10.0.0.0/16
│   ├── Public Subnet 1a (10.0.1.0/24)  - Master Node + NAT Gateway
│   ├── Public Subnet 1b (10.0.3.0/24)  - ALB (Multi-AZ)
│   └── Private Subnet 1a (10.0.2.0/24) - Worker Nodes
│
├── EC2 Instances (K3s Cluster)
│   ├── t3.medium  - K3s Master (Control Plane Only, node-label: workload-type=control-plane)
│   ├── t3.large   - K3s Worker 1 (node-label: workload-type=worker)
│   └── t3.large   - K3s Worker 2 (node-label: workload-type=worker)
│
├── EC2 GPU Pool (Karpenter NodePool - On-Demand, Scale-to-Zero)
│   └── g4dn.xlarge / p3.2xlarge  - GPU Nodes (mlops-paas/nodepool=training-gpu)
│
├── Application Load Balancer (mlops-api-lb)
│   └── Listener :443 HTTPS → Target Group → Worker :80 (Traefik Ingress)
│
├── AWS Secrets Manager
│   ├── mlops/aws-secrets           - AWS Credentials (cho local dev)
│   ├── mlops/github-actions-secrets - Harbor Robot + Cosign Keys
│   └── mlops/production-secrets    - DB, JWT, OAuth, Harbor, Webhook...
│
└── S3 Bucket: mlops-paas-artifacts
    ├── user-models/{tenant_id}/{model_id}/   - MLflow ZIP packages
    ├── training-data/                         - Dữ liệu huấn luyện
    ├── training-artifacts/{job_id}/           - model.tar.gz output
    └── drift-reports/{job_id}/                - HTML + JSON drift reports
```

---

## 5. Chiến lược Bảo mật (Security Architecture)

| Lớp bảo mật            | Cơ chế                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| **API Authentication**  | Asymmetric RS256 JWT (Private Key ký, Public Key xác thực qua JWKS)   |
| **Multi-Tenant Isolation** | Query filter theo `tenant_id` ở tầng ORM; Namespace isolation K8s  |
| **Secret Management**   | AWS Secrets Manager + External Secrets Operator (không lưu secret trong Git) |
| **Image Build Security**| Kaniko Rootless (không Docker Socket; không root trong container)      |
| **Harbor Auth for Kaniko** | `harbor-registry-dockerconfig` Secret (dockerconfigjson) mount vào `/kaniko/.docker/` |
| **Webhook Validation**  | HMAC `X-Webhook-Secret` header trên mọi internal callback             |
| **AWS Access**          | EC2 IAM Role (Production); `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (Local) |
| **Network**             | ALB (Public) → Traefik Ingress → Services (Private); Master Node không expose workload port |
| **DNS + TLS**           | Route53 + ACM Certificate; Cloudflare Tunnel cho internal dashboards  |

---

## 6. Luồng CI/CD GitOps (GitHub Actions)

```mermaid
flowchart LR
    DEV["Developer\ngit push"] -->|"Trigger"| GH["GitHub Actions\n(ci_cd_pipeline.yml)"]
    GH -->|"docker build + push"| HARBOR["Harbor Registry\n(robot account)"]
    GH -->|"Cosign sign image"| HARBOR
    GH -->|"Update image tag\nin k8s/apps/"| GIT["Git Repo"]
    GIT -->|"Auto-sync"| ARGOCD["ArgoCD\n(GitOps Pull-based)"]
    ARGOCD -->|"kubectl apply"| K3S["K3s Cluster\n(Rolling Update)"]
```

**Services được CI/CD quản lý:**

- `mlops-paas-control-plane` - Django DRF Backend
- `mlops-paas-model-packager` - Model packaging + Dockerfile generation
- `mlops-paas-model-server` - FastAPI Model Endpoint base image
- `mlops-paas-evidently` - Drift Detection Worker
- `mlops-paas-training-runner` - PyTorchJob Training Runner
- `mlops-paas-consumer` - Kafka/Redpanda Consumer (Production Data Logging)

---

## 7. Mục tiêu Hiệu năng (Performance SLA)

| Chỉ số                        | Mục tiêu       | Cơ chế đạt được                                     |
| ----------------------------- | -------------- | ---------------------------------------------------- |
| **Latency API Inference**     | < 150ms        | Model load in-memory; Traefik Proxy trực tiếp        |
| **Build Image Time**          | < 5 phút       | Kaniko layer cache; Base image pre-built trên Harbor |
| **Deploy Endpoint Time**      | < 2 phút       | Argo Workflows DAG; `kubectl apply` trực tiếp        |
| **Training Job Startup**      | < 3 phút       | Karpenter provision node; Harbor image pull          |
| **GPU Scale-to-Zero**         | 0 chi phí idle | Karpenter thu hồi node sau khi Job kết thúc          |
| **Drift Detection**           | < 10 phút      | Evidently Argo Job; dữ liệu truy vấn từ PostgreSQL   |
| **Secret Sync**               | Mỗi 1 giờ     | External Secrets Operator refresh interval           |
| **API Auth Latency**          | < 5ms overhead | JWT verify local (không cần gọi về Control Plane)    |

---

## 8. Luồng Hoạt động Đầy đủ (End-to-End)

```mermaid
sequenceDiagram
    participant USER as Tenant
    participant CP as Control Plane
    participant ARGO as Argo Workflows
    participant KANIKO as Kaniko Build
    participant HARBOR as Harbor Registry
    participant TRAEFIK as Traefik Ingress
    participant ENDPOINT as Model Endpoint

    Note over USER,CP: Bước 1 - Upload & Build
    USER->>CP: POST /api/models/ (Upload ZIP + metadata)
    CP->>CP: Lưu artifact lên S3
    CP->>ARGO: Webhook /build (model_id, tenant_id, flavor)
    ARGO->>ARGO: Step 1: prepare-package → Sinh Dockerfile
    ARGO->>KANIKO: Step 2: kaniko-build → Build Image
    KANIKO->>HARBOR: Push Image
    ARGO->>CP: Step 3: NOTIFY_BUILD → Webhook success

    Note over USER,CP: Bước 2 - Deploy Endpoint
    USER->>CP: POST /api/models/{id}/deploy/
    CP->>ARGO: Webhook /deploy (image_name, container_name)
    ARGO->>TRAEFIK: kubectl apply Deployment + Service + IngressRoute
    CP-->>USER: endpoint_url: /tenant_id/models/project_uuid/version_uuid/predict

    Note over USER,ENDPOINT: Bước 3 - Inference
    USER->>TRAEFIK: POST /tenant_id/models/project_uuid/version_uuid/predict
    TRAEFIK->>ENDPOINT: Rewrite path to /models/version_uuid/predict
    ENDPOINT-->>USER: Kết quả suy luận (JSON)
```
