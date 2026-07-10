# Control Plane — Django Backend

Control Plane là **bộ não trung tâm** của nền tảng AI PaaS. Chịu trách nhiệm quản lý định danh người dùng, điều phối toàn bộ vòng đời mô hình (Upload → Build → Deploy → Train → Monitor), và đóng vai trò **Identity Provider** bằng JWT RS256.

---

## Vai Trò

- **Xác thực & Phân quyền**: Đăng ký/đăng nhập, OAuth2 (GitHub/Google), API Keys, JWT RS256 Asymmetric (Private Key ký — Public Key verify tại Model Endpoint).
- **Model Registry**: Quản lý metadata mô hình (upload, trạng thái build/deploy, phiên bản), proxy MLflow API với tenant isolation.
- **Điều phối Argo Workflows**: Khi người dùng thao tác trên Dashboard, Control Plane gửi Webhook tới Argo Events để kích hoạt:
  - `build-model-job` — Đóng gói mô hình thành Docker Image (Kaniko/Docker).
  - `deploy-model-job` — Tạo Deployment + Service + Traefik IngressRoute.
  - `delete-model-job` — Xóa tài nguyên K8s và Image trên Harbor.
  - `training-job` — Tạo Kubeflow PyTorchJob.
  - `cancel-training-job` — Xóa PyTorchJob đang chạy.
  - `evidently-job` — Chạy phân tích Data Drift.
- **Log Streaming**: Ghi log build/train vào Redis; Frontend HTTP Polling mỗi 3 giây.
- **S3 Storage**: Lưu model artifacts, training data, sinh presigned URL cho Evidently.

---

## Cấu Trúc Thư Mục

```
src/
├── authentication/   # User, Tenant, API Keys, JWT, OAuth2 (GitHub/Google), ModelAPI CRUD
├── registry/         # Model lifecycle: upload, build/deploy webhook handlers, MLflow proxy, Harbor sync
├── training/         # TrainingJob CRUD, ArgoTrainingAdapter, LocalTrainingAdapter, log streaming
├── drift/            # DriftJob CRUD, Evidently webhook handlers, drift report URLs
├── integrations/     # S3 utilities, Hashids encoding, ZIP helpers
└── core/             # Django settings, URL routing, WSGI/ASGI config
```

---

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Framework | Django 4.x + Django REST Framework |
| Database | PostgreSQL (schema: `control_plane`) |
| Cache / Log Buffer | Redis |
| Storage | AWS S3 (boto3) |
| Container Registry | Harbor (Robot Account API) |
| Async | Daphne (ASGI) + Django Channels |
| Auth | `djangorestframework-simplejwt` (RS256), `python-social-auth` |

---

## Biến Môi Trường Quan Trọng

| Biến | Mô tả |
|---|---|
| `BUILD_STRATEGY` | `docker` (local) hoặc `argo` (production K3s) |
| `TRAINING_BACKEND` | `local` (docker-compose) hoặc `kubeflow` (K3s) |
| `ARGO_EVENTS_WEBHOOK_URL` | Endpoint của Argo Events EventSource |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | Cặp RSA key cho Asymmetric JWT |
| `CONTROL_PLANE_WEBHOOK_SECRET` | HMAC secret xác thực internal webhook callbacks |
| `AWS_BUCKET_NAME` | S3 bucket lưu artifacts |
| `HARBOR_REGISTRY_URL` | URL của Harbor Private Registry |

---

## Chạy Local

```bash
# Với docker-compose từ thư mục gốc
docker compose up control-plane

# Chạy migrations
docker compose exec control-plane python manage.py migrate

# Tạo superuser
docker compose exec control-plane python manage.py createsuperuser
```

API Docs: http://localhost:8000/docs hoặc http://localhost:8000/api/
