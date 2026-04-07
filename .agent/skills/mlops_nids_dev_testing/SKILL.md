---
name: MLOps NIDS Local Dev & Testing
description: Cách test ứng dụng cục bộ bằng Localhost / Docker-Compose và giả lập mạng bằng Locust.
---

# MLOps NIDS Testing & Dev Workflow

Khi Test cục bộ trên Windows hoặc test giả lập Bug, các phương thức được sắp xếp bằng bộ công cụ có sẵn. Đừng test vào Cụm K3s trừ khi buộc phải Build End-to-end.

## 1. Docker Compose Test Cục bộ (`docker-compose.yml`)
- Container Setup đã thiết kế gộp chung PostgreSQL (Fallback gộp biến truyền Load-balancer giả `DB_HOST_RW` và `DB_HOST_RO` về cùng 1 Endpoint `postgres`).
- Chặn lỗi Race-condition ở API Container khởi động nhanh hơn DB bằng tính năng `depends_on: condition: service_healthy` với script check của PostgreSQL `pg_isready`.
- Gồm thêm cả service tên `evidently` Service. Hệ thống này bị set chế độ Restart: 'no'. Để chạy check test ngầm thủ công bằng lệnh gọi Terminal Local -> `docker-compose run --rm evidently`.

## 2. API Inference Loop Check (`web/src/test_api.py`)
- Python script để lấy ngẫu nhiên row data từ mẫu `test_data.csv`, gửi POST API.
- Tự động đo lường độ trễ Latency của API và trả về kết quả Đúng/Sai (`✅ CORRECT` / `❌ WRONG`). Giới hạn KPI cần đạt của hệ thống là `Latency < 100ms`.
- Đổi Target System bằng biến môi trường `API_URL` trỏ vào Cloud K3s (`http://<ALB_Domain>/`) hoặc LocalHost.

## 3. Stress Test & Phá Hoại Bằng Locust (`web/src/locustfile.py`)
- Giả lập hàng nghìn Client gửi 50 - 100 gói net_flow_features mỗi giây vào Inference Route.
- Có chia trọng số Weight giả lập Data Distribution của MML bằng Traffic Payload `BENIGN` cao, Trình thám thính `PortScan` thấp, dồn dập `DDoS` cao. Hoạt động này tạo ra mẫu dữ liệu lạ trong PostgreSQL đủ nhiều (Hơn >100 rows trong vòng phút) để đẩy nhanh thời gian và kích hoạt sự cố Data Drift. Giao diện xem Dashboard thống kê Local của Locust ở cổng `:8089`.
