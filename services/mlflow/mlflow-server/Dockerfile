# Dockerfile cho MLflow Tracking Server
# Cài sẵn tất cả thư viện trong image để tránh pip install khi container khởi động
# -> Giảm đáng kể RAM usage so với cách pip install tại runtime

FROM ghcr.io/mlflow/mlflow:v3.11.1

WORKDIR /app

# Copy requirements.txt vào container
COPY requirements.txt .

# Cài thêm các thư viện cần thiết cho MLflow Server
RUN pip install --no-cache-dir -r requirements.txt

# Expose cổng MLflow Server
EXPOSE 5000
