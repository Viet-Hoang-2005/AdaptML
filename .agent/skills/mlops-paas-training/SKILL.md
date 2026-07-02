---
name: mlops-paas-training
description: Quy trình và kiến trúc điều phối huấn luyện mô hình (Training Job Orchestration) với Argo Workflows, Kubeflow PyTorchJob, Karpenter Autoscaling, và HTTP Polling Redis.
---

# Kiến trúc Điều phối Huấn luyện Mô hình (AI PaaS Training Orchestration)

Hệ thống AI PaaS sử dụng kiến trúc Cloud-Native Event-Driven để điều phối các tác vụ huấn luyện mô hình (Training Jobs), thay thế hoàn toàn các dịch vụ cũ như AWS Batch hay SageMaker.

## 1. Điều phối Pipeline bằng Argo Workflows & Kubeflow PyTorchJob

Quy trình kích hoạt và thực thi một Training Job diễn ra hoàn toàn tự động qua K8s CRDs:
- **Kích hoạt từ Control Plane**: Khi người dùng tạo Training Job trên UI, Control Plane (Django) gửi Webhook payload (`POST /train`) sang **Argo Events** (EventSource & Sensor).
- **Argo Workflow Pipeline**: Sensor kích hoạt một `Workflow` từ `training-workflowtemplate` gồm 3 bước chuẩn:
  1. `prepare-inputs`: Tải mã nguồn và dataset từ S3, chuẩn bị tham số, ghi log thông báo khởi tạo vào Redis.
  2. `run-kubeflow-pytorchjob`: Khởi tạo tài nguyên CRD **`PyTorchJob`** (`kubeflow.org/v1`) trong namespace `user-jobs` để chạy huấn luyện (hỗ trợ phân tán Multi-GPU / Multi-Node).
  3. `report-status`: Sau khi PyTorchJob hoàn tất, bước này gửi Webhook callback (`POST /api/training-jobs/<id>/training-webhook`) kèm `X-Training-Webhook-Secret` về Control Plane để cập nhật trạng thái `completed` hoặc `failed`.

## 2. Cơ chế Hủy Job Đồng bộ (Argo Resource Deletion)

Để đảm bảo dọn dẹp triệt để tài nguyên khi người dùng bấm Hủy (Cancel):
- Control Plane gửi Webhook (`POST /cancel-train`) tới Argo Events.
- Argo kích hoạt `Workflow` từ `training-cancel-workflowtemplate`, sử dụng **Argo Resource Template** với `action: delete` tác động trực tiếp lên CRD `PyTorchJob`.
- Khi CRD bị xóa, Kubeflow Training Operator tự động thu hồi toàn bộ các Pod Master/Worker đang chạy.

## 3. Quản lý Tài nguyên Linh hoạt với Karpenter Autoscaling

- **Dynamic Node Provisioning**: Thay vì duy trì cụm máy chủ cố định tốn kém hoặc phụ thuộc vào AWS Batch, hệ thống sử dụng **Karpenter** K8s Autoscaler.
- Khi một `PyTorchJob` Pod được sinh ra với yêu cầu tài nguyên (`resources.requests` về CPU, RAM hoặc GPU NVIDIA), Karpenter tự động tính toán và khởi tạo đúng loại EC2 Instance / Node chỉ trong vài giây.
- **Scale-in tự động**: Ngay khi Job kết thúc và Pod bị xóa, Karpenter tự động dọn dẹp node (deprovision/consolidation) để tối ưu chi phí hạ tầng về mức 0 khi không có job huấn luyện.

## 4. Giám sát Nhật ký & Trạng thái Thời gian thực (Redis HTTP Polling)

- **Loại bỏ WebSocket**: Hệ thống không sử dụng kết nối WebSocket dai dẳng cho việc xem log để tránh overhead và lỗi rớt mạng.
- **Log Streaming qua Redis**: Các Pod huấn luyện (hoặc bước prepare) đẩy log theo luồng vào **Redis List** theo key `training_logs:{job_id}` (hoặc `build_logs:{id}` đối với build package).
- **Frontend HTTP Polling**: React Frontend sử dụng React Query với cơ chế **HTTP Polling định kỳ mỗi 3 giây** (`GET /api/training-jobs/<id>/logs/?offset=<N>`) khi job đang active (`pending`, `uploading`, `running`). Hệ thống trả về danh sách log mới kèm `next_offset`, giúp UI cuộn log mượt mà như terminal thực thụ.

## 5. Cơ chế Fallback Dev/Demo (Local Training)

- Đối với các môi trường thử nghiệm nhanh hoặc workload nhỏ, hệ thống hỗ trợ `training_backend = "local"`.
- Control Plane tự động tạo Virtual Environment (`pip install -r requirements.txt`), thiết lập biến môi trường tương thích (`SM_CHANNEL_TRAIN`, `SM_MODEL_DIR`), chạy script qua `subprocess.run`, và tự động đóng gói `model.tar.gz` đẩy lên S3.
