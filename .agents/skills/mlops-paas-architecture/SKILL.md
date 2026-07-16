---
name: mlops-paas-architecture
description: Kiến trúc hiện tại của MLOps PaaS. Dùng khi cần thay đổi Control Plane Django, API, execution backend, registry, model serving gateway, S3 artifact layout, Argo hoặc luồng end-to-end của hệ thống.
---

# Kiến trúc MLOps PaaS

Đọc trước khi thay đổi cross-service hoặc thay đổi boundary giữa Control Plane và Data Plane. Ưu tiên mã nguồn và các tài liệu sau khi có mâu thuẫn:

- `ARCHITECTURE.md`
- `docs/control-plane/architecture.md`
- `docs/control-plane/api-catalog.md`
- `docs/adr/001-domain-model.md` đến `005-api-schema-hard-cut.md`

## Mô hình vận hành

```text
React/API client
  -> Traefik / ALB
  -> Django Control Plane
  -> transaction.on_commit -> Celery
  -> Docker backend (local) | Argo webhook (production)
  -> model packager | training runner | Evidently | deployment worker

Traefik -> model-server gateway -> healthy model worker
```

- **Control Plane**: modular monolith Django DRF; là nguồn sự thật cho domain state.
- **Data Plane**: workload chạy lâu và runtime inference.
- **PostgreSQL**: domain state và dữ liệu production do consumer ghi.
- **S3**: workspace, snapshot, artifact version và drift report bền vững.
- **Redis**: Celery broker/result backend và runtime log stream; không phải nguồn sự thật lifecycle.
- **MLflow**: tracking/artifact theo training job, không thay thế Control Plane Registry.
- **Redpanda**: prediction event và transactional outbox event.

## Boundary của Control Plane

| App | Sở hữu |
| --- | --- |
| `auth` | user, tenant, JWT/JWKS, OTP, OAuth, profile |
| `access` | API key scope theo project |
| `catalog` | `ModelProject`, workspace code/data mutable |
| `training` | job snapshot, event và output |
| `registry` | version/artifact/metric/alias bất biến |
| `deployment` | build, deployment và endpoint |
| `drift` | monitor và drift run |
| `observability` | health, model telemetry, transactional outbox |

Giữ các quy tắc sau:

1. Dùng `public_id` UUID cho mọi API URL, S3 key và callback; không expose integer PK hay Hashids legacy.
2. Bắt đầu tenant-facing read từ selector đã scope theo user.
3. Đặt write logic trong service; API chỉ deserialize/authorize rồi gọi service.
4. Không gọi Docker, S3, Argo hoặc HTTP client trực tiếp trong API endpoint.
5. Enqueue Celery bằng `transaction.on_commit`; callback phải idempotent và dùng UUID URL.

## Execution backends

`EXECUTION_BACKEND` là mặc định cho build/deployment/training/drift. Có thể override bằng bốn biến `*_BACKEND`; giá trị hợp lệ là `docker` hoặc `argo`.

| Capability | `docker` local | `argo` production |
| --- | --- | --- |
| Build | `model-packager` container, Docker socket | Argo: prepare package -> Kaniko -> callback |
| Training | `training-runner` container | Argo tạo Kubeflow `PyTorchJob` |
| Deployment | model worker container và health check | Argo tạo Deployment + Service |
| Drift | Evidently container | Argo Evidently workflow |

Không thêm giá trị `local`, `kubeflow`, `sagemaker` hoặc `batch` vào settings hiện tại. Factory nằm tại `services/control-plane/src/infrastructure/execution/`.

## Registry, storage và inference

```text
users/{tenant}/models/{project_uuid}/
├── code/ | data/                         # workspace editable
├── training/jobs/{job_uuid}/input|output|mlflow/
├── versions/{version_uuid}/artifacts/    # immutable registry/build artifacts
└── drift/{monitor_uuid}/{run_uuid}/
```

- `TrainingJob` snapshot code/data/requirements trước khi chạy.
- `ModelVersion` là record registry immutable tạo từ upload hoặc training output.
- Alias trỏ tới version để promote/rollback.
- Build đóng gói immutable input trước, callback thành công mới cấp version và gắn tag `vN`; deployment tạo worker riêng và pin image ID/digest của version đó.

Public inference URL luôn là:

```text
/{tenant_id}/models/{project_uuid}/{version_uuid}/predict
/{tenant_id}/models/{project_uuid}/{version_uuid}/health
```

Traefik rewrite vào `/models/{version_uuid}/{action}` của **model-server gateway**. Không tạo IngressRoute riêng cho từng model. Gateway kiểm tra public access/API key/JWT, resolve worker khỏe mạnh, forward request, emit Redpanda event và expose Prometheus metrics.

## Điểm vào cần kiểm tra

- URL Control Plane: `services/control-plane/src/config/urls.py`
- API: `services/control-plane/src/apps/*/api/`
- Domain service/selector: `services/control-plane/src/apps/*/{services,selectors}.py`
- Local/Argo adapters: `services/control-plane/src/infrastructure/execution/`
- Gateway: `services/model-server/src/`
- Workflows: `k8s/argo-workflows/`

Khi thay đổi contract, cập nhật API catalog, webhook contract, ADR nếu cần, frontend client/types và test tenant scope cùng trong một thay đổi.
