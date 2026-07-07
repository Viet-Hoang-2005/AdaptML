---
name: mlops-paas-architecture
description: Hiểu biết về kiến trúc cấp cao của hệ thống AI PaaS, bao gồm Control Plane, Data Plane, Build Pipeline (Kaniko/Docker), Deploy Endpoint, Argo Workflows, Kubeflow Training, Karpenter, và các file/biến môi trường quan trọng.
---

# Kiến trúc MLOps AI PaaS — Nguồn Sự Thật (Source of Truth)

Đây là tài liệu kiến trúc tổng thể. Đọc file này TRƯỚC KHI chỉnh sửa bất kỳ thành phần nào trong repo.

---

## 1. Tổng quan Hệ thống

Hệ thống là một **Multi-Tenant AI PaaS** (Platform-as-a-Service) cho phép nhiều tổ chức (Tenants) độc lập:
- Upload, đóng gói và triển khai mô hình AI của riêng mình
- Chạy Training Jobs với GPU/CPU tự động cấp phát
- Giám sát Data Drift theo lịch hoặc thủ công
- Truy cập Model Endpoint qua URL động cô lập theo `tenant_id`

---

## 2. Hai Mặt phẳng Điều phối (Control Plane vs Data Plane)

| Mặt phẳng | Service | Vai trò |
|---|---|---|
| **Control Plane** | `services/control-plane` (Django DRF) | Quản lý User, Tenant, Model metadata, điều phối Build/Deploy/Train/Drift qua Argo Events webhook |
| **Data Plane** | `services/model-server` (FastAPI) | Phục vụ Inference tốc độ cao cho từng Model Endpoint của mỗi Tenant |
| **Packager** | `services/model-packager` | Tải model từ S3, chuẩn hóa MLflow format, sinh Dockerfile, push Harbor |
| **Training Runner** | `services/training-runner` | Chạy trong Kubeflow PyTorchJob, thực thi training script của Tenant |
| **Evidently Worker** | `services/evidently` | Phân tích Data Drift, upload report lên S3, gửi webhook kết quả |
| **Consumer** | `services/consumer` | Consume Redpanda Kafka, batch INSERT vào PostgreSQL |

---

## 3. Build Strategy — Quan trọng nhất

Biến môi trường `BUILD_STRATEGY` quyết định cơ chế đóng gói image:

### Local (docker-compose): `BUILD_STRATEGY=docker`
```
Control Plane (Django)
  → DockerBuildAdapter
  → docker run model-packager (mounting Docker Socket)
  → Docker Daemon build image
  → Push lên Harbor
```
File liên quan: `services/control-plane/src/deployment/build_adapter.py` → class `DockerBuildAdapter`

### Production (K3s): `BUILD_STRATEGY=argo`
```
Control Plane (Django)
  → ArgoBuildAdapter
  → POST webhook tới Argo Events (/build)
  → Argo Sensor kích hoạt build-workflowtemplate
  → 3-step DAG Pipeline qua emptyDir volume:
      ① prepare-package (model-packager container, BUILD_ENGINE=kaniko)
         - Tải S3 → MLflow format → sinh Dockerfile + webhook_payload.json
      ② kaniko-build (gcr.io/kaniko-project/executor)
         - Build rootless (không Docker socket)
         - Push image lên Harbor
      ③ notify-success (model-packager, TASK_TYPE=NOTIFY_BUILD)
         - Đọc webhook_payload.json → POST về Control Plane
```
File liên quan:
- `k8s/argo-workflows/build-workflowtemplate.yaml` — định nghĩa 3-step pipeline
- `services/model-packager/src/cli.py` — logic chuẩn bị build context và NOTIFY_BUILD
- `k8s/secrets/external-secrets.yaml` — `harbor-registry-dockerconfig` Secret cho Kaniko auth

**Lý do dùng Kaniko**: Không cần mount `/var/run/docker.sock`, tránh Privilege Escalation trên Multi-Tenant K8s.

---

## 4. Argo Event-Driven Workflow

Tất cả tác vụ MLOps nặng đều được điều phối qua Argo Events + Argo Workflows:

| Sự kiện (EventSource) | Template được kích hoạt | Tác vụ |
|---|---|---|
| `/build` | `build-workflowtemplate.yaml` | Đóng gói model → Kaniko → Harbor |
| `/deploy` | `deploy-workflowtemplate.yaml` | Tạo Deployment + Service + Traefik IngressRoute |
| `/delete` | `delete-workflowtemplate.yaml` | Xóa Deployment + Service + IngressRoute |
| `/train` | `training-workflowtemplate.yaml` | Tạo Kubeflow PyTorchJob |
| `/cancel-train` | `training-cancel-workflowtemplate.yaml` | Xóa PyTorchJob đang chạy |
| `/drift` | `evidently-workflowtemplate.yaml` | Chạy Evidently Drift Detection |

File định nghĩa EventSource và Sensor: `k8s/argo-workflows/eventsource.yaml`, `k8s/argo-workflows/sensor.yaml`

---

## 5. Model Endpoint Routing

Sau khi Build + Deploy, Traefik IngressRoute tự động định tuyến theo URL pattern:
```
/{tenant_id}/models/{model_hashid}/{version}/predict
       ↓ (Middleware RewritePath)
/models/{model_hashid}/predict  →  model-server Pod
```

Mỗi mô hình của mỗi tenant là một Kubernetes Deployment + Service + IngressRoute riêng biệt.

---

## 6. Authentication (Asymmetric JWT RS256)

- Django Control Plane ký JWT bằng **Private Key** (RS256)
- Model Server / FastAPI endpoints xác thực Token bằng **Public Key** lấy từ JWKS endpoint (`/api/auth/.well-known/jwks.json`)
- Không cần gọi về Control Plane khi verify — loại bỏ hoàn toàn Network Overhead
- JWT chứa `tenant_id`, `model_id` để đảm bảo cô lập đa người thuê

---

## 7. Secret Management

AWS Secrets Manager → External Secrets Operator → K8s Secrets:

| AWS Secret | K8s Secret | Dùng cho |
|---|---|---|
| `mlops/production-secrets` | `mlops-paas-secret` | Django, JWT, OAuth, Webhook, Harbor |
| `mlops/production-secrets` | `harbor-registry-secret` | HARBOR_USERNAME/PASSWORD (model-packager) |
| `mlops/production-secrets` | `harbor-registry-dockerconfig` | config.json cho Kaniko auth push Harbor |
| `mlops/aws-secrets` | — | AWS credentials (local dev only) |
| `mlops/github-actions-secrets` | — | CI/CD, Harbor Robot, Cosign |

Script đẩy secrets lên AWS: `scripts/push_secrets_to_aws.py` (đọc `.env`, boto3 client dùng credentials từ env)

---

## 8. Training Orchestration

`TRAINING_BACKEND` quyết định backend huấn luyện:
- `local` — Local docker-compose: Control Plane chạy script trực tiếp bằng subprocess
- `kubeflow` — Production K3s: Control Plane kích hoạt Argo Workflow → Kubeflow PyTorchJob

Karpenter tự động cấp phát EC2 node khi PyTorchJob Pod ở trạng thái `Pending`, thu hồi ngay sau khi Job xong (Scale-to-Zero).

Training log được stream qua Redis: key `training_logs:{job_id}`. Frontend dùng HTTP Polling 3 giây.

---

## 9. Cấu trúc Repo (Key Directories)

```
services/           # Microservices (Django, FastAPI, Packager, Runner, Evidently, Consumer)
k8s/
  argo-workflows/   # WorkflowTemplates + EventSource + Sensor
  apps/             # Kustomize manifests (control-plane, consumer, web)
  secrets/          # ExternalSecret definitions
  karpenter/        # NodePool + EC2NodeClass cho GPU/CPU training
infra/              # Terraform IaC (AWS VPC, EC2, S3, ALB, IAM, Secrets Manager)
ansible/            # Playbook cài đặt K3s cluster + addons
scripts/            # push_secrets_to_aws.py và các script tiện ích
web/                # ReactJS Frontend (Vite)
examples/training/  # Ví dụ training script cho user
```

---

## 10. Key Files — Quan trọng nhất

| File | Vai trò |
|---|---|
| `services/control-plane/src/deployment/build_adapter.py` | DockerBuildAdapter (local) và ArgoBuildAdapter (production) |
| `services/control-plane/src/deployment/deploy_adapter.py` | DockerDeployAdapter (local) và ArgoDeployAdapter (production) |
| `services/model-packager/src/cli.py` | Logic chuẩn bị build context; hỗ trợ BUILD_ENGINE=kaniko và TASK_TYPE=NOTIFY_BUILD |
| `k8s/argo-workflows/build-workflowtemplate.yaml` | 3-step Kaniko pipeline (prepare → kaniko → notify) |
| `k8s/argo-workflows/training-workflowtemplate.yaml` | CPU/GPU PyTorchJob pipeline với Karpenter |
| `k8s/secrets/external-secrets.yaml` | Tất cả ExternalSecret mappings từ AWS Secrets Manager |
| `k8s/argo-workflows/sensor.yaml` | Map Argo Events → WorkflowTemplates |
| `scripts/push_secrets_to_aws.py` | Đẩy .env lên 3 kho AWS Secrets Manager |
| `infra/` | Terraform cho AWS infrastructure |
| `ansible/site.yml` | Cài đặt K3s + toàn bộ addons |
| `.env.example` | Template biến môi trường đầy đủ |
