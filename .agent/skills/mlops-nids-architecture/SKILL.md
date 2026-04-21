---
name: mlops-nids-architecture
description: Hiểu biết về kiến trúc cấp cao của hệ thống NIDS, bao gồm luồng inference và logging.
---

# MLOps NIDS Architecture

Khi tương tác với hệ thống MLOps NIDS, hãy nhớ các nguyên tắc kiến trúc sau:

## 1. Zero-Downtime Deployment

- Hệ thống KHÔNG build model (file `.pkl`) trực tiếp vào Docker image.
- Model và cấu hình nhãn (`.pkl` và `.json`) được lưu trữ tại AWS S3 (`mlops-nids-artifacts`).
- Trong K3s, một **Init-Container** (`amazon/aws-cli`) sẽ kéo model từ bucket S3 về một `emptyDir` mount chung. App container (FastAPI) đọc model từ `emptyDir` này. Khi có model mới, GitHub Actions dùng cờ lệnh `kubectl rollout restart deployment` để K3s chạy lại quá trình Init mà không tắt ngay Pod cũ, đảm bảo downtime bằng 0.

## 2. API Routing & Load Balancing

- Traffic từ client sẽ đi qua **AWS Application Load Balancer (ALB)**, được chuyển tiếp thẳng vào **cổng 80** của các K3s Worker Nodes.
- Tại Worker Node, bộ định tuyến nội bộ **Traefik Ingress** sẽ hứng traffic từ cổng 80 và điều hướng vào **FastAPI Pods** thông qua Service kiểu `ClusterIP`. 
- Traefik chịu trách nhiệm Load Balancing nội bộ mạng cluster tới các Replicas của API.

## 3. Streaming & Async Logging (Redpanda)

- FastAPI xử lý yêu cầu suy diễn một cách đồng bộ để phản hồi cho Client dưới ngưỡng 100ms.
- Toàn bộ dữ liệu được ném vào **Redpanda (Message Broker)** để chịu tải cao.
- **Consumer Script (`consumer.py`)** chạy ngầm, gom dữ liệu thành các Batch (500 dòng) rồi mới `INSERT` vào DB. Nó cũng đóng vai trò theo dõi số lượng bản ghi để bắn Webhook kích hoạt Data Drift Check.

## 3.5. Event-Driven S3 Lambda

- Khi Data Engineer cập nhật `data_manifest.json` lên AWS S3, **S3 Event Notification** sẽ kích hoạt **AWS Lambda**.
- Lambda này sẽ bắn Webhook tới GitHub Actions để tự động kích hoạt luồng Retrain ngay lập tức.

## 4. Database Architecture (Dual Endpoint)

- Hệ thống áp dụng kiến trúc Primary-Standby thông qua **CloudNativePG** Operator của Kubernetes.
- Đầu cực `DB_HOST_RW` (`nids-postgres-rw`) dành cho các logic THÊM, SỬA, XÓA (vd: FastAPI lưu log `db_manager.py`, script `update_reference_data.py` chèn baseline mới).
- Đầu cực `DB_HOST_RO` (`nids-postgres-ro`) được tối ưu cho việc ĐỌC, tự động chia sẻ traffic giữa Primary và Standby (ví dụ logic: `detect_drift.py` query lịch sử 24h).
