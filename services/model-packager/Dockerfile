# === Stage 1: Build - cài đặt compiler và biên dịch các thư viện C ===
FROM python:3.10-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# === Stage 2: Runtime - chỉ chứa thư viện cần thiết, không có build tools ===
FROM python:3.10-slim

WORKDIR /app

# libgomp1 là runtime dependency của scikit-learn / lightgbm
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy các gói Python đã được cài đặt từ stage builder
COPY --from=builder /install /usr/local
COPY src ./src

EXPOSE 7000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "7000"]
