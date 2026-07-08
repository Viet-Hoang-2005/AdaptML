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

# Tạo sẵn thư mục models và đặt quyền thực thi cho entrypoint script
RUN mkdir -p /models /app/libs && chmod +x /app/src/entrypoint.sh

# Mở port 5000 để container giao tiếp với bên ngoài
EXPOSE 5000

# Chạy entrypoint script để hỗ trợ Dynamic Runtime Injection
CMD ["/app/src/entrypoint.sh"]