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

## 3. Low-Latency Inference & Async Logging

- FastAPI xử lý yêu cầu suy diễn một cách đồng bộ để phản hồi cho Client dưới ngưỡng 100ms.
- Toàn bộ features đầu vào (payload) và kết quả suy diễn (prediction, confidence) được ném vào **BackgroundTasks** để chèn (INSERT) vào DB một cách bất đồng bộ. Bảng PostgresQL `nids_production_data` lưu trữ các dữ liệu này.

## 4. Database Architecture (Dual Endpoint)

- Hệ thống áp dụng kiến trúc Primary-Standby thông qua **CloudNativePG** Operator của Kubernetes.
- Đầu cực `DB_HOST_RW` (`nids-postgres-rw`) dành cho các logic THÊM, SỬA, XÓA (vd: FastAPI lưu log `db_manager.py`, script `update_reference_data.py` chèn baseline mới).
- Đầu cực `DB_HOST_RO` (`nids-postgres-ro`) được tối ưu cho việc ĐỌC, tự động chia sẻ traffic giữa Primary và Standby (ví dụ logic: `detect_drift.py` query lịch sử 24h).
