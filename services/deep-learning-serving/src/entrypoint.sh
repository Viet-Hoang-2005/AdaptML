#!/usr/bin/env bash
set -e

echo "Starting Deep Learning Serving Runtime Initialization..."
python -m src.init

if [ -f "/tmp/safe_requirements.txt" ]; then
    echo "Installing dynamic dependencies into /app/libs..."
    mkdir -p /app/libs
    pip install --target /app/libs --no-cache-dir -r /tmp/safe_requirements.txt
fi

export PYTHONPATH="/app/libs:/app:$PYTHONPATH"
echo "Dynamic runtime initialization completed. Starting BentoML server on port 5002..."
exec bentoml serve src.index:DeepLearningModelService --port 5002 --host 0.0.0.0
