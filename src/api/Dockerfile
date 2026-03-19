# Sử dụng base image Python bản slim (nhẹ và bảo mật hơn)
FROM python:3.10-slim

# Thiết lập thư mục làm việc trong container
WORKDIR /app

# Cài đặt các system dependencies cơ bản (cần thiết cho skimage/xgboost)
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy file requirements
COPY requirements.txt .

# Cài đặt các thư viện Python (tắt cache để giảm dung lượng image)
RUN pip install --no-cache-dir -r requirements.txt

# Copy toàn bộ mã nguồn và thư mục models vào container
COPY . .

# Mở port 5000 để container giao tiếp với bên ngoài
EXPOSE 5000

# Chạy API bằng Gunicorn (Production Server) thay vì Flask development server
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "120", "api:app"]