---
name: mlops-nids-architecture
description: Hiểu biết về kiến trúc cấp cao của hệ thống NIDS, bao gồm luồng inference, logging, và deployment pipeline.
---

# MLOps NIDS Architecture

Khi tương tác với hệ thống MLOps NIDS, hãy nhớ các nguyên tắc kiến trúc sau:

## 1. Zero-Downtime Deployment

- Hệ thống KHÔNG build model (file `.pkl`) trực tiếp vào Docker image.
- Mô hình được lưu tập trung tại S3 theo đường dẫn: `s3://mlops-nids-artifacts/mlflow-artifacts/{EXPERIMENT_ID}/{RUN_ID}/artifacts/deployment_exports/`
- Trong K3s, một **Init-Container** (`amazon/aws-cli`) dùng biến môi trường `RUN_ID`, `EXPERIMENT_ID`, `MODEL_VERSION` được inject bởi GitHub Actions (`deploy_from_mlflow.yml`) để kéo file `.pkl` và `label_classes.json` về `emptyDir` volume.
- Khi có model mới, GitHub Actions dùng `kubectl set env` cập nhật biến version rồi `kubectl rollout restart deployment` — Pod mới chạy song song với Pod cũ cho đến khi sẵn sàng.

## 2. API Routing & Load Balancing

- Traffic từ client đi qua **AWS ALB (t3.large Worker Nodes)**, cổng 80.
- Tại Worker Node, **Traefik Ingress** (tích hợp sẵn K3s) điều hướng vào **FastAPI Pods** qua Service `ClusterIP`.
- API chạy 2 replicas để đảm bảo High Availability trong quá trình Rolling Update.

## 3. Streaming & Async Logging (Redpanda)

- FastAPI xử lý inference đồng bộ để trả kết quả < 100ms, sau đó ném message vào **Redpanda** (Kafka-compatible).
- **Consumer (`consumer.py`)** gom dữ liệu thành Batch 500 dòng rồi `INSERT` vào bảng `nids_production_data` trong PostgreSQL.
- Consumer đếm số bản ghi mới — khi vượt ngưỡng, bắn Webhook tới `trigger_drift_check.yml` trên GitHub Actions.

## 4. Event-Driven Retrain (2 Trigger)

- **Trigger 1 — Drift:** Evidently phát hiện drift → Webhook → `retrain_pipeline.yml`
- **Trigger 2 — Data Manifest:** Data Engineer upload `data_manifest.json` lên S3 → **AWS Lambda** (`s3_webhook_trigger.py`) → Webhook → `retrain_pipeline.yml`
- Kaggle Kernel (`train.py`) thực hiện training → log metrics + đăng ký model vào **MLflow Registry** (Stage: Staging).

## 5. HitL Deploy Flow (Dispatch CronJob)

- **Human-in-the-Loop:** Data Scientist đánh giá model trên MLflow UI và gán alias `"production"` thủ công.
- **`dispatch_production_model.py`** chạy như K8s CronJob (mỗi 5 phút), query MLflow Registry tìm model có alias `"production"`, trích xuất `RUN_ID` và `MODEL_VERSION`, rồi gửi `repository_dispatch` tới GitHub Actions kích hoạt `deploy_from_mlflow.yml`.

## 6. Database Architecture (Dual Endpoint)

- Kiến trúc **CloudNativePG** Primary-Standby trên K3s.
- `DB_HOST_RW` (`mlops-nids-postgres-rw`) → Primary, dùng cho INSERT (FastAPI consumer, sync-data-job).
- `DB_HOST_RO` (`mlops-nids-postgres-ro`) → Load-balanced Primary+Standby, dùng cho SELECT (detect_drift.py).
- Bảng chính: `nids_production_data` (log inference), `nids_reference_data` (baseline training data).
- MLflow dùng database `mlflow` riêng biệt trong cùng cluster PostgreSQL.

## 7. Hạ tầng AWS

- **Master Node:** `t3.small` (10.0.1.x) — control-plane only
- **Worker Node 1:** `t3.large` (10.0.2.x) — API, Consumer, MLflow, Postgres PRIMARY
- **Worker Node 2:** `t3.large` (10.0.2.x) — Redpanda, Postgres STANDBY
- **MLflow** chạy trên Worker Node, được expose qua Cloudflare Tunnel → Nginx → ClusterIP Service.
