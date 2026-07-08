---
name: mlops-paas-training
description: Quy trình điều phối huấn luyện mô hình: TRAINING_BACKEND=local (docker-compose) và TRAINING_BACKEND=kubeflow (K3s). Bao gồm Argo Workflows, Kubeflow PyTorchJob, Karpenter Scale-to-Zero, Redis log streaming.
---

# Kiến trúc Điều phối Huấn luyện Mô hình

> Đọc skill `mlops-paas-architecture` trước để nắm kiến trúc tổng thể.

---

## 1. Biến môi trường quyết định backend

`TRAINING_BACKEND` env var:
- `local` — Local docker-compose: Control Plane chạy training script trực tiếp qua subprocess
- `kubeflow` — Production K3s: Control Plane kích hoạt Argo Workflow → Kubeflow PyTorchJob

> **Không còn sử dụng** `sagemaker` hay `batch`.

---

## 2. Luồng Local Training (`TRAINING_BACKEND=local`)

Control Plane tạo Virtual Environment, `pip install -r requirements.txt`, thiết lập biến môi trường SageMaker-compatible:
- `SM_CHANNEL_TRAIN=/workspace/input/train`
- `SM_MODEL_DIR=/workspace/model`
- `SM_OUTPUT_DIR=/workspace/output`

Chạy entry point script qua `subprocess.run`, sau đó tự động đóng gói `model.tar.gz` và upload S3.

---

## 3. Luồng Kubeflow Training (`TRAINING_BACKEND=kubeflow`)

**Kích hoạt:**
1. Tenant tạo Training Job từ Dashboard (chọn vCPU, memory, GPU, dataset S3 URI, training script)
2. Control Plane POST webhook `/train` tới Argo Events
3. Argo Sensor kích hoạt `training-workflowtemplate`

**WorkflowTemplate (`k8s/argo-workflows/training-workflowtemplate.yaml`):**
- Chọn template `cpu-pytorch-job` hoặc `gpu-pytorch-job` dựa vào `accelerator_type` và `accelerator_count`
- Tạo CRD `PyTorchJob` (`kubeflow.org/v1`) trong namespace `user-jobs`
- `onExit: report-status` — template `report-status` luôn chạy khi workflow xong/fail, POST webhook callback về Control Plane

**Kubeflow PyTorchJob:**
- Master replica 1, chạy container `mlops-paas-training-runner`
- Pull image từ Harbor (imagePullSecret: `harbor-registry-pull-secret`)
- `nodeSelector: mlops-paas/nodepool: training-cpu` hoặc `training-gpu`

---

## 4. Karpenter Autoscaling (Scale-to-Zero)

- Khi PyTorchJob Pod ở trạng thái `Pending` do thiếu node, Karpenter phát hiện và tự động tạo EC2 Instance phù hợp (CPU/GPU)
- Khi Job hoàn tất và Pod bị xóa, Karpenter thực hiện Consolidation → thu hồi EC2 node
- **Chi phí = $0 khi không có job đang chạy**
- NodePool và EC2NodeClass định nghĩa trong `k8s/karpenter/`

---

## 5. Training Runner (`services/training-runner`)

Container `runner.py` chạy trong PyTorchJob:
1. Nhận env vars: `S3_SOURCE_URI`, `S3_TRAINING_DATA_URI`, `S3_OUTPUT_URI`, `ENTRY_POINT`, `MODEL_VERSION`, `TRAINING_JOB_ID`, `TENANT_ID`
2. Tải source code và training data từ S3
3. Cài đặt requirements nếu có
4. Chạy `ENTRY_POINT` script của Tenant
5. Đóng gói `model.tar.gz` → upload về `S3_OUTPUT_URI`
6. Ghi metadata bundle vào `SM_MODEL_DIR/_mlops/` (metrics.json, params.json, training_summary.json)

Training code của Tenant KHÔNG cần import MLflow. Để expose metrics, print dòng `METRIC_JSON:{"accuracy":0.95}`.

---

## 6. Log Streaming qua Redis

- Training Runner và Build step ghi log liên tục vào Redis List:
  - Training: `training_logs:{job_id}`
  - Build: `build_logs:{model_id}`
- React Frontend HTTP Polling mỗi 3 giây: `GET /api/training-jobs/{id}/logs/?offset=<N>`
- Control Plane trả về log mới kèm `next_offset`
- **Không dùng WebSocket** để tránh overhead và lỗi rớt mạng

---

## 7. Hủy Training Job

1. User bấm Cancel trên Dashboard
2. Control Plane POST webhook `/cancel-train` tới Argo Events
3. `training-cancel-workflowtemplate` dùng Argo Resource Template với `action: delete` để xóa CRD `PyTorchJob`
4. Khi CRD bị xóa, Kubeflow Training Operator tự động kill toàn bộ Pod Master/Worker
5. Karpenter phát hiện Pod biến mất → thu hồi node
