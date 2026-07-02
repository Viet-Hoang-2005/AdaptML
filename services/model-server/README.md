# Model Server (Data Plane FastAPI)

Model Server là thành phần thuộc **Data Plane** chuyên phục vụ API dự đoán (Inference) tốc độ cao và phản hồi theo thời gian thực (Real-time). Mỗi mô hình của khách hàng (Tenant) được triển khai sẽ sử dụng mã nguồn này làm cốt lõi (Base Image).

## 🚀 Vai Trò & Chức Năng Chính

- **High-Performance Inference**: Phục vụ các API Endpoint `/predict` cho mô hình học máy.
- **Dynamic Feature Validation**: Tự động nhận diện cấu trúc đặc trưng (features) đầu vào từ metadata của mô hình và kiểm tra hợp lệ dữ liệu.
- **Label Mapping**: Chuyển đổi nhãn (ví dụ: từ output số nguyên `1`, `0` của mô hình thành văn bản `DDoS`, `BENIGN`).
- **Xác thực phi tập trung (Decentralized Auth)**: Đánh giá tính hợp lệ của JWT (RS256) thông qua Public Key lấy từ Control Plane (JWKS Endpoint), loại bỏ hoàn toàn độ trễ khi gọi chéo API.
- **Sản xuất Log sự kiện (Event Producer)**: Lắng nghe kết quả dự đoán và đẩy (produce) log dữ liệu phi cấu trúc vào **Redpanda Kafka** một cách bất đồng bộ để tránh chặn luồng HTTP.

## 🛠️ Luồng Xử Lý Request (Predict)

1. Client gọi HTTP POST `/predict` kèm Header `Authorization: Bearer <API_KEY>`.
2. Middleware kiểm tra chữ ký token bằng bộ nhớ đệm Public Key (JWKS), bóc tách ID mô hình (`model_id`) và Tenant (`tenant_id`). Nếu token không trỏ đúng mô hình đang chạy, từ chối request.
3. Validate cấu trúc payload đầu vào xem có khớp Schema của model hay không.
4. Gửi dữ liệu vào Engine mô hình (ONNX Runtime hoặc MLflow Pyfunc) để sinh dự đoán (Prediction).
5. Map Output thành chuỗi văn bản thông qua Label Mapping logic.
6. Kafka Producer serialize log thành chuẩn JSON và bắn bất đồng bộ tới topic `mlops_paas_production_data` của Redpanda.
7. Trả kết quả JSON về cho Client trong mili-giây.

## 🛠️ Công Nghệ Sử Dụng

- **Framework**: FastAPI (Uvicorn / Gunicorn).
- **Machine Learning**: `onnxruntime`, `mlflow`.
- **Event Streaming**: `confluent-kafka` (Producer).
- **Authentication**: `python-jose` (RS256).
