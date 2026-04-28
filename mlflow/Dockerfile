FROM python:3.10-slim

WORKDIR /app

# Cài đặt các dependencies cơ bản (nếu cần thiết cho network requests)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "dispatch_production_model.py"]
