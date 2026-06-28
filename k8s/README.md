# Cấu Hình Kubernetes (K8s Manifests)

Thư mục `k8s/` chứa toàn bộ cấu hình khai báo (Declarative Manifests) để triển khai các dịch vụ cốt lõi và ứng dụng lên cụm Kubernetes (K3s). Hệ thống sử dụng phương pháp tiếp cận **GitOps** thông qua Argo CD.

## 🚀 Cấu Trúc Thư Mục

Hệ thống được chia thành các nhóm thư mục (thành phần) riêng biệt để dễ quản lý:

### 1. Hạ tầng Cốt lõi (Infrastructure / Stateful)
- **`postgres/`**: Triển khai Cluster PostgreSQL sử dụng **CloudNativePG** operator (đảm bảo tính HA, backup, tự động chia Schema).
- **`redpanda/`**: Triển khai Broker Redpanda (tương thích Kafka) đóng vai trò Event Streaming.
- **`redis/`**: Bộ nhớ đệm (Cache) cho Control Plane và xử lý Session/Task Queue.
- **`storage/`**: Định nghĩa `StorageClass`, `PersistentVolume` và cấu hình tích hợp với ổ cứng EBS thông qua CSI Driver.

### 2. Dịch vụ Ứng dụng (Applications)
- **`apps/`**: Chứa Kustomize cấu hình cho các Microservices tự phát triển:
  - `apps/base/control-plane`: Django Backend.
  - `apps/base/consumer`: Kafka Consumer Worker lưu log.
  - `apps/base/web`: ReactJS Frontend.
  - `apps/production`: Kustomization patch cấu hình dành riêng cho môi trường thật (Ingress, Resource Limits).

### 3. CI/CD & Orchestration (MLOps)
- **`argocd/`**: Cấu hình khởi tạo **Argo CD** (Application và AppProject) để kéo cấu hình từ Git tự động áp dụng vào cluster.
- **`argo-workflows/`**: Bộ điều phối vòng đời MLOps sử dụng **Argo Workflows** & **Argo Events**:
  - `sensor.yaml` / `eventsource.yaml`: Cấu hình Webhook nhận sự kiện từ Control Plane.
  - Các `WorkflowTemplate`: `build-workflowtemplate.yaml`, `deploy-workflowtemplate.yaml`, `delete-workflowtemplate.yaml`, và `evidently-workflowtemplate.yaml`.
- **`harbor/`**: Triển khai **Harbor Private Registry** nội bộ trong cluster để chứa các Docker Image của Model Server được đóng gói sinh ra từ vòng đời MLOps.

### 4. Quản lý Bảo mật & Mạng (Security & Network)
- **`secrets/`**: Triển khai **External Secrets Operator (ESO)** để đồng bộ thông tin nhạy cảm từ AWS Secrets Manager xuống K8s (ClusterSecretStore, ExternalSecret).
- **`security/`**: Định nghĩa các `NetworkPolicy` (giới hạn luồng mạng giữa các Pod) và RBAC.
- **`cloudflare/`**: Triển khai **Cloudflare Tunnel (`cloudflared`)** để kết nối an toàn từ cụm ra Internet mà không cần mở Port Inbound trên AWS Firewall.

### 5. Giám sát & Mở rộng (Observability & Autoscaling)
- **`monitoring/`**: Các tài nguyên dành cho giám sát (Kube-prometheus-stack):
  - `ServiceMonitor` để cạo (scrape) số liệu metrics.
  - **KEDA (Kubernetes Event-driven Autoscaling)**: Cấu hình `ScaledObject` để thực hiện Scale-to-Zero hoặc Scale-Out cho các Pod dựa trên metrics hoặc lượng Kafka event.

## 🛠️ Quy trình Quản lý (GitOps Flow)

Hệ thống hoạt động theo chuẩn **GitOps**:
1. Lập trình viên không chạy lệnh `kubectl apply` thủ công vào máy chủ.
2. Mọi thay đổi đối với hạ tầng (ví dụ: đổi Image Tag, chỉnh sửa RAM/CPU, thay đổi biến môi trường) đều phải được thực hiện trong các tệp YAML thuộc thư mục này.
3. Push commit lên nhánh `main`.
4. **Argo CD** liên tục giám sát kho lưu trữ Git. Khi phát hiện thay đổi, nó sẽ tự động đồng bộ (Sync) và triển khai cấu hình mới lên cụm K3s một cách minh bạch và an toàn.
