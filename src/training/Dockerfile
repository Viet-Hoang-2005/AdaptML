# Sử dụng image nền tảng Python slim
FROM python:3.10-slim

# Thiết lập thư mục làm việc trong container
WORKDIR /app

# Cài đặt các công cụ biên dịch lõi
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements và cài đặt thư viện python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy mã nguồn huấn luyện vào container
COPY train.py .

# Thiết lập các biến môi trường mặc định
ENV DATA_DIR="/opt/ml/input/data/training"
ENV MODEL_DIR="/opt/ml/model"

# Lệnh thực thi khi container khởi động
CMD ["python", "train.py"]