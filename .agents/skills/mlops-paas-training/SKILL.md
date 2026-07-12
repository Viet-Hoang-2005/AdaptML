---
name: mlops-paas-training
description: Quy trình training hiện tại dùng TrainingJob snapshot, Celery, Docker local hoặc Argo/Kubeflow production, training-runner, S3 presigned URLs và MLflow. Dùng khi thay đổi training API, runner, workflow, GPU scheduling hoặc artifact metadata.
---

# Training Orchestration

Đọc `apps/training/`, `infrastructure/execution/`, `services/training-runner/src/runner.py` và `k8s/argo-workflows/training-workflowtemplate.yaml` trước khi thay đổi.

## Backend contract

`TRAINING_BACKEND` nhận `docker` hoặc `argo` (kế thừa `EXECUTION_BACKEND` nếu không override):

- `docker`: Celery chạy image `mlops-paas-training-runner` qua Docker SDK.
- `argo`: Celery gửi webhook `/train`; Argo tạo Kubeflow `PyTorchJob` trong namespace `user-jobs`.

Không chạy user training script trực tiếp trong process Control Plane và không dùng giá trị `local` hoặc `kubeflow` trong settings.

## Lifecycle

```text
POST /api/training-jobs/
  -> create_job: snapshot workspace hoặc nhận source/data upload
  -> PostgreSQL TrainingJob + S3 input/output/mlflow URIs
POST /api/training-jobs/{job_uuid}/submit/
  -> transaction.on_commit -> Celery execute_training_job
  -> Docker container | Argo PyTorchJob
  -> internal webhook -> status, TrainingOutput, event
```

Job API có detail, `submit/`, `cancel/`, `events/` và `download/`. Sử dụng UUID `job_uuid` ở mọi route/callback.

## Training runner contract

Runner chỉ nhận presigned HTTP(S) URL cho `S3_SOURCE_URI`, `S3_TRAINING_DATA_URI`, `S3_OUTPUT_URI`. Nó:

1. Download source ZIP và dataset, kiểm tra zip path traversal, giải nén vào `/workspace/source`.
2. Viết/cài `requirements.txt` từ `REQUIREMENTS_TEXT` nếu có.
3. Chạy `ENTRY_POINT` trong subprocess, với `SM_CHANNEL_TRAIN`, `SM_MODEL_DIR`, `SM_OUTPUT_DIR`.
4. Stream stdout/stderr vào Redis nếu cấu hình được cung cấp; đồng thời lưu trong metadata bundle.
5. Đọc `METRIC_JSON:` từ stdout và `metrics.json`/`params.json` trong output.
6. Ghi `_mlops/` gồm manifest, metrics, params, stdout/stderr, warnings và training summary.
7. Log experiment/artifact theo job vào MLflow khi `MLFLOW_TRACKING_URI` được cấu hình.
8. Đóng gói `SM_MODEL_DIR` thành `model.tar.gz` rồi PUT qua presigned URL.

Đừng buộc user script import MLflow. Dùng runner để chuẩn hóa metadata và MLflow integration.

## CPU/GPU production

Argo chọn template CPU/GPU theo `accelerator_type` và `accelerator_count`. GPU workload có node selector/toleration/resource limit để Karpenter cấp node. Karpenter NodePool/EC2NodeClass nằm ở `k8s/karpenter/`.

Đừng hứa tenant quota, max concurrent job, TFJob/XGBoostJob/MPIJob hoặc GPU dashboard: chúng chưa hoàn thiện.

## Cancel và callback

- Cancel API enqueue Celery `cancel_training_job`; backend hủy container hoặc gửi Argo cancel workflow.
- Callback là `POST /internal/webhooks/training-jobs/{job_uuid}/` với shared secret.
- Dùng `Idempotency-Key` cho callback có thể lặp; terminal state không được ghi đè.

## Kiểm tra tối thiểu

```bash
cd services/control-plane
python -m pytest src/apps/training

cd ../training-runner
python -m unittest discover -s src -p 'test_*.py' -v
```

Khi thay đổi artifact metadata, chạy thêm `scripts/validate_training_artifact.py` và cập nhật test metadata của runner.
