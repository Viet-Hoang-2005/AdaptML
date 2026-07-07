# K8s Manifests — Kubernetes Configuration

Thư mục `k8s/` chứa toàn bộ cấu hình Kubernetes theo phương pháp **Khai báo (Declarative)** và **GitOps** thông qua ArgoCD. Mọi thay đổi hạ tầng đều phải qua Git — không dùng `kubectl apply` thủ công trực tiếp lên cluster (ngoại trừ debugging).

---

## Cấu Trúc Thư Mục

```
k8s/
├── apps/                    # Ứng dụng PaaS (Kustomize)
│   ├── base/
│   │   ├── control-plane/   # Django Backend: Deployment, Service, ConfigMap, HPA
│   │   ├── consumer/        # Kafka Consumer Worker: Deployment, ConfigMap
│   │   └── web/             # ReactJS Frontend: Deployment, Service
│   └── production/          # Kustomize overlays: image tags, resource limits cho prod
│
├── argo-workflows/          # MLOps Orchestration Layer (Argo Events + Argo Workflows)
│   ├── eventsource.yaml               # HTTP Webhook EventSource (6 endpoints)
│   ├── sensor.yaml                    # Map events → WorkflowTemplate triggers
│   ├── eventbus.yaml                  # NATS EventBus config
│   ├── build-workflowtemplate.yaml    # 3-step Kaniko pipeline: prepare → build → notify
│   ├── deploy-workflowtemplate.yaml   # Deploy: Deployment + Service + IngressRoute
│   ├── delete-workflowtemplate.yaml   # Xóa K8s resources của model
│   ├── training-workflowtemplate.yaml # Kubeflow PyTorchJob (CPU + GPU)
│   ├── training-cancel-workflowtemplate.yaml  # Hủy PyTorchJob đang chạy
│   ├── evidently-workflowtemplate.yaml        # Drift Detection job
│   ├── training-namespace.yaml        # Namespace + RBAC cho Kubeflow jobs
│   ├── rbac.yaml                      # ServiceAccount, ClusterRoleBinding cho Argo
│   └── webhook-service.yaml           # Service expose EventSource webhook port
│
├── secrets/                 # External Secrets Operator (ESO)
│   ├── cluster-secret-store.yaml  # ClusterSecretStore → AWS Secrets Manager
│   └── external-secrets.yaml     # ExternalSecret definitions (4 K8s Secrets)
│
├── argocd/                  # ArgoCD Applications và AppProject
├── karpenter/               # NodePool + EC2NodeClass cho GPU/CPU training autoscaling
├── kubeflow/                # Kubeflow Training Operator CRDs/operator
├── mlflow-server/           # MLflow Tracking Server Deployment
├── harbor/                  # Harbor Private Registry deployment
├── postgres/                # PostgreSQL Deployment/StatefulSet
├── redis/                   # Redis Deployment
├── redpanda/                # Redpanda (Kafka-compatible) Cluster
├── monitoring/              # Prometheus + Grafana + KEDA ScaledObjects
├── cloudflare/              # Cloudflare Tunnel (cloudflared) để expose dashboards
├── security/                # NetworkPolicy, PodSecurityPolicy
├── storage/                 # StorageClass, PersistentVolume (EBS CSI)
├── health/                  # Liveness/Readiness probe configs
├── cronjobs/                # K8s CronJobs (cleanup, scheduled tasks)
├── scripts/                 # Helper scripts quản lý cluster
└── kustomization.yaml       # Root Kustomize entry point
```

---

## Argo Workflows — Event Mapping

Toàn bộ tác vụ MLOps nặng được điều phối qua Argo Events + Argo Workflows:

| EventSource Path | WorkflowTemplate | Tác vụ |
|---|---|---|
| `/build` | `build-workflowtemplate.yaml` | Đóng gói model → Kaniko Build → Push Harbor |
| `/deploy` | `deploy-workflowtemplate.yaml` | Tạo Deployment + Service + Traefik IngressRoute |
| `/delete` | `delete-workflowtemplate.yaml` | Xóa Deployment + Service + IngressRoute |
| `/train` | `training-workflowtemplate.yaml` | Tạo Kubeflow PyTorchJob (CPU hoặc GPU) |
| `/cancel-train` | `training-cancel-workflowtemplate.yaml` | Xóa PyTorchJob đang chạy |
| `/drift` | `evidently-workflowtemplate.yaml` | Phân tích Data Drift với Evidently AI |

---

## Secret Management (ESO)

`k8s/secrets/external-secrets.yaml` định nghĩa 4 K8s Secrets được đồng bộ tự động từ AWS Secrets Manager mỗi 1 giờ:

| K8s Secret | AWS Source | Dùng cho |
|---|---|---|
| `mlops-paas-secret` | `mlops/production-secrets` | Django settings, JWT keys, OAuth, Harbor, Webhook |
| `harbor-registry-secret` | `mlops/production-secrets` | HARBOR_USERNAME/PASSWORD (model-packager) |
| `harbor-registry-dockerconfig` | `mlops/production-secrets` | config.json cho Kaniko auth push Harbor (namespace: default) |
| `harbor-registry-pull-secret` | `mlops/production-secrets` | imagePullSecret cho Kubeflow PyTorchJob (namespace: user-jobs) |

---

## GitOps Flow (ArgoCD)

```
Developer → git push k8s/ → GitHub
  ↓
ArgoCD phát hiện thay đổi (polling 3 phút)
  ↓
kubectl apply (Rolling Update / Sync)
  ↓
K3s Cluster
```

**Không bao giờ** chỉnh sửa trực tiếp resource trên cluster. Mọi thay đổi phải commit vào repo này.

---

## Karpenter — GPU/CPU Node Autoscaling

`k8s/karpenter/` định nghĩa 2 NodePool:

| NodePool | Instance Type | Trigger |
|---|---|---|
| `training-cpu` | CPU instances | PyTorchJob Pod với `nodeSelector: mlops-paas/nodepool: training-cpu` |
| `training-gpu` | GPU instances (g4dn, p3) | PyTorchJob Pod yêu cầu `nvidia.com/gpu` |

K3s agent token để join cluster được lấy từ AWS Secrets Manager (`mlops/k3s-agent-token`) qua userData script — không lưu trong Git.

---

## KEDA — Scale-to-Zero cho Model Endpoints

`k8s/monitoring/` chứa `ScaledObject` cho từng model Deployment:
- Scale xuống 0 replica khi không có HTTP request (tiết kiệm tài nguyên)
- Scale lên 1+ khi có request mới (Cold Start ~3-10 giây)

---

## Triển khai lần đầu (Bootstrap)

Sau khi Ansible đã cài xong K3s cluster, apply Kustomize root:

```bash
# Từ máy local, sau khi có kubeconfig của cluster
kubectl apply -k k8s/

# Hoặc để ArgoCD tự sync (nếu đã cài ArgoCD)
# ArgoCD sẽ tự động sync toàn bộ k8s/ theo cấu hình trong k8s/argocd/
```
