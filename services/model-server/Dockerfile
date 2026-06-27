# === Stage 1: Build - cài đặt compiler và biên dịch các thư viện C ===
FROM python:3.10-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# === Stage 2: Runtime - chỉ chứa thư viện cần thiết, không có build tools ===
FROM python:3.10-slim

WORKDIR /app

# Chỉ cài runtime lib (libpq5 ~3MB thay vì build-essential ~380MB)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copy các gói Python đã được cài đặt từ stage builder
COPY --from=builder /install /usr/local
COPY . .

EXPOSE 5000

CMD ["uvicorn", "src.index:app", "--host", "0.0.0.0", "--port", "5000", "--workers", "2"]