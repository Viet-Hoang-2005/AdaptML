FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ libpq-dev build-essential \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY src /app/src

ENV PYTHONPATH=/app
ENV BENTOML_PORT=5000
EXPOSE 5000

CMD ["bentoml", "serve", "/app/src/index.py:DeepLearningModelService", "--port", "5000", "--host", "0.0.0.0"]
