---
name: mlops-nids-lifecycle
description: Vòng đời của mô hình Machine Learning, từ Retraining, Human-in-the-Loop, cho đến khi được tự động triển khai qua Dispatch CronJob.
---

# Luồng Vòng Đời Mô Hình (Continuous Training & Deployment)

## 1. Nguồn Sự Thật (Single Source of Truth)

File `data_manifest.json` lưu trên S3 (`s3://mlops-nids-artifacts/data_manifest.json`) chứa:
- `target_csv`: Tên file dữ liệu training hiện tại (vd: `train_2_classes.csv`).
- `model_version`: Phiên bản model đang active (vd: `v1`).
- `num_classes`: Số nhãn phân loại.

Khi Data Engineer upload file này lên S3, **AWS Lambda** (`s3_webhook_trigger.py`) tự động phát hiện sự kiện `ObjectCreated` và bắn Webhook kích hoạt `retrain_pipeline.yml`.

## 2. Retraining Pipeline (`retrain_pipeline.yml`)

Quy trình:
1. **Trigger** từ Webhook (Evidently drift detected hoặc Lambda data_manifest_updated).
2. Tải `data_manifest.json` từ S3 để lấy `target_csv`.
3. Gọi Kaggle API push `kaggle/train.py` — training chạy trên Kaggle GPU.
4. `train.py` tự động log metrics + artifacts vào **MLflow Server** và đăng ký model với Stage `Staging`.
5. Model artifact (`.pkl` + `label_classes.json`) được upload lên S3 tại: `mlflow-artifacts/{EXPERIMENT_ID}/{RUN_ID}/artifacts/deployment_exports/`

## 3. Human-in-the-Loop (HitL) — Quality Gate

- Không có script tự động promote model. Data Scientist truy cập **MLflow UI** (`https://mlflow.mlops-nids-nt114.id.vn`).
- Đánh giá metrics (F1 > 99%), so sánh với version cũ, rồi **gán alias `"production"`** cho version muốn deploy.
- Đây là điểm kiểm soát (decoupling) hoàn toàn giữa Training và Deployment.

## 4. Dispatch CronJob (`dispatch-cronjob.yaml`)

- `dispatch_production_model.py` chạy như **K8s CronJob mỗi 5 phút**.
- Query MLflow Registry: `client.get_model_version_by_alias("NIDS-XGBoost", "production")`.
- Nếu tìm thấy model Production mới chưa deploy, gửi `repository_dispatch` tới GitHub với:
  - `event_type: mlflow_production_selected`
  - `client_payload: {run_id, experiment_id, model_version}`

## 5. Deploy Pipeline (`deploy_from_mlflow.yml`)

1. **Trigger**: Nhận lệnh điều phối từ CronJob hoặc Data Scientist kích hoạt thủ công.
2. **Security**: Sử dụng **GitHub OIDC** để xác thực với AWS mà không cần Access Key. GitHub Action sẽ `AssumeRole` tới `mlops-github-actions-role` (ARN được cấu hình trong GitHub Variables).
3. **Secret Retrieval**: Kéo các thông tin cấu hình (như Slack Webhook, DockerHub) từ **AWS Secrets Manager** (`mlops/github-actions-secrets`).
4. **Update**: `kubectl set env deployment/mlops-nids-api RUN_ID=... EXPERIMENT_ID=... MODEL_VERSION=...`
5. **Rollout**: `kubectl rollout restart deployment/mlops-nids-api` — Thực hiện chiến lược Rolling Update Zero-Downtime.
5. Init Container kéo model mới từ S3 về `emptyDir`.
6. Trigger `sync-data-job.yaml` để đồng bộ `nids_reference_data` mới vào PostgreSQL.

## 6. MLflow Model Registry (Stage Management)

| Stage          | Ai thực hiện             | Ý nghĩa                                      |
| -------------- | ------------------------ | -------------------------------------------- |
| `Staging`      | `train.py` tự động       | Model vừa được đăng ký, chờ review           |
| `Production`   | Data Scientist (HitL)    | Được gán alias `"production"`, sẵn sàng deploy|
| `Archived`     | Tự động khi deploy mới   | Model cũ, giữ lại để rollback nếu cần        |
