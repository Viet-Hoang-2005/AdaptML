---
name: mlops-paas-testing
description: Quy trình kiểm thử hiện tại của MLOps PaaS cho Django Control Plane, training runner, frontend, tenant isolation, callback idempotency và manifest. Dùng khi thêm tính năng, sửa bug hoặc xác minh thay đổi cross-service.
---

# Testing MLOps PaaS

Chọn kiểm tra nhỏ nhất bao phủ thay đổi, sau đó chạy suite liên quan. Không khẳng định E2E production nếu chưa chạy trên cluster.

## Quality gates hiện có

```bash
# Django Control Plane
cd services/control-plane
python -m ruff check .
python -m pytest
python manage.py check --settings=config.settings.test
python manage.py makemigrations --check --dry-run --settings=config.settings.test

# Storage path tests không nằm trong testpaths mặc định
python -m pytest src/infrastructure/storage/tests

# Training runner
cd ../training-runner
python -m unittest discover -s src -p 'test_*.py' -v

# Frontend
cd ../../web
pnpm lint
pnpm build
```

## Test theo boundary

| Thay đổi | Phải test |
| --- | --- |
| Domain API/service | tenant selector, serializer validation, UUID route, state transition |
| Webhook | missing secret, duplicate/idempotency, terminal callback, retry/failure |
| Execution backend | correct adapter selection từ `docker|argo`, payload/env và cancel |
| S3 path/artifact | tenant/project/job/version prefix, traversal reject, presigned URL contract |
| Gateway/auth | RS256 JWT, tenant mismatch, API-key project scope, public access |
| Training runner | source URL validation, ZIP safety, failure logs, metadata bundle, MLflow artifact URI |
| K8s/IaC | Kustomize build, Kubeconform và Terraform fmt/validate |

## Invariant quan trọng

- Mọi public ID là UUID; integer và route legacy phải bị từ chối.
- Tenant A không đọc, mutate hay generate API key cho resource tenant B.
- Callback chỉ chấp nhận secret hợp lệ và phải an toàn khi replay.
- Worker failure phải chuyển đúng status/error/event, không bỏ qua output metadata.
- API endpoint không được bypass service/selector để gọi infrastructure.

## E2E local có chủ đích

Sau khi `docker compose up --build` và frontend `pnpm dev` chạy, kiểm tra:

1. `/health/ready` báo PostgreSQL/Redis healthy.
2. Tạo project, upload workspace, tạo/submit training job và đọc events.
3. Register version, tạo build/deployment và gọi inference qua gateway path UUID.
4. Tạo DriftMonitor/run, xác minh callback và S3 report.

Chỉ chạy Docker/Kubernetes integration khi thay đổi thật sự chạm adapter, image hoặc manifest. Ghi rõ phần nào dùng mock/unit test, local Docker và production cluster.
