# Kafka Consumer (Data Ingestion Worker)

Consumer là một Background Worker (tiến trình chạy ngầm) đóng vai trò trung gian giữa Event Stream và Cơ sở dữ liệu dài hạn. Nó hoạt động liên tục trong Kubernetes Cluster như một Deployment đơn lẻ (Replica=1).

## 🚀 Vai Trò & Chức Năng Chính

- **Lắng nghe sự kiện (Event Polling)**: Liên tục lấy dữ liệu log dự đoán sinh ra từ nhiều Model Server (Data Plane) thông qua topic `mlops_paas_production_data` của Redpanda Kafka.
- **Micro-Batching**: Không thực hiện `INSERT` cho từng dòng log nhỏ lẻ. Consumer gom (batch) nhiều tin nhắn Kafka vào bộ đệm và chỉ xả (flush) vào PostgreSQL khi đạt một trong hai điều kiện:
  - Vượt quá số lượng kích thước tối đa của một lô (Batch Size Limit, vd: 100).
  - Vượt quá thời gian chờ rảnh (Idle Timeout, vd: 5 giây).
- **Schema Validation & Mapping**: Phân tích JSON Payload của Kafka để trích xuất `features` thành định dạng `JSONB` của PostgreSQL và `prediction` thành kiểu chuỗi (TEXT) hỗ trợ Data Drift Analytics sau này.

## 🛠️ Xử lý Độ tin cậy (Reliability)

- Trạng thái con trỏ Kafka (Offset Commit) chỉ được lưu (commit) *SAU KHI* dữ liệu đã được `INSERT` thành công vào CSDL Postgres. Điều này bảo vệ hệ thống khỏi mất mát dữ liệu (Data Loss) khi Consumer bị sập (At-least-once delivery).
- Trong trường hợp cấu trúc log sai dạng hoặc chèn lỗi do PostgreSQL, Consumer ghi log báo lỗi cụ thể và thực hiện rollback tiến trình để không làm kẹt hàng đợi (Dead-letter Queue handling nội bộ).

## 🛠️ Công Nghệ Sử Dụng

- **Python**.
- **Message Broker**: Redpanda (Tương thích chuẩn giao thức Kafka), `confluent-kafka` thư viện C++ hiệu năng cao.
- **Database ORM/Driver**: `psycopg2`, `SQLAlchemy` (dùng chung với `pandas.to_sql` để thao tác chèn hiệu suất cao).
