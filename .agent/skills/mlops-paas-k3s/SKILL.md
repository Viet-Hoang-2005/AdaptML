---
name: mlops-paas-k3s
description: Hạ tầng AWS/K3s hiện tại gồm Terraform, Ansible, Kustomize, ArgoCD, CloudNativePG, Karpenter, External Secrets, Argo Workflows và KEDA consumer scaling. Dùng khi thay đổi manifest hoặc vận hành production.
---

# K3s và AWS Production

Đọc `infra/README.md`, `ansible/README.md`, `k8s/README.md`, `k8s/kustomization.yaml` và manifest mục tiêu trước khi thay đổi. Không suy đoán resource từ tài liệu cũ.

## Provision và bootstrap

1. Terraform tại `infra/` provision network, compute, security, storage, IAM, ALB, DNS và Secrets Manager theo feature flags.
2. Ansible `site.yml` cài common packages, K3s master, worker, Helm rồi platform add-ons.
3. Add-ons bootstrap gồm EBS CSI, External Secrets Operator, CloudNativePG, KEDA, Argo Workflows, Kubeflow Training Operator, Karpenter, monitoring và ArgoCD.
4. ArgoCD sync manifest GitOps sau bootstrap.

Terraform không bắt buộc tạo mọi module: tôn trọng `enable_*` variables. Karpenter cần token K3s trong AWS Secrets Manager để node mới join cluster.

## Kustomize topology

Root `k8s/kustomization.yaml` quản lý:

- Cloudflare, PostgreSQL, Redis, Redpanda, secrets, storage, health, monitoring.
- Argo Workflows và MLflow server.
- `apps/production` cho control-plane, Celery worker, model-server gateway, consumer và web.
- Karpenter NodePools/EC2NodeClasses.

`kubeflow/` chứa manifest operator, nhưng controller/CRD được bootstrap bằng script/Ansible trước GitOps sync.

## Workload routing

```text
Internet -> ALB -> Traefik -> shared ingress
                              |- web
                              |- control-plane
                              `- model-server gateway -> worker Service
```

Dynamic model deployment workflow tạo `Deployment` và `{container_name}-svc`. Không tạo IngressRoute/Middleware riêng cho mỗi model.

## Argo Events

EventSource hiện expose năm path: `/build`, `/deploy`, `/drift`, `/train`, `/cancel-train`. Sensor map chúng tới WorkflowTemplate tương ứng. Delete template vẫn tồn tại nhưng không tự suy diễn public delete contract nếu API/service chưa trigger nó.

| Workflow | Trách nhiệm |
| --- | --- |
| build | prepare package -> Kaniko -> callback |
| deploy | tạo worker Deployment + Service |
| training | tạo Kubeflow PyTorchJob CPU/GPU |
| training-cancel | xóa PyTorchJob |
| evidently | chạy data drift và callback |

## Data services và scaling

- CloudNativePG production cluster có 2 instance (primary/standby); local dùng Postgres container đơn node.
- Redis là Celery broker/result và runtime log stream.
- Redpanda lưu prediction/domain event; consumer là workload KEDA-managed.
- `k8s/apps/base/consumer/scaledobject.yaml` scale **consumer**, min 1/max 4 theo Kafka lag. Không có KEDA scale-to-zero cho từng model endpoint trong manifest hiện tại.
- Karpenter CPU/GPU NodePool phục vụ training workload; không hứa thời gian provision hoặc chi phí bằng 0.

## Secrets và GitOps

ESO đọc AWS Secrets Manager qua `ClusterSecretStore`, tạo `mlops-paas-secret`, Harbor credentials/dockerconfig và training namespace pull secret. Không commit giá trị secret, kubeconfig hay generated credentials.

Ưu tiên thay đổi Git/Kustomize rồi để ArgoCD sync. Dùng `kubectl apply` thủ công chỉ cho bootstrap hoặc debugging có chủ đích; đưa thay đổi bền vững trở lại manifest.

## Validate trước khi handoff

```bash
kustomize build --enable-helm k8s/
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
```

Chạy lệnh có quyền cluster chỉ khi task yêu cầu và đã xác minh namespace/context. Không xóa PVC, workflow hoặc Terraform resource để “dọn” nếu user chưa ủy quyền rõ ràng.
