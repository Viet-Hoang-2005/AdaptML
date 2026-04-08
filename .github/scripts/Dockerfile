FROM python:3.10-slim

WORKDIR /app

# Khắc phục lỗi thiếu thư viện C-compiler cho psycopg2
RUN apt-get update && apt-get install -y libpq-dev && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY update_reference_data.py .

CMD ["python", "update_reference_data.py"]
