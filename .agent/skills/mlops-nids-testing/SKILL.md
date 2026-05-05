---
name: mlops-nids-testing
description: Cách test ứng dụng cục bộ bằng Docker-Compose và kiểm thử production K3s bằng Locust.
---

# MLOps NIDS Testing & Dev Workflow

## 1. Docker Compose Test Cục bộ (`docker-compose.yml`)

Dành cho phát triển local trên Windows/Mac. **Không test trực tiếp vào K3s** trừ khi cần kiểm thử End-to-End.

- PostgreSQL: `DB_HOST_RW` và `DB_HOST_RO` đều trỏ về service `postgres` (không có HA local).
- Race-condition được xử lý bằng `depends_on: condition: service_healthy` với `pg_isready`.
- Service `evidently` set `restart: 'no'` — chạy thủ công bằng: `docker-compose run --rm evidently`
- MLflow local: port `5001` (`http://localhost:5001`)

```bash
docker-compose up --build
docker-compose logs -f api
docker-compose logs -f consumer
```

## 2. API Inference Check (`web/src/test_api.py`)

- Lấy ngẫu nhiên row từ `data/test_data.csv`, gửi POST `/predict`, đo latency.
- KPI: `Latency < 100ms`.
- Đổi target qua biến môi trường:
  - Local: `API_URL=http://localhost:5000`
  - Production: `API_URL=https://api.mlops-nids-nt114.id.vn` (Tự động load từ file `.env`)

## 3. Stress Test & Drift Simulation (`web/src/locustfile.py`)

```bash
# Chạy từ thư mục gốc dự án
locust -f web/src/locustfile.py --host=https://api.mlops-nids-nt114.id.vn
```

Dashboard: `http://localhost:8089` — Khuyến nghị: 50 users, spawn rate 10.

**Kịch bản demo drift:**
- Thay `TEST_CSV_PATH` thành `data/drift_portscan.csv` hoặc `data/drift_bruteforce.csv`.
- Dữ liệu bất thường làm Consumer vượt ngưỡng → kích hoạt Evidently → phát hiện drift → trigger retrain.

## 4. Kiểm thử Pipeline Production (4 Giai đoạn)

| Giai đoạn | Lệnh chính | Kết quả mong đợi |
|---|---|---|
| **0 - Sẵn sàng** | `kubectl get pods -A` | Các namespace `monitoring`, `external-secrets` xanh |
| **1 - Inference** | `python web/src/test_api.py` | Latency < 100ms, Model v1 trả kết quả |
| **2 - Drift** | `kubectl apply -f k8s/evidently-job.yaml` | Evidently Job phân tích Reference vs Production |
| **3 - Retrain** | `aws s3 cp data_manifest.json s3://<your-bucket>/` | S3 Event → Lambda → GitHub Actions |
| **4 - Deploy** | MLflow UI -> Assign "production" alias | Pod mới được rollout tự động |

**Xác nhận DB sau test:**
```bash
kubectl exec -it mlops-nids-postgres-1 -- psql -U postgres -d mlops_nids_db \
  -c "SELECT COUNT(*), label FROM nids_production_data GROUP BY label ORDER BY label;"
```
