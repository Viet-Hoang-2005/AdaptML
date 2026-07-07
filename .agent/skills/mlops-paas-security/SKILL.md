---
name: mlops-paas-security
description: Bảo mật nền tảng AI PaaS Multi-Tenant: Asymmetric JWT, Kaniko Rootless Build (thay Docker Socket), AWS IAM Role (thay Access Key tĩnh), External Secrets Operator, và Tenant Isolation.
---

# Bảo mật Nền tảng AI PaaS

> Đọc skill `mlops-paas-architecture` trước để nắm kiến trúc tổng thể.

---

## 1. Xác thực Bất Đối Xứng (JWT RS256)

- Django Control Plane ký JWT bằng **Private Key** (RS256)
- FastAPI Model Server xác thực Token bằng **Public Key** lấy từ JWKS endpoint
- **Ưu điểm**: Không cần gọi network về Control Plane khi verify — loại bỏ Network Overhead
- JWT payload chứa `tenant_id` và `model_id` để đảm bảo cô lập

Env vars liên quan: `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` (trong `.env` và `mlops/production-secrets` trên AWS)

---

## 2. Kaniko Rootless Build — Loại bỏ Docker Socket

**Vấn đề cũ**: Mount `/var/run/docker.sock` vào container cho phép container đó leo thang đặc quyền (root trên host node) — nguy hiểm trong môi trường Multi-Tenant.

**Giải pháp hiện tại (Production K3s)**:
- Dùng `gcr.io/kaniko-project/executor` — build image trong user-space, không cần Docker Daemon
- Kaniko đọc `Dockerfile` từ `emptyDir` volume được chia sẻ giữa các bước
- Xác thực với Harbor qua Secret `harbor-registry-dockerconfig` (dockerconfigjson) mount vào `/kaniko/.docker/`

File: `k8s/argo-workflows/build-workflowtemplate.yaml` — không còn `hostPath: /var/run/docker.sock`

---

## 3. AWS IAM Role — Loại bỏ Access Key tĩnh trên Production

**Production K3s (EC2 với IAM Policy)**:
- EC2 worker nodes được gắn IAM Role với policy cho phép truy cập S3 và Secrets Manager
- `boto3` tự động dùng Instance Metadata Service (IMDS) → không cần `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` trong environment của container

**Local (docker-compose)**:
- `AWS_ACCESS_KEY_ID` và `AWS_SECRET_ACCESS_KEY` lấy từ file `.env`
- `build_adapter.py` và `deploy_adapter.py` chỉ inject các biến này vào container khi chúng thực sự tồn tại trong environment (tránh truyền chuỗi rỗng `""` làm boto3 lỗi InvalidAccessKeyId)

---

## 4. External Secrets Operator (ESO)

- Không lưu secrets trong Git — chỉ lưu định nghĩa `ExternalSecret` referencing AWS Secrets Manager keys
- ESO tự động đồng bộ secrets mỗi 1 giờ
- 3 kho AWS Secrets Manager:
  - `mlops/aws-secrets` — AWS Credentials (local dev only)
  - `mlops/github-actions-secrets` — Harbor Robot Account, Cosign Keys
  - `mlops/production-secrets` — DB, JWT keys, OAuth, Harbor, Webhook secrets

---

## 5. Tenant Isolation

**ORM Layer**: Tất cả Django query đều filter theo `request.user.tenant` — không tenant nào có thể truy cập tài nguyên của tenant khác.

**K8s Layer**:
- Mỗi model endpoint là Deployment/Service/IngressRoute riêng biệt
- Training jobs chạy trong namespace `user-jobs` với ResourceQuota
- Traefik IngressRoute route theo `/{tenant_id}/models/{hashid}/...` — cô lập bằng URL path

**Harbor Registry**:
- Image của mỗi tenant được tag theo pattern: `{tenant_id}-model-{model_hashid}:latest`
- Lưu trong project `user-images` trên Harbor

---

## 6. Webhook Validation

Tất cả internal webhook callback đều được xác thực bằng HMAC `X-Webhook-Secret` header:
- `CONTROL_PLANE_WEBHOOK_SECRET` trong Secret `mlops-paas-secret`
- Áp dụng cho: build-webhook, training-webhook, drift-webhook

---

## 7. Image Signing (Cosign)

CI/CD pipeline (GitHub Actions) dùng Cosign để ký Docker Images sau khi push lên Harbor.
- `COSIGN_PRIVATE_KEY` và `COSIGN_PASSWORD` lưu trong `mlops/github-actions-secrets`
