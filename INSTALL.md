# Hướng dẫn Cài đặt (Installation Guide)

Tài liệu này cung cấp hướng dẫn chi tiết để thiết lập và chạy Hệ thống MLOps Phát hiện Xâm nhập Mạng (NIDS).

---

## Yêu cầu Hệ thống (Prerequisites)

| Thành phần | Tối thiểu           | Khuyến nghị   |
| ---------- | ------------------- | ------------- |
| Python     | 3.9+                | 3.12          |
| RAM        | 4 GB                | 8 GB          |
| Lưu trữ    | 10 GB               | 20 GB         |
| HĐH        | Windows 10+ / Linux | Ubuntu 22.04+ |

### Phần mềm Bắt buộc

- [Python 3.12](https://www.python.org/downloads/)
- [Git](https://git-scm.com/downloads)
- [Docker & Docker Compose](https://www.docker.com/products/docker-desktop/)
- [K3s](https://k3s.io/)

---

## Bước 1: Clone Repository

```bash
git clone https://github.com/Viet-Hoang-2005/mlops-nids-system.git
cd mlops-nids-system
```

---

## Bước 2: Khởi tạo Virtual Environment & Cài đặt Thư viện

Tạo môi trường Python ảo tách biệt:

**Linux/macOS:**

```bash
python3 -m venv venv
source venv/bin/activate
```

**Windows:**

```cmd
python -m venv venv
venv\Scripts\activate
```

Sau khi kích hoạt, tiến hành cài đặt các gói phụ thuộc (cho API và cho hệ thống giám sát):

```bash
pip install -r api/requirements.txt
pip install -r monitoring/requirements.txt
pip install locust # Khuyến nghị cài thêm để chạy giả lập tấn công
```

---

## Bước 3: Cấu hình Biến môi trường (.env)

Hệ thống cung cấp sẵn file `.env.example`. Hãy copy thành `.env` ở thư mục gốc:

```bash
cp .env.example .env
```

**Nội dung cơ bản:**

```ini
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=nids_db
DB_PORT=5432
DB_HOST=localhost

# Cấu hình cho Evidently AI / Github Action
GITHUB_REPO=Viet-Hoang-2005/mlops-nids-system
GITHUB_TOKEN=your_personal_access_token_here
DRIFT_THRESHOLD=0.5
```

---

## Bước 4: Môi trường Chạy Thử nghiệm (Docker Compose)

Đây là cách nhanh nhất để khởi chạy PostgreSQL và FastAPI Container nội bộ (Local).

```bash
# Xây dựng và khởi chạy ở chế độ ngầm (Background)
docker-compose up --build -d

# Xem log hoạt động của API
docker-compose logs -f api

# Dừng hệ thống
docker-compose down
```

Ứng dụng API sẽ trực tiếp khả dụng tại: `http://localhost:5000/predict`

---

## Bước 5: Triển khai K3s (Production Setup)

Sử dụng môi trường K3s siêu nhẹ (Lightweight Kubernetes) với các Manifest files được cung cấp.

### 5.1. Cài đặt K3s (Linux)

```bash
curl -sfL https://get.k3s.io | sh -
```

### 5.2. Áp dụng Manifests

Sau khi cluster sẵn sàng, áp dụng các tệp cấu hình triển khai để sinh ra Pod:

```bash
# 1. Khởi động PostgreSQL DB
kubectl apply -f k8s/postgres.yaml

# 2. Khởi động API (có kẹp Init container kéo tệp S3)
kubectl apply -f k8s/api-deployment.yaml

# 3. Kích hoạt CronJob giám sát Data Drift qua đêm
kubectl apply -f k8s/evidently-cronjob.yaml
```

Kiểm tra trạng thái các Pod xem đã "Running" chưa:

```bash
kubectl get pods
```

---

## Bước 6: Kiểm thử (Troubleshooting / Testing)

### Load Testing sinh tập Tấn công (DDoS / PortScan):

Dùng công cụ mã nguồn mở **Locust** để tạo ra lượng traffic mô phỏng gói tin độc hại:

```bash
locust -f load_testing/locustfile.py --host=http://localhost:5000
```

_(Mở trình duyệt ở `http://localhost:8089` để ấn Start Swarming)_

### Xác minh cơ chế Webhook (Data Drift Alert):

Kiểm tra xem hàm tự tính Drift có chạy thành công không bằng dòng lệnh chay:

```bash
python monitoring/detect_drift.py
```

Nếu logs hiển thị `[+] Webhook gọi MLOps Retraining THÀNH CÔNG.` thì tức là CI/CD đã thông luồng.


### Xóa dữ liệu trong PostgreSQL:

```bash
docker exec -it mlops_nids_postgres  psql -U admin -d mlops_nids_db
drop cascades to table nids_production_data
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO admin;
GRANT ALL ON SCHEMA public TO public;
\q
```
---

## Xử lý Sự cố Cơ bản

- **Cổng 5000 / 5432 bị chiếm**: Đảm bảo tắt Postgresql đang chạy ngầm trên máy chủ trước khi chạy `docker-compose`.
- **Lỗi không kết nối DB (`psycopg2.OperationalError`)**: Kiểm tra lại file `.env` mục `DB_HOST`. Khi chạy localhost không qua Docker, để là `localhost`. Khi chạy Pod K3s, nó sẽ dùng DNS Service của Kĩ sư cấu hình là `postgres-service`.
