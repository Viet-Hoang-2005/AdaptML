---
name: mlops-nids-k3s
description: Hướng dẫn quản trị Kubernetes manifests, PostgreSQL HA, Secret Management và MLflow trên K3s.
---

# K3s & CloudNativePG Operations

## 1. Hạ tầng AWS & Luồng Mạng

- **Cluster K3s** sinh ra từ Terraform (`infra/main.tf`):
  - Master Node: `t3.small` (IP Public: 10.0.1.x) — control-plane only
  - Worker Node 1: `t3.large` (IP Private: 10.0.2.x) — API, Consumer, MLflow, Postgres PRIMARY
  - Worker Node 2: `t3.large` (IP Private: 10.0.2.x) — Redpanda, Postgres STANDBY
- **AWS ALB** → port 80 → **Traefik Ingress** (tích hợp K3s) → FastAPI `ClusterIP` Service.
- **MLflow** chạy trên Worker Node, không expose NodePort — public qua **Cloudflare Tunnel** → Nginx reverse proxy.

## 2. Quản trị PostgreSQL HA (CloudNativePG)

- Cluster định nghĩa trong `k8s/postgres-cluster.yaml`, dùng Operator **CloudNativePG**.
- Storage: `storageClass: local-path`, antiAffinity đảm bảo 2 Pod không cùng Worker.
- Primary ở Worker 1, Standby ở Worker 2 (WAL Streaming Replication).
- Failover: Standby được promote tự động trong 5–60 giây khi Primary mất kết nối.
- Services tự động tạo bởi Operator: `mlops-nids-postgres-rw` (→ Primary), `mlops-nids-postgres-ro` (→ load-balanced).

## 3. Secret Management (Zero-Trust: ESO + AWS Secrets Manager)

**KHÔNG dùng** hardcode credential, ConfigMap, hoặc GitHub Secrets cho dữ liệu nhạy cảm.

### Luồng đồng bộ Secret:
```
AWS Secrets Manager (mlops/*) → ESO ClusterSecretStore → ExternalSecret CRD → K8s Secret → Pod env
```

### Các manifest liên quan:
- `k8s/eso-install.sh` — Cài đặt External Secrets Operator qua Helm.
- `k8s/cluster-secret-store.yaml` — Kết nối ESO với AWS Secrets Manager (apiVersion: `external-secrets.io/v1`).
- `k8s/external-secrets.yaml` — Định nghĩa 6 ExternalSecret objects đồng bộ từ AWS.

### Các Secret được sync:
| AWS Secret Name | K8s Secret Name | Dùng cho |
|---|---|---|
| `mlops/postgres-secrets` | `postgres-secrets` | CloudNativePG credentials |
| `mlops/aws-secrets` | `aws-secrets` | Init Container kéo model S3 |
| `mlops/github-secrets` | `github-secrets` | Lambda + Dispatch CronJob → GitHub |
| `mlops/github-actions-secrets` | `github-actions-secrets` | CI/CD: DockerHub, Kaggle, Slack, KubeConfig |
| `mlops/tunnel-token` | `cloudflare-tunnel-token` | Cloudflare Tunnel |
| `mlflow-basic-auth` | `mlflow-basic-auth` | Nginx Basic Auth cho MLflow UI |

## 4. MLflow Stack trên K3s

- `k8s/mlflow-init-job.yaml` — One-time Job: tạo user `mlflow` và database `mlflow` trong PostgreSQL.
- `k8s/mlflow-deployment.yaml` — MLflow Server, kết nối PostgreSQL backend + S3 artifact store.
- `k8s/mlflow-nginx.yaml` — Nginx reverse proxy với Basic Auth bảo vệ MLflow UI.
- `k8s/cloudflared-tunnel.yaml` — Cloudflare Tunnel expose MLflow ra HTTPS public.
- `k8s/dispatch-cronjob.yaml` — CronJob mỗi 5 phút chạy `dispatch_production_model.py`.

## 5. Troubleshooting

- **API `psycopg2.OperationalError`:** Kiểm tra `DB_HOST_RW/RO` — chỉ có service `mlops-nids-postgres-rw`, `mlops-nids-postgres-ro`, `mlops-nids-postgres-r`.
- **Init Container fail:** `kubectl logs <api-pod> -c aws-s3-model-sync` — kiểm tra `RUN_ID`, `EXPERIMENT_ID`, `MODEL_VERSION` có đúng với đường dẫn S3 không.
- **ExternalSecret không sync:** Kiểm tra `kubectl get clustersecretstore` và `kubectl describe externalsecret <name>` — apiVersion phải là `external-secrets.io/v1`.
- **MLflow kết nối DB thất bại:** Xem `kubectl logs -l app=mlflow-server` — thường do mlflow user chưa được tạo (chạy lại `mlflow-init-job.yaml`).
