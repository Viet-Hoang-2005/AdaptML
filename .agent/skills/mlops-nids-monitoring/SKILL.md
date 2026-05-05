---
name: mlops-nids-monitoring
description: Phương pháp phát hiện Data Drift bằng Evidently AI và Giám sát hạ tầng bằng Prometheus Stack trên K3s.
---

# Data Drift Monitoring bằng Evidently AI

## 1. Kiến trúc Tổng thể

Script `monitoring/detect_drift.py` được đóng gói trong Docker và chạy dưới dạng **K8s Job** (không phải CronJob). Job được kích hoạt theo cơ chế **Event-Driven**:

```
Consumer (nids_production_data vượt ngưỡng)
    → Webhook → trigger_drift_check.yml (GitHub Actions)
    → kubectl replace --force evidently-job.yaml
    → detect_drift.py chạy và phân tích
```

## 2. Nguồn Dữ liệu So Sánh

- **Reference Data (`nids_reference_data`):** Dữ liệu training ban đầu, được nạp vào PostgreSQL bởi `sync-data-job.yaml` (GitHub Actions `deploy_from_mlflow.yml` kích hoạt sau mỗi lần deploy model mới).
- **Production Data (`nids_production_data`):** Nhật ký inference trong 24 giờ qua từ FastAPI, ghi bởi Consumer.
- **Tối ưu hóa Big Data:** Khi bản ghi vượt 100,000, script dùng `TABLESAMPLE SYSTEM` trực tiếp trong PostgreSQL để sampling — tiết kiệm RAM mà vẫn đảm bảo tính đại diện.

## 3. Công nghệ & Ngưỡng (Evidently AI v0.4.15)

- **DataDriftPreset:** KS-test cho feature liên tục, Chi-Square cho feature phân loại.
- **Ngưỡng cảnh báo:** `0.6` (60% features bị drift).
- **Đọc từ:** `DB_HOST_RO` (`mlops-nids-postgres-ro`) — endpoint Read-Only để không ảnh hưởng Primary.

## 4. Luồng Webhook sau khi phát hiện Drift

### 4.1 Bắn cảnh báo Slack
- Script gọi `drift_alert.yml` (GitHub Actions) → Gửi Slack message với thống kê chi tiết.

### 4.2 Kích hoạt Retraining
- Script gửi `repository_dispatch` với `event_type: data_drift_detected` → kích hoạt `retrain_pipeline.yml`.
- **Lưu ý:** Retraining từ drift vẫn dùng `data_manifest.json` hiện tại trên S3 để xác định dataset. Data Engineer có thể upload manifest mới trước khi drift để train với data tốt hơn.

## 5. Phân biệt 2 Webhook Endpoint

| Webhook | event_type | Kích hoạt workflow |
|---|---|---|
| Consumer đếm ngưỡng | `trigger_drift_check` | `trigger_drift_check.yml` (chạy Evidently Job) |
| Evidently phát hiện drift | `data_drift_detected` | `drift_alert.yml` + `retrain_pipeline.yml` |

## 6. Infrastructure Monitoring (Prometheus Stack)

Hệ thống sử dụng **Kube-Prometheus-Stack** để giám sát tài nguyên và hiệu năng.

### 6.1 ServiceMonitors & Exporters
Các thành phần được giám sát qua Custom Resource `ServiceMonitor`:
- **API Monitor**: Quét metrics từ FastAPI (qua thư viện `prometheus-fastapi-instrumentator`).
- **Postgres Monitor**: Quét metrics từ `postgres-exporter` (kết nối tới PostgreSQL HA).
- **Redpanda Monitor**: Quét trực tiếp port admin `9644` của Redpanda.

### 6.2 Visualization & Alerting
- **Grafana**: Hiển thị Dashboard. Được expose bảo mật qua Cloudflare Tunnel.
- **PrometheusRules**: Định nghĩa các luật cảnh báo (`grafana-alertrules.yaml`) như: `HighCpuUsage`, `ApiLatencyHigh`, `PostgresConnectionCritical`.
- **Alertmanager**: Gửi cảnh báo tới các kênh như Slack khi các luật trên bị vi phạm.
