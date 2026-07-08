#!/bin/bash
set -e

echo "[Model Server Entrypoint] Starting runtime initialization..."
echo "[Model Server Entrypoint] TENANT_ID: ${TENANT_ID:-unknown}, MODEL_ID: ${MODEL_ID:-unknown}, VERSION: ${MODEL_VERSION:-latest}"

# Tạo sẵn thư mục lưu thư viện nạp động nếu chưa có
mkdir -p /app/libs
export PYTHONPATH="/app/libs:${PYTHONPATH}"

if [ -n "$MODEL_ID" ] && [ "$MODEL_ID" != "unknown" ]; then
    echo "[Model Server Entrypoint] Pre-loading model artifact and checking requirements..."
    python -m src.init_runtime || echo "[Model Server Entrypoint] Pre-load returned non-fatal warning or error. Continuing startup..."
    
    if [ -f "/tmp/safe_requirements.txt" ]; then
        echo "[Model Server Entrypoint] Found safe dynamic requirements. Installing dependencies into /app/libs..."
        pip install --target /app/libs --no-cache-dir -r /tmp/safe_requirements.txt || echo "[Model Server Entrypoint] Warning: Some dynamic requirements failed to install."
    fi
fi

echo "[Model Server Entrypoint] Starting Uvicorn API server..."
exec uvicorn src.index:app --host 0.0.0.0 --port 5000 --workers 2
