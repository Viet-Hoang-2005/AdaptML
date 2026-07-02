<div align="center">

# MLOps NIDS System

### Nền tảng AI PaaS End-to-End với Kiến trúc Event-Driven, Multi-Tenant và Tự động Hóa Hoàn Toàn cho Phát hiện Tấn công Mạng (NIDS)

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![Django](https://img.shields.io/badge/Django-4.x-092E20?style=flat-square&logo=django&logoColor=white)](https://djangoproject.com)
[![MLflow](https://img.shields.io/badge/MLflow-3.11.x-0194E2?style=flat-square&logo=mlflow&logoColor=white)](https://mlflow.org)
[![Evidently AI](https://img.shields.io/badge/Evidently_AI-0.4.x-6D31FF?style=flat-square)](https://evidentlyai.com)
[![Kubernetes](https://img.shields.io/badge/K3s-v1.34-326CE5?style=flat-square&logo=kubernetes&logoColor=white)](https://k3s.io)
[![Argo](https://img.shields.io/badge/Argo_Workflows-Event--Driven-EF7B4D?style=flat-square)](https://argoproj.github.io/workflows)
[![Kubeflow](https://img.shields.io/badge/Kubeflow-PyTorchJob-2596BE?style=flat-square)](https://kubeflow.org)
[![Ansible](https://img.shields.io/badge/Ansible-14.0-EE0000?style=flat-square&logo=ansible&logoColor=white)](https://ansible.com)
[![AWS](https://img.shields.io/badge/AWS-Terraform-FF9900?style=flat-square&logo=amazonaws&logoColor=white)](https://aws.amazon.com)

**Học phần:** NT114 - Đồ án Chuyên ngành · Khoa Mạng máy tính và Truyền thông dữ liệu · UIT

| Thành viên             | Email                  | Phụ trách                                                        |
| ---------------------- | ---------------------- | ---------------------------------------------------------------- |
| Trần Nguyễn Việt Hoàng | <23520541@gm.uit.edu.vn> | MLOps Architecture + Django Control Plane + Argo Training Pipeline |
| Bùi Ngọc Thái          | <23521412@gm.uit.edu.vn> | K3s Operations + Terraform/AWS + CI/CD + MLflow                  |

</div>

---

## 1. Tổng quan ⭐

Hệ thống này là một **nền tảng AI-as-a-Service (AI PaaS) MLOps hoàn chỉnh** được xây dựng chuyên biệt cho bài toán phát hiện hành vi xâm nhập mạng (NIDS). Nền tảng cho phép người dùng (tenant) tự mình **upload model, đóng gói, triển khai endpoint suy luận, theo dõi Data Drift, và kích hoạt tái huấn luyện** — hoàn toàn tự động, không cần can thiệp thủ công.

### Luồng chính (High-Level Flow)

```
[User Upload Model] ──► [Argo Workflows: Build Docker Image]
                                   │
                                   ▼
                         [Harbor Registry: Push Image]
                                   │
                                   ▼
                    [Argo Workflows: Deploy Traefik IngressRoute]
                                   │
                                   ▼
                   [GET /api/v1/{tenant_id}/models/{model_id}/predict]
                                   │
              ┌────────────────────┴──────────────────────────┐
              │ Inference Data                                 │
              ▼                                               ▼
     [Redpanda Broker]                           [Redis: Streaming Logs]
              │                                               │
              ▼                                               ▼
  [Consumer: Batch DB Writer]                     [React UI: HTTP Polling]
              │
              ▼
      [PostgreSQL: Production Data]
              │
              ▼
  [Evidently AI Drift Job (Argo Scheduled)]
              │
              ▼
  [Argo Event: Trigger PyTorchJob (Kubeflow)]
              │
              ▼
  [Karpenter: Auto-provision GPU Node]
              │
              ▼
  [Kubeflow: Distributed Training] ──► [MLflow Registry] ──► [Promote to Production]
```

---

## 2. Tính năng Cốt lõi ✨

| #   | Tính năng                                                                          | Công nghệ                          |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------- |
| 1   | **Multi-tenant AI PaaS** — Cách ly tài nguyên và namespace giữa các tenant         | Django + Asymmetric JWT (RS256)    |
| 2   | **Event-driven Build Pipeline** — Tự động build Docker image từ model upload       | Argo Workflows + Harbor            |
| 3   | **Dynamic Model Serving** — Tự tạo/xóa endpoint Traefik IngressRoute theo model   | Argo Workflows + Traefik           |
| 4   | **Automated Drift Detection** — Phát hiện Data Drift theo lịch, gửi Webhook       | Evidently AI + Argo Workflows      |
| 5   | **Event-driven Training** — Argo Events lắng nghe và kích hoạt PyTorchJob         | Argo Events + Kubeflow Training    |
| 6   | **GPU Auto-scaling** — Tự động provision và thu hồi node GPU khi training         | Karpenter NodePool                 |
| 7   | **HTTP Polling Training Logs** — Log training stream vào Redis, UI polling 3 giây | Redis + React                      |
| 8   | **Model Registry & HitL** — Quản lý vòng đời model, phê duyệt thủ công           | MLflow Registry                    |
| 9   | **Zero-downtime Deployment** — Rolling update không gián đoạn dịch vụ             | ArgoCD GitOps                      |
| 10  | **PostgreSQL HA** — 2 Instances (Primary + Standby), auto failover < 60s           | CloudNativePG                      |
| 11  | **Full-stack Observability** — Giám sát API, DB, Redpanda và ML metrics           | Prometheus + Grafana               |
| 12  | **Automated Infrastructure** — Một lệnh cài đặt hoàn toàn K3s và tất cả Add-ons  | Ansible + Terraform                |

---

## 3. Kiến trúc Hệ thống 🏛️

![MLOPs NIDS System Architecture](web/src/assets/pictures/MLOps-NIDS-Architecture.png)

> Xem chi tiết kiến trúc và các diagram tại [ARCHITECTURE.md](ARCHITECTURE.md)

---

## 4. Công nghệ sử dụng ⚙️

| Layer                    | Technology                                                |
| ------------------------ | --------------------------------------------------------- |
| **Machine Learning**     | XGBoost + Scikit-learn + PyTorch + MLflow                 |
| **Model Serving**        | BentoML + FastAPI + Traefik IngressRoute (Dynamic)        |
| **Training Orchestration** | Argo Workflows + Kubeflow PyTorchJob + Karpenter        |
| **Drift Detection**      | Evidently AI + Argo Workflows (Scheduled)                 |
| **Control Plane**        | Django 4.x + DRF + Asymmetric JWT (RS256/JWKS)           |
| **Message Broker**       | Redpanda (Kafka-compatible)                               |
| **Database (HA)**        | PostgreSQL 15 + CloudNativePG + SQLAlchemy                |
| **Cache / Log Stream**   | Redis (Training Logs, HTTP Polling)                       |
| **Container Registry**   | Harbor (Self-hosted, Multi-tenant)                        |
| **CI/CD**                | GitHub Actions + ArgoCD GitOps                            |
| **Model Registry**       | MLflow + AWS S3                                           |
| **Orchestration**        | K3s (Kubernetes) + ArgoCD                                 |
| **Infrastructure**       | Terraform + AWS (VPC + EC2 + ALB + S3)                   |
| **Automation**           | Ansible (K3s Setup + K8s Add-ons Deployment)             |
| **Secrets Mgmt**         | AWS Secrets Manager + External Secrets Operator           |
| **Observability**        | Prometheus + Grafana + AlertManager                       |
| **Autoscaling**          | KEDA (Event-driven) + Karpenter (Node autoscaling)        |

---

## 5. Cấu trúc Thư mục 📁

```
mlops-nids-system/
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                            # Build & push Docker images → Harbor Registry
│   │   └── cd.yml                            # GitOps: Cập nhật image tag → ArgoCD auto-sync
│   └── scripts/
│       └── clear_production_data.py          # Dọn dẹp dữ liệu production sau kiểm thử
│
├── services/
│   ├── control-plane/                        # Django: AI PaaS Control Plane
│   │   └── src/
│   │       ├── authentication/               # Đăng ký, đăng nhập, JWT RS256 + JWKS Endpoint
│   │       ├── registry/                     # Model Registry: Upload, Build, Deploy vòng đời
│   │       ├── training/                     # Training Jobs: Argo Adapter, Log Polling Redis
│   │       ├── drift/                        # Drift Monitoring: Trigger & Webhook Handler
│   │       ├── deployment/                   # Deploy Adapter: Tạo/xóa Traefik IngressRoute
│   │       └── realtime/                     # HTTP Polling: Build Logs từ Redis
│   │
│   ├── bento-model-server/                   # BentoML: Model inference server (per-tenant)
│   ├── model-packager/                       # Đóng gói model thành BentoML Service
│   ├── model-server/                         # FastAPI inference gateway
│   ├── consumer/                             # Redpanda Consumer: Batch DB Writer
│   ├── evidently/                            # Evidently AI: Drift Detection Job
│   ├── training-runner/                      # PyTorchJob Training Script (chạy trong Kubeflow)
│   ├── api/                                  # Locust Load Testing & API Testing
│   └── test/                                 # Integration Tests
│
├── k8s/
│   ├── apps/                                 # ArgoCD-managed manifests (GitOps)
│   │   ├── base/                             # Base manifests: control-plane, web, consumer
│   │   └── production/                       # Production overlays: ingress, configmaps
│   │
│   ├── argo-workflows/                       # Argo Workflows: Event-driven Pipelines
│   │   ├── eventsource.yaml                  # EventSource: /train, /cancel-train webhooks
│   │   ├── sensor.yaml                       # Sensor: Map events → WorkflowTemplate triggers
│   │   ├── build-workflowtemplate.yaml       # Build: Kaniko build Docker image → Harbor
│   │   ├── deploy-workflowtemplate.yaml      # Deploy: Tạo/xóa Traefik IngressRoute
│   │   ├── training-workflowtemplate.yaml    # Training: Tạo PyTorchJob CRD
│   │   ├── training-cancel-workflowtemplate.yaml # Cancel: Resource action: delete PyTorchJob
│   │   ├── evidently-workflowtemplate.yaml   # Drift: Chạy Evidently Drift Detection Job
│   │   ├── delete-workflowtemplate.yaml      # Delete: Xóa endpoint và resources
│   │   └── rbac.yaml                         # RBAC cho Argo Workflow Service Account
│   │
│   ├── kubeflow/                             # Kubeflow Training Operator
│   │   ├── operator.yaml                     # Kubeflow Training Operator CRD + Controller
│   │   └── kustomization.yaml
│   │
│   ├── karpenter/                            # Karpenter Node Autoscaling
│   │   ├── nodepool.yaml                     # NodePool: GPU instance types cho Training
│   │   └── kustomization.yaml
│   │
│   ├── argocd/                               # ArgoCD Configuration
│   │   ├── application.yaml                  # Application quản lý toàn bộ k8s/apps/
│   │   └── rbac.yaml                         # RBAC cho github-actions Service Account
│   │
│   ├── postgres/                             # CloudNativePG HA Cluster
│   ├── redis/                                # Redis Deployment
│   ├── redpanda/                             # Redpanda (Kafka-compatible) StatefulSet
│   ├── harbor/                               # Harbor Container Registry
│   ├── monitoring/                           # Prometheus + Grafana + AlertManager
│   ├── security/                             # Network Policies (Zero-Trust)
│   ├── storage/                              # EBS StorageClass
│   ├── secrets/                              # External Secrets + ClusterSecretStore
│   ├── cloudflare/                           # Cloudflare Tunnel (HTTPS Expose)
│   ├── health/                               # Traefik Ping (ALB Health Check)
│   └── scripts/                             # Shell scripts cài đặt Operators
│       ├── argo-install.sh                   # Cài đặt ArgoCD
│       ├── argo-workflows-install.sh         # Cài đặt Argo Workflows
│       ├── ebs-csi-driver-install.sh         # Cài đặt AWS EBS CSI Driver
│       ├── eso-install.sh                    # Cài đặt External Secrets Operator
│       ├── keda-install.sh                   # Cài đặt KEDA Autoscaler
│       └── monitoring-install.sh             # Cài đặt Prometheus + Grafana Stack
│
├── ansible/                                  # Ansible: Tự động hóa cài đặt & triển khai
│   ├── ansible.cfg                           # Cấu hình: remote_user, key, pipelining
│   ├── site.yml                              # Main Playbook: Điều phối toàn bộ quá trình
│   ├── inventory/
│   │   ├── terraform.py                      # Dynamic Inventory: Đọc IP từ terraform output
│   │   └── hosts.ini.tpl                     # Template inventory tĩnh (cho dev)
│   ├── group_vars/
│   │   ├── all.yml                           # Biến chung: domain, aws_region, k3s_channel
│   │   ├── master.yml                        # K3s server args, node-label: control-plane
│   │   └── workers.yml                       # K3s agent args, node-label: worker
│   └── roles/
│       ├── common/                           # Cài đặt OS cơ bản (curl, git, jq, nfs-common)
│       ├── k3s_master/                       # Cài K3s Server + thiết lập kubeconfig
│       ├── k3s_worker/                       # Join Worker vào cluster
│       ├── helm/                             # Cài đặt Helm 3
│       └── k8s_addons/                       # Copy k8s/ lên Master, chạy toàn bộ scripts/
│
├── infra/
│   ├── main.tf                               # Terraform root: VPC, EC2, ALB, S3, IAM
│   ├── variables.tf                          # Biến cấu hình: CIDR, instance types, EC2 key
│   ├── outputs.tf                            # Outputs: IPs, ARNs (cho Ansible inventory)
│   └── modules/
│       ├── network/                          # VPC, Subnets (Public/Private), IGW, NAT Gateway
│       ├── compute/                          # EC2 Master Node (t3.medium) + Worker Nodes (t3.large)
│       ├── security/                         # Security Groups: Master, Worker, ALB
│       ├── storage/                          # S3 Bucket: Artifacts, Model Files
│       ├── iam/                              # IAM Roles: Worker Profile, GitHub Actions OIDC
│       ├── alb/                              # Application Load Balancer + Target Groups
│       ├── dns/                              # Route53 + ACM SSL Certificate
│       └── secrets/                          # AWS Secrets Manager: Secrets placeholders
│
├── web/                                      # React Frontend: AI PaaS Dashboard
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Training/                     # Training Jobs: Submit, Monitor, Logs (HTTP Polling)
│   │   │   ├── Dashboard/                    # Overview Dashboard
│   │   │   └── ...
│   │   └── hooks/
│   │       └── useTrainingJobRealtime.ts     # Hook HTTP Polling Redis logs
│   └── nginx.conf                            # Nginx: Proxy model endpoints qua Traefik
│
├── models/                                   # Local model artifacts (dev/demo)
│   ├── v1/                                   # Model 2-class: BENIGN + DDoS
│   └── v2/                                   # Model 3-class: + PortScan
│
├── data/                                     # Datasets (CIC-IDS2017)
│   ├── test_data.csv
│   ├── train_2_classes.csv
│   ├── train_3_classes.csv
│   └── drift_portscan.csv
│
├── docker-compose.yml                        # Môi trường Local Dev (toàn bộ services)
├── data_manifest.json                        # Source of Truth: target_csv + model_version
└── .env.example                              # Template biến môi trường
```

---

## 6. Hướng dẫn Cài đặt 🛠️

### 6.1 Chạy Local (Docker Compose)

#### Yêu cầu Hệ thống

| Thành phần | Tối thiểu     | Khuyến nghị  |
| ---------- | ------------- | ------------ |
| Python     | 3.10+         | 3.12         |
| Docker     | v24+          | Latest       |
| RAM        | 8 GB          | 16 GB        |
| OS         | Ubuntu 20.04+ | Ubuntu 22.04 |

#### Các bước thực hiện

```bash
# Bước 1: Clone repository
git clone https://github.com/Viet-Hoang-2005/MLOps-nids-system.git
cd MLOps-nids-system

# Bước 2: Cấu hình biến môi trường
cp .env.example .env
# Chỉnh sửa .env theo môi trường của bạn

# Bước 3: Build và khởi chạy
docker compose up --build -d

# Theo dõi log Control Plane
docker compose logs -f control-plane
```

**Local Service URLs:**

| Service              | URL                        |
| -------------------- | -------------------------- |
| Control Plane API    | <http://localhost:8000/docs>  |
| MLflow Tracking      | <http://localhost:5001>       |
| Grafana Dashboard    | <http://localhost:3000>       |
| Redpanda Console     | <http://localhost:8080>       |
| PostgreSQL           | localhost:5432              |

---

### 6.2 Triển khai Production (K3s trên AWS EC2)

#### Bước 1: Khởi tạo hạ tầng AWS bằng Terraform

```bash
cd infra/

# Cấu hình AWS credentials
aws configure

# Khởi tạo và triển khai hạ tầng
terraform init
terraform plan
terraform apply
```

**Terraform sẽ tạo ra:**

- VPC với Public Subnet (Master) và Private Subnet (Workers)
- EC2 Master Node (`t3.medium`) + Worker Nodes (`t3.large` × 2, có thể tùy chỉnh)
- Application Load Balancer + ACM SSL Certificate + Route53
- S3 Bucket cho Model Artifacts
- IAM Roles cho Worker nodes và GitHub Actions OIDC

**Tùy chỉnh cấu hình (trong `terraform.tfvars`):**

```hcl
# Cấu hình EC2
master_instance_type  = "t3.medium"
master_volume_size    = 40
worker_instance_count = 2
worker_instance_type  = "t3.large"
worker_volume_size    = 40
key_name              = "mlops-keypair"

# Cấu hình mạng
vpc_cidr               = "10.0.0.0/16"
public_subnet_1a_cidr  = "10.0.1.0/24"
private_subnet_1a_cidr = "10.0.2.0/24"
public_subnet_1b_cidr  = "10.0.3.0/24"
```

#### Bước 2: Khởi tạo dữ liệu trên AWS Secrets Manager

Tạo các Secret sau trên AWS Console (region: `ap-southeast-1`):

**`mlops/production-secrets`** (Dành cho K3s Cluster - DB, Redis, Harbor):

```json
{
  "POSTGRES_USER": "<your-postgres-user>",
  "POSTGRES_PASSWORD": "<your-postgres-password>",
  "POSTGRES_DB": "<your-postgres-db>",
  "MLFLOW_DB_PASSWORD": "<your-mlflow-db-password>",
  "HARBOR_ADMIN_PASSWORD": "<your-harbor-password>",
  "SECRET_KEY": "<django-secret-key>"
}
```

**`mlops/github-actions-secrets`** (Dành cho CI/CD):

```json
{
  "DOCKERHUB_USERNAME": "<your-dockerhub-username>",
  "DOCKERHUB_TOKEN": "<your-dockerhub-token>",
  "HARBOR_URL": "<your-harbor-url>",
  "KUBE_CONFIG": "<your-kube-config-base64>",
  "ARGOCD_TOKEN": "<your-argocd-token>"
}
```

**`mlops/aws-secrets`** (Dành cho K3s S3 Sync):

```json
{
  "AWS_ACCESS_KEY_ID": "<your-aws-access-key-id>",
  "AWS_SECRET_ACCESS_KEY": "<your-aws-secret-access-key>"
}
```

**`mlops/mlflow-basic-auth`** (Dành cho MLflow):

```json
{
  "MLFLOW_TRACKING_URI": "<your-mlflow-tracking-uri>",
  "MLFLOW_TRACKING_USERNAME": "<your-mlflow-tracking-username>",
  "MLFLOW_TRACKING_PASSWORD": "<your-mlflow-tracking-password>"
}
```

**`mlops/tunnel-token`** (Dành cho Cloudflare Tunnel):

```json
{
  "token": "<your-cloudflare-tunnel-token>"
}
```

#### Bước 3: Cấu hình SSH Key

```bash
# Đảm bảo SSH key đặt đúng đường dẫn
ls ~/.ssh/aws_key

# Nạp key vào ssh-agent (để ProxyJump Worker nodes hoạt động)
ssh-add ~/.ssh/aws_key
```

#### Bước 4: Tự động cài đặt K3s Cluster & K8s Add-ons bằng Ansible

**Chỉ cần một lệnh duy nhất từ thư mục `ansible/`:**

```bash
cd ansible/

# Kiểm tra Ansible đã thấy đúng các node chưa
ansible-inventory --graph

# Kết quả mong đợi:
# @all:
#   |--@master:
#   |  |--master-node
#   |--@workers:
#   |  |--worker-node-1
#   |  |--worker-node-2

# Chạy playbook tự động hóa hoàn toàn
ansible-playbook site.yml
```

**Ansible sẽ thực hiện tuần tự:**

1. **`common`**: Cập nhật OS, cài đặt `curl`, `git`, `jq`, `nfs-common` trên tất cả nodes.
2. **`k3s_master`**: Cài đặt K3s Server, thiết lập `kubeconfig`, gán node-label `workload-type=control-plane`.
3. **`k3s_worker`**: Join tất cả Worker nodes vào cluster, gán node-label `workload-type=worker`.
4. **`helm`**: Cài đặt Helm 3 trên Master node.
5. **`k8s_addons`**: Đồng bộ thư mục `k8s/` và cài đặt tất cả Add-ons: EBS CSI Driver, External Secrets Operator, KEDA, ArgoCD, Argo Workflows, Prometheus + Grafana.

> **Lưu ý về SSH**: Ansible sử dụng SSH ProxyJump qua Master node để tiếp cận các Worker nodes ở Private Subnet. Private key **không bao giờ được copy lên máy chủ** — kết nối SSH được thực hiện hoàn toàn từ máy local của bạn.

#### Bước 5: Triển khai ArgoCD Applications

Sau khi Ansible hoàn tất, SSH vào Master node và triển khai ArgoCD Applications:

```bash
ssh -i ~/.ssh/aws_key ubuntu@$(cd ../infra && terraform output -raw master_public_ip)

# Tạo ArgoCD Application quản lý toàn bộ k8s/apps/
kubectl apply -f k8s/argocd/application.yaml

# Lấy ArgoCD admin password
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 --decode
```

#### Bước 6: Cài đặt Kubeflow Training Operator & Karpenter

```bash
# Cài đặt Kubeflow Training Operator (PyTorchJob CRD)
kubectl apply -k k8s/kubeflow/

# Cài đặt Karpenter NodePool cho GPU Training nodes
kubectl apply -k k8s/karpenter/
```

#### Bước 7: Cài đặt Argo Workflows Event Pipeline

```bash
# Cài đặt Argo Workflows EventBus, EventSource, Sensor và WorkflowTemplates
kubectl apply -k k8s/argo-workflows/
```

---

**Production Service URLs:**

| Service              | URL                                         |
| -------------------- | ------------------------------------------- |
| Control Plane API    | <https://api.mlops-nids-nt114.id.vn/docs>     |
| MLflow Server        | <https://mlflow.mlops-nids-nt114.id.vn>       |
| Grafana Dashboard    | <https://grafana.mlops-nids-nt114.id.vn>      |
| ArgoCD Dashboard     | <https://argocd.mlops-nids-nt114.id.vn>       |
| Harbor Registry      | <https://harbor.mlops-nids-nt114.id.vn>       |
| Redpanda Console     | <https://redpanda.mlops-nids-nt114.id.vn>     |

---

### 6.3 Gỡ cài đặt hệ thống

```bash
# Xóa các Application ArgoCD để kích hoạt cơ chế tự dọn dẹp (Prune)
kubectl delete -f k8s/argocd/application.yaml --ignore-not-found
kubectl delete namespace argocd --ignore-not-found

# Gỡ Helm releases
helm uninstall monitoring -n monitoring --ignore-not-found
helm uninstall keda -n keda --ignore-not-found
helm uninstall external-secrets -n external-secrets --ignore-not-found

# Xóa toàn bộ Persistent Volume Claims (giải phóng EBS)
kubectl delete pvc --all -n default

# Xóa hạ tầng AWS (Cẩn thận - không thể hoàn tác)
cd infra/
terraform destroy
```

---

## 7. Kiểm thử Toàn bộ Pipeline 🧪

### Giai đoạn 1: Xác nhận hệ thống sẵn sàng

```bash
# Kiểm tra trạng thái cluster
kubectl get nodes -L workload-type
# Mong đợi: master (control-plane) + workers (worker) đều Ready

# Kiểm tra tất cả pods
kubectl get pods -A
```

### Giai đoạn 2: Kiểm thử Upload & Build Model

1. Đăng nhập vào Control Plane Dashboard
2. Upload model artifact (`.pkl`, `.pt`, v.v.)
3. Theo dõi Build Log trên UI (HTTP Polling 3 giây từ Redis)
4. Kiểm tra image đã được push lên Harbor Registry

### Giai đoạn 3: Kiểm thử Deploy Endpoint

1. Nhấn "Deploy" trên Dashboard
2. Argo Workflows tự tạo Traefik `IngressRoute`
3. Gọi thử endpoint:

```bash
curl https://api.mlops-nids-nt114.id.vn/{tenant_id}/models/{model_id}/predict \
  -H "Authorization: Bearer <jwt_token>" \
  -d '{"data": [...]}'
```

### Giai đoạn 4: Kiểm thử Training Job

1. Tạo Training Job trên Dashboard
2. Quan sát Argo Events kích hoạt PyTorchJob
3. Karpenter tự provision GPU node
4. Theo dõi log training trực tiếp trên UI (HTTP Polling Redis, 3 giây)
5. Model xuất hiện trên MLflow Registry sau khi hoàn thành

### Giai đoạn 5: Kiểm thử Drift Detection

```bash
# Kích hoạt Evidently Drift Detection Job thủ công
kubectl create job --from=cronjob/evidently-drift-check drift-manual-$(date +%s)
kubectl logs -f -l app=evidently-drift-detector
# Mong đợi: Drift report xuất hiện trên Dashboard
```

### Giai đoạn 6: Kiểm tra Observability

1. Truy cập Grafana: `https://grafana.mlops-nids-nt114.id.vn`
2. Quan sát Dashboard: Request Latency, Error Rate, DB Health, Kafka Lag
3. Kiểm tra AlertManager: Cảnh báo DDoS tự động

---

## 8. Tài liệu Tham khảo 📚

| Tài liệu                           | Mô tả                                              |
| ---------------------------------- | -------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kiến trúc chi tiết, diagrams, database schema      |
| [CHANGELOG.md](CHANGELOG.md)       | Lịch sử phát triển theo từng giai đoạn             |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Quy tắc đóng góp, branch naming, commit convention |

---

<div align="center">

_Developed for UIT · NT114 · MLOps NIDS System Project_

</div>
