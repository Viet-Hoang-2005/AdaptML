---
name: mlops-paas-monitoring
description: Giám sát Data Drift bằng Evidently AI qua Argo Workflows, xử lý Schema Drift bằng JSONB, Text Label Mapping, và production data logging qua Redpanda.
---

# Giám sát Data Drift & Production Logging (AI PaaS)

> Đọc skill `mlops-paas-architecture` trước để nắm kiến trúc tổng thể.

---

## 1. Production Data Logging (Redpanda → PostgreSQL)

Luồng log dữ liệu inference không đồng bộ:

```
model-server (FastAPI)
  → Kafka Producer
  → Redpanda topic: mlops_paas_production_data
  → consumer service (batch consume)
  → PostgreSQL (JSONB features + TEXT prediction)
```

**Lý do dùng JSONB cho features**: Mỗi model của mỗi tenant có số lượng features khác nhau (Schema Drift). JSONB cho phép lưu động mà không cần thay đổi schema database.

Cấu trúc bản ghi log:
```json
{
  "tenant_id": "T-123",
  "model_id": "M-ABC",
  "timestamp": "2024-05-11T...",
  "features": { "feature_1": 0.5, "feature_2": 1.2, "...": "..." },
  "prediction": "DDoS"
}
```

`prediction` lưu dạng `TEXT` để hỗ trợ Label Mapping string ("DDoS", "BENIGN") thay vì số nguyên.

---

## 2. Drift Detection Pipeline (Evidently AI + Argo Workflows)

**Kích hoạt:**
- Tenant bấm Manual Run từ Dashboard, hoặc
- Lập lịch định kỳ (cấu hình trong DriftJob)
- Control Plane POST webhook `/drift` tới Argo Events

**evidently-workflowtemplate (`k8s/argo-workflows/evidently-workflowtemplate.yaml`):**
1. Pull Reference Data từ S3 (URL presigned, do Control Plane tạo)
2. Query Production Logs từ PostgreSQL theo `model_id` và `tenant_id`
3. Flatten JSONB `features` → Pandas DataFrame
4. Chạy `DataDriftPreset` Evidently AI
5. Xuất:
   - `report.html` → upload lên S3 (`drift-reports/{job_id}/report.html`)
   - `summary.json` → upload lên S3
6. POST webhook callback về Control Plane với `drift_score`, `html_url`, `summary_url`

**Control Plane:**
- Cập nhật `DriftJob.status` (drifted / no_drift)
- Lưu report URLs vào DB để Tenant xem từ Dashboard

---

## 3. Schema Isolation PostgreSQL

Database `mlops_paas_db` có 2 schema:
- `control_plane` — Django ORM: User, Tenant, ModelAPI, TrainingJob, DriftJob
- `mlflow` — MLflow tự quản lý: Runs, Experiments, Registered Models

**Không còn** schema `fastapi_schema` hay `django_schema` (đặt tên cũ, đã được thay bằng `control_plane`).

---

## 4. Infrastructure Monitoring

- **Prometheus + Grafana**: Giám sát metrics K8s cluster, HTTP request counts, resource usage
- **KEDA ScaledObject**: Scale model-server Pods theo số lượng HTTP requests hoặc Kafka consumer lag
  - Scale-to-Zero khi không có traffic (tiết kiệm tài nguyên)
  - Scale-Out khi traffic tăng cao
- **Alertmanager**: Cảnh báo khi Tenant gây đột biến tài nguyên (CPU > 90% kéo dài)
