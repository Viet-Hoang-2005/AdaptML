#!/bin/bash
set -e

echo "Starting machine-learning-serving runtime initialization..."
echo "TENANT_ID: ${TENANT_ID:-unknown}, MODEL_ID: ${MODEL_ID:-unknown}, VERSION: ${MODEL_VERSION:-latest}"

mkdir -p /app/libs
export PYTHONPATH="/app/libs:${PYTHONPATH}"

if [ -n "$MODEL_ID" ] && [ "$MODEL_ID" != "unknown" ]; then
    echo "Pre-loading ML model artifact and checking requirements..."
    python -m src.init || echo "Pre-load returned non-fatal warning or error. Continuing startup..."
    
    if [ -f "/tmp/safe_requirements.txt" ]; then
        echo "Found safe dynamic requirements. Installing dependencies into /app/libs..."
        pip install --target /app/libs --no-cache-dir -r /tmp/safe_requirements.txt || echo "Warning: Some dynamic requirements failed to install."
    fi
fi

echo "Starting Uvicorn Machine Learning Serving Engine on port 5001..."
exec uvicorn src.index:app --host 0.0.0.0 --port 5001 --workers 2
