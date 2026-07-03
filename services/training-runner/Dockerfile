FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN python -m pip install --upgrade pip && \
    python -m pip install boto3 redis

COPY runner.py /app/train_runner.py

CMD ["python", "/app/train_runner.py"]
