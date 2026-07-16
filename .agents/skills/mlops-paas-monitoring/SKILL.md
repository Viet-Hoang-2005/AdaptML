---
name: mlops-paas-monitoring
description: "Observability và data drift hiện tại: model-server gateway metrics, Redpanda production events, consumer, Evidently DriftRun, Prometheus và Control Plane observability API. Dùng khi thay đổi monitoring, event logging hoặc drift."
---

# Monitoring, Production Data và Drift

Đọc `services/model-server/src/`, `services/consumer/src/`, `apps/drift/`, `apps/observability/` và `k8s/monitoring/` trước khi thay đổi. Phân biệt contract hiện tại với roadmap.

## Production inference events

```text
model-server gateway
  -> Redpanda topic mlops_paas_production_data
  -> consumer
  -> PostgreSQL production data
```

Gateway emit `tenant_id`, `project_id`, `model_version_id`, timestamp, input features và prediction sau inference. Consumer chịu trách nhiệm persist/batch processing; runtime contract luôn dùng định danh project và version tách biệt.

Gateway expose Prometheus metric cho prediction count, status và latency theo tenant/project/model version. Control Plane expose:

- `/health/live`, `/health/ready`, `/health/metrics`
- `/api/observability/models/{project_uuid}/`

Model observability API tổng hợp traffic, resource và health từ Prometheus/endpoint metadata. Dùng selector tenant-scoped trước khi query project.

## Drift contract

1. `DriftMonitor` liên kết immutable model version với reference `WorkspaceAsset`.
2. `POST /api/drift-monitors/{monitor_uuid}/runs/` tạo `DriftRun` và enqueue Celery.
3. Docker/Argo Evidently worker đọc reference qua presigned S3 URL và production data từ PostgreSQL.
4. Worker ghi `report.html`, `report.json`, `summary.json` vào prefix của run.
5. Callback `/internal/webhooks/drift-runs/{run_uuid}/` ghi summary, drift score và `has_drift`.

Chỉ gọi một run là completed khi callback đã qua shared-secret validation. Không dùng report Redis/cache làm nguồn sự thật.

## Giới hạn hiện tại

- Có data drift và data-quality report; prediction drift chuẩn hóa chưa hoàn chỉnh.
- Chưa có ground-truth feedback API hoặc accuracy/precision/recall/F1 theo thời gian.
- Frontend chưa có chart time-series observability đầy đủ.
- GPU metrics cần DCGM exporter, hiện không phải contract.
- KEDA chỉ scale consumer theo Kafka lag, không scale model worker endpoint về zero.

Khi thêm một metric/drift capability, cập nhật gateway labels, Prometheus query, API serializer, frontend type/view và alert rule cùng nhau. Tránh label cardinality không giới hạn như raw request ID, payload hoặc user input.
