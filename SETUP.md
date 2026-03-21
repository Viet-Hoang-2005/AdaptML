# Development Setup Guide

Local development environment setup for the MLOps Weather Classification System.

---

## Overview

This guide covers setting up a local development environment for contributing to the project.

---

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/Viet-Hoang-2005/MLOps-weather-system.git
cd MLOps-weather-system

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/macOS
# venv\Scripts\activate   # Windows

# Install dependencies
pip install -r src/requirements.txt
```

### 2. Verify Installation

```bash
# Check Python version
python --version

# Verify all packages installed
pip list
```

### 3. Start Development

```bash
# Start API server
python src/api/index.py

# In another terminal, start Gradio demo
python src/app.py
```

---

## Project Directory Structure

### Main Directories

| Directory | Purpose |
|-----------|---------|
| `src/` | Source code for all components |
| `src/api/` | Flask REST API |
| `src/training/` | Model training pipeline |
| `src/drift_detection/` | Drift detection service |
| `data/` | Dataset storage |
| `models/` | Trained model files |
| `tests/` | Unit and integration tests |

### Working with Each Component

#### API Development

```bash
cd src/api

# Run in development mode with auto-reload
python index.py

# Run with Flask debug mode
FLASK_DEBUG=1 python index.py
```

#### Training Development

```bash
cd src/training

# Run training with local data
DATA_DIR=../../data/raw_images python train.py

# Run with MLflow tracking
mlflow server --backend-store-uri sqlite:///mlflow.db
```

#### Drift Detection Development

```bash
cd src/drift_detection

# Test drift detection locally
python detect_drift.py
```

---

## Git Workflow

### 1. Create Feature Branch

```bash
# Update main branch
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/your-feature-name
```

### 2. Make Changes

```bash
# Make your changes
# Write tests
# Update documentation
```

### 3. Commit Changes

```bash
# Stage files
git add .

# Commit with descriptive message
git commit -m "feat(component): description of change"
```

### 4. Push and Create PR

```bash
# Push branch
git push origin feature/your-feature-name

# Create Pull Request on GitHub
```

---

## Testing

### Run All Tests

```bash
# From project root
pytest tests/

# With coverage
pytest tests/ --cov=src --cov-report=html
```

### Run Specific Tests

```bash
# Test API
pytest tests/test_api.py -v

# Test features
pytest tests/test_features.py -v

# Test drift detection
pytest tests/test_drift.py -v
```

### Write New Tests

Create test files in `tests/` directory:

```python
# tests/test_example.py
import pytest

def test_example():
    assert True
```

---

## Docker Development

### Build Images

```bash
# Build all images
docker-compose build

# Build specific service
docker-compose build api
docker-compose build training
docker-compose build drift
```

### Run Services

```bash
# Run all services
docker-compose up

# Run specific service
docker-compose up api

# Run in background
docker-compose up -d
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
```

### Shell Access

```bash
# Access API container shell
docker-compose exec api /bin/bash
```

---

## Database Development

### PostgreSQL Setup

```bash
# Start PostgreSQL
docker-compose up -d postgres

# Connect to database
psql postgresql://weather:weather@localhost:5432/weather_db
```

### Create Tables

```sql
CREATE TABLE predictions (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    predicted_class VARCHAR(50),
    confidence FLOAT,
    features JSONB
);

CREATE TABLE drift_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    psi_score FLOAT,
    status VARCHAR(20)
);
```

---

## MLflow Development

### Start MLflow Server

```bash
# Start MLflow UI
mlflow server \
    --backend-store-uri sqlite:///mlflow.db \
    --default-artifact-root ./mlartifacts \
    --host 0.0.0.0 \
    --port 5000

# Access at http://localhost:5000
```

### Track Experiments

```python
import mlflow

mlflow.set_experiment("weather-classification")

with mlflow.start_run():
    mlflow.log_param("n_estimators", 100)
    mlflow.log_metric("f1_score", 0.95)
    mlflow.xgboost.log_model(model, "model")
```

---

## Code Quality

### Format Code

```bash
# Format with black
black src/

# Format with isort
isort src/
```

### Lint Code

```bash
# Run flake8
flake8 src/

# Run pylint
pylint src/
```

### Pre-commit Hooks

```bash
# Install pre-commit
pip install pre-commit

# Install hooks
pre-commit install

# Run manually
pre-commit run --all-files
```

---

## Troubleshooting

### Port Conflicts

```bash
# Check port usage
lsof -i :5000
lsof -i :7860
lsof -i :5432

# Kill process
kill -9 <PID>
```

### Virtual Environment Issues

```bash
# Remove and recreate
rm -rf venv
python -m venv venv
pip install -r src/requirements.txt
```

### Docker Issues

```bash
# Clean up containers
docker-compose down -v

# Remove all containers
docker container prune -f

# Rebuild from scratch
docker-compose down --rmi all --volumes
docker-compose build --no-cache
```

---

## Environment Variables

Create `.env` file for local development:

```bash
# Database
DATABASE_URL=postgresql://weather:weather@localhost:5432/weather_db

# MLflow
MLFLOW_TRACKING_URI=http://localhost:5000

# Paths
DATA_DIR=./data/raw_images
MODEL_DIR=./models

# AWS (optional)
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
```

---

## VS Code Setup

Recommended extensions:

```json
{
  "recommendations": [
    "ms-python.python",
    "ms-python.vscode-pylance",
    "ms-azuretools.vscode-docker",
    "github.copilot"
  ]
}
```

VS Code settings (`.vscode/settings.json`):

```json
{
  "python.linting.enabled": true,
  "python.linting.pylintEnabled": true,
  "python.formatting.provider": "black",
  "python.testing.pytestEnabled": true,
  "files.exclude": {
    "**/__pycache__": true,
    "**/*.pyc": true
  }
}
```

---

Created for NT114 - MLOps Architecture Project
Department: Computer Networks and Data Communications
