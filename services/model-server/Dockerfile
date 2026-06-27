FROM python:3.10-slim

# Thiết lập thư mục làm việc trong container
WORKDIR /app

# Cài đặt các system dependencies cơ bản (cần thiết cho psycopg2 và opencv)
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy file requirements
COPY requirements.txt .

# Cài đặt các thư viện Python (tắt cache để giảm dung lượng image)
RUN pip install --no-cache-dir -r requirements.txt

# Copy toàn bộ mã nguồn và thư mục models vào container
COPY . .

# Tạo sẵn thư mục models (sẽ mount data thật vào đây qua docker-compose)
RUN mkdir -p /models

# Mở port 5000 để container giao tiếp với bên ngoài
EXPOSE 5000

# Chạy API bằng Uvicorn (Production Server cho FastAPI)
CMD ["uvicorn", "src.index:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "2"]