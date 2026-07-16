---
name: mlops-paas-lifecycle
description: Vòng đời hiện tại của model project, training output, registry version, build, deployment, endpoint và drift run. Dùng khi thay đổi API hoặc workflow build/deploy/register/rollback/drift.
---

# Vòng đời Model

Đọc `docs/control-plane/api-catalog.md`, `docs/control-plane/webhooks.md`, các service trong `apps/`, và `infrastructure/execution/` trước khi thay đổi luồng.

## 1. Project và workspace

1. Tạo project qua `/api/models/`.
2. Upload source/data vào `/api/models/{project_uuid}/workspace/{code|data}/files/`.
3. Cập nhật requirements qua `/api/models/{project_uuid}/requirements/`.

`ModelProject` và `WorkspaceAsset` là mutable. File sống dưới `users/{tenant}/models/{project_uuid}/code|data/`; không đưa editable workspace xuống version.

## 2. Training -> registry version

1. Tạo draft tại `/api/training-jobs/`; service snapshot source/data và gán S3 URI theo job UUID.
2. Submit tại `/api/training-jobs/{job_uuid}/submit/`.
3. Celery chạy backend đã chọn; training runner upload `model.tar.gz`, metadata bundle và MLflow artifacts.
4. Callback nội bộ cập nhật job/output; đọc trạng thái qua job detail, `/events/`, `/logs/`; tải hoặc xóa output qua `/download/`, `/outputs/`.
5. `POST /api/training-jobs/{job_uuid}/build/` tạo/reuse Build từ immutable output của đúng job.
6. Build callback thành công cấp version kế tiếp, tạo `ModelVersion`, image artifact và import `_mlops` metrics/params/insights.

Một TrainingJob tạo tối đa một version thành công. Build failed/cancelled không cấp version và có thể retry. `ModelVersion` là immutable; không còn API POST trực tiếp để tạo version.

## 3. Build và deployment

1. Upload Model tạo build multipart từ artifact; Training tạo build qua `/{job_uuid}/build/`.
2. Celery gọi `DockerBuildBackend` hoặc `ArgoBuildBackend`.
3. Build callback thành công atomically tạo version nếu Build chưa có version, rồi đặt image URI/digest và trạng thái `ready`.
4. Tạo deployment tại `/api/deployments/` chỉ với build thành công.
5. Backend tạo worker runtime; `Endpoint` lưu public URL, internal URL, runtime name và health.
6. Dừng deployment tại `/api/deployments/{deployment_uuid}/stop/`; đọc endpoint/log tại `/api/endpoints/` và `/{endpoint_uuid}/logs/`.

Production workflow chỉ tạo `Deployment` và `Service` cho worker. Không thêm Traefik `Middleware` hoặc `IngressRoute` cho model riêng lẻ.

## 4. Inference và alias

```text
client
  -> /{tenant}/models/{project_uuid}/{version_uuid}/predict
  -> Traefik rewrite
  -> model-server gateway
  -> healthy worker
```

Gateway chấp nhận public access, `X-API-Key` scope theo project, hoặc Bearer JWT đúng tenant. Alias được quản lý tại `/api/registry/models/{project_uuid}/aliases/`; alias prediction đi qua Control Plane và chỉ chọn endpoint healthy.

## 5. Drift

1. Tạo `DriftMonitor` tại `/api/drift-monitors/` với version và reference asset cùng tenant.
2. Tạo run bằng `POST /api/drift-monitors/{monitor_uuid}/runs/`.
3. Celery chạy Evidently qua Docker/Argo; worker đọc reference S3 và production data PostgreSQL.
4. Callback `/internal/webhooks/drift-runs/{run_uuid}/` cập nhật summary, score, flag và report URI.

Report HTML/JSON/summary thuộc prefix `drift/{monitor_uuid}/{run_uuid}/`. Data drift có sẵn; prediction drift, ground-truth feedback và quality metrics chưa phải contract production.

## Invariant cần bảo toàn

- Mọi relation phải thuộc cùng tenant/project trước khi tạo job, version, build, deployment hoặc monitor.
- Callback dùng `X-Control-Plane-Secret` hoặc Bearer secret và idempotency key khi workflow có thể gửi lại.
- Không dựa vào Redis để suy ra trạng thái; dùng row state/event trong PostgreSQL.
- Khi thêm transition trạng thái, sửa model, service, serializer, webhook, UI types và tests cùng nhau.
