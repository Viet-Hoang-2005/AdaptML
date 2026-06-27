# Sử dụng Python 3.10+ để hỗ trợ cú pháp type hint lowercase tuple[...] trong detect_drift.py
FROM python:3.10-slim

# Ngăn python ghi log .pyc và bật stdout ngay lập tức
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Tạo thư mục chạy trong container
WORKDIR /app

# Cài đặt g++ và python3-dev để có thể compile các thư viện ML của Evidently
RUN apt-get update \
    && apt-get install -y gcc g++ python3-dev libpq-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy dependencies và cài đặt
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# COPY . . đặt file vào /app/ để lệnh python có thể tìm thấy detect_drift.py tại /app/detect_drift.py
COPY . .

# Chạy detect_drift.py từ WORKDIR /app
CMD ["python", "/app/detect_drift.py"]