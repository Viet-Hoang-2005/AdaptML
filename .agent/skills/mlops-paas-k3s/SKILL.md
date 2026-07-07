---
name: mlops-paas-k3s
description: Hạ tầng Kubernetes K3s trên AWS: Terraform provisioning, Ansible setup, Karpenter NodePool, KEDA Scale-to-Zero, ArgoCD GitOps, External Secrets Operator, và PostgreSQL schema.
---

# K3s Infrastructure & Cloud Operations (AI PaaS)

> Đọc skill `mlops-paas-architecture` trước để nắm kiến trúc tổng thể.

---

## 1. Terraform — AWS Infrastructure (`infra/`)

Terraform tạo ra:
- **VPC**: Public Subnet (Master + ALB) + Private Subnet (Workers)
- **EC2**: 1 Master (`t3.medium`) + 2 Workers (`t3.large`) — node-labels được gán qua Ansible
- **ALB**: Application Load Balancer → Route53 DNS → ACM SSL Certificate
- **S3**: Bucket `mlops-paas-artifacts` (model artifacts, training data, drift reports)
- **IAM**: Instance Profile cho Workers (quyền S3 + Secrets Manager); Karpenter controller role; OIDC cho GitHub Actions
- **Karpenter**: SQS interruption queue + EventBridge rules để nhận Spot interruption events

**Chạy Terraform:**
```bash
cd infra/
terraform init && terraform plan && terraform apply
```

---

## 2. Ansible — K3s Cluster Setup (`ansible/`)

Một lệnh duy nhất cài đặt toàn bộ cluster:
```bash
cd ansible/
ansible-playbook site.yml
```

Roles thực hiện tuần tự:
1. `common` — OS update, cài curl/git/jq/nfs-common
2. `k3s_master` — Cài K3s server, setup kubeconfig, gán label `workload-type=control-plane`
3. `k3s_worker` — Join workers qua SSH ProxyJump, gán label `workload-type=worker`
4. `helm` — Cài Helm 3
5. `k8s_addons` — Sync thư mục `k8s/` và cài: EBS CSI Driver, External Secrets Operator, KEDA, ArgoCD, Argo Workflows, Argo Events, Prometheus + Grafana

---

## 3. Karpenter — GPU/CPU Autoscaling

- **NodePool** định nghĩa trong `k8s/karpenter/`
- 2 NodePool:
  - `training-cpu`: Cấp phát CPU node khi có PyTorchJob Pod Pending với `nodeSelector: mlops-paas/nodepool: training-cpu`
  - `training-gpu`: Cấp phát GPU node khi có Pod yêu cầu `nvidia.com/gpu`
- **EC2NodeClass**: Ubuntu AMI + `userData` script tự động join K3s cluster
  - K3s agent token lấy từ AWS Secrets Manager (`mlops/k3s-agent-token`) — không lưu trong Git
  - Instance profile `mlops-karpenter-node-profile` có quyền `secretsmanager:GetSecretValue`

---

## 4. KEDA — Scale-to-Zero cho Model Endpoints

- **ScaledObject** cho mỗi model Deployment
- Scale xuống 0 khi không có HTTP request trong thời gian định nghĩa
- Scale lên 1+ khi có request mới
- Chấp nhận Cold Start delay (~3-10 giây) đổi lấy chi phí $0 khi idle

---

## 5. ArgoCD — GitOps

Mọi thay đổi hạ tầng (image tag, resource limits, config) phải qua Git:
1. Developer push commit lên `main`
2. ArgoCD phát hiện thay đổi trong `k8s/apps/`
3. ArgoCD `kubectl apply` — Rolling Update tự động

**Không chạy** `kubectl apply` thủ công trực tiếp lên cluster (ngoại trừ debugging).

---

## 6. External Secrets Operator

ESO đồng bộ từ AWS Secrets Manager → K8s Secrets mỗi 1 giờ.

Các ExternalSecret quan trọng định nghĩa trong `k8s/secrets/external-secrets.yaml`:
- `mlops-paas-secret` — App secrets (Django, JWT, Harbor, OAuth, Webhook)
- `harbor-registry-secret` — Harbor credentials (USERNAME/PASSWORD)
- `harbor-registry-dockerconfig` — dockerconfigjson cho Kaniko (namespace: default)
- `harbor-registry-pull-secret` — imagePullSecret cho PyTorchJob (namespace: user-jobs)

---

## 7. PostgreSQL Schema

Database: `mlops_paas_db` với 2 schema:
- `control_plane` — Django ORM: authentication, registry, training, drift tables
- `mlflow` — MLflow tự quản lý (Runs, Experiments, Models)

Connection: Worker nodes kết nối PostgreSQL qua service DNS nội bộ cluster.

---

## 8. Network Topology

```
Internet → ALB → Traefik Ingress (Worker nodes port 80)
                      ↓
            control-plane Service (Django :8000)
            model-{id} Service (FastAPI :5000)
            
Internal cluster:
  control-plane → redis, postgres, redpanda, mlflow
  argo-workflows → harbor (via HTTPS)
  kaniko → harbor (via HTTPS, /kaniko/.docker/config.json)
```
