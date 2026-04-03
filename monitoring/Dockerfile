# Sử dụng Python 3.10+ để hỗ trợ cú pháp type hint lowercase tuple[...] trong detect_drift.py
FROM python:3.10-slim

# Ngăn python ghi log .pyc và bật stdout ngay lập tức
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Tạo thư mục chạy trong container
WORKDIR /app

# Cài đặt các thư viện hệ thống cần thiết cho thư viện psycopg2 (PostgreSQL)
RUN apt-get update \
    && apt-get install -y gcc libpq-dev \
    && apt-get clean

# Copy dependencies và cài đặt
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy toàn bộ code vào image
# COPY . . đặt file vào /app/ để lệnh python có thể tìm thấy detect_drift.py tại /app/detect_drift.py
COPY . .

# Chạy detect_drift.py từ WORKDIR /app
CMD ["python", "/app/detect_drift.py"]
