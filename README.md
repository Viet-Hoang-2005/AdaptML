# MLOps Weather Classification System

An end-to-end MLOps pipeline for detecting Data Drift and automated Retraining on a Weather Image Classification model (Haze/Rain/Shine) using XGBoost with hand-crafted features (Color Moments, HOG, and GLCM).

---

## Table of Contents

- [Overview](#overview)
- [Setup](#setup)
- [Project Structure](#project-structure)
- [Core Components](#core-components)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Drift Detection](#drift-detection)
- [Deployment](#deployment)
- [Contributing](#contributing)

---

## Overview

### Research Topic

**Title:** *"Drift-Aware MLOps: Real-Time Feature Distribution Monitoring for Traditional ML Models in Uncontrolled Weather Sensing"*

### Technology Stack

| Component | Technology |
|-----------|------------|
| Machine Learning | XGBoost, scikit-learn |
| Feature Extraction | OpenCV, scikit-image |
| API Serving | Flask, Gunicorn |
| Monitoring | Evidently AI (PSI-based drift detection) |
| Orchestration | K3s (Lightweight Kubernetes) |
| CI/CD | GitHub Actions |
| Container | Docker, Docker Compose |

### Feature Engineering

| Type | Features | Count |
|------|----------|-------|
| Color Moments (HSV) | Mean, Std of H, S, V channels | 6 |
| HOG | Mean, Std, Max of HOG vector | 3 |
| GLCM | Contrast, Correlation, Energy, Homogeneity (2 angles) | 8 |
| **Total** | | **17 features** |

---

## Setup

### System Requirements

- Python 3.10+
- Docker & Docker Compose (for local deployment)
- 4GB RAM minimum

### Step 1: Clone and Setup Environment

```bash
# Clone repository
git clone <repo-url>
cd MLOps-weather-system

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r src/requirements.txt
```

### Step 2: Prepare Dataset

```bash
# Create directory structure
mkdir -p data/raw_images/{haze,rain,shine}

# Copy images into corresponding folders
# Haze images: data/raw_images/haze/
# Rain images: data/raw_images/rain/
# Shine images: data/raw_images/shine/

# Extract reference features
python src/extract_reference_data.py
```

### Step 3: Run the System

```bash
# Start Flask API
cd src
python api/index.py

# Or use Docker Compose
docker-compose up --build
```

---

## Project Structure

```
MLOps-weather-system/
|
|-- .github/
|    |-- workflows/
|    |    |-- ci_cd_pipeline.yml      # CI/CD on push to main
|    |    |-- retrain_pipeline.yml   # Auto-retrain on drift detection
|
|-- src/
|    |-- api/
|    |    |-- index.py               # Flask API server
|    |    |-- Dockerfile
|    |    |-- requirements.txt
|    |
|    |-- drift_detection/
|    |    |-- detect_drift.py        # Drift detection with Evidently AI
|    |    |-- Dockerfile
|    |    |-- requirements.txt
|    |
|    |-- training/
|    |    |-- train.py               # XGBoost training script
|    |    |-- Dockerfile
|    |    |-- requirements.txt
|    |
|    |-- app.py                      # Gradio demo interface
|    |-- extract_reference_data.py    # Reference dataset generator
|    |-- requirements.txt
|
|-- infra/
|    |-- main.tf                     # Terraform for AWS
|    |-- variables.tf
|
|-- data/
|    |-- reference_data.csv           # Baseline features
|    |-- production_data.csv         # API logs
|
|-- models/
|    |-- xgb_best_model.pkl         # Trained model
|    |-- label_encoder.pkl           # Label encoder
|
|-- docker-compose.yml
|-- README.md
|-- CONTRIBUTING.md
```

---

## Core Components

### 1. API Service (`src/api/`)

REST API that accepts images and returns prediction results.

**Endpoints:**
- `POST /predict` - Predict weather class from image
- `GET /health` - Health check

### 2. Training Service (`src/training/`)

Trains XGBoost model with feature extraction from dataset.

**Input:** Images in `data/raw_images/`
**Output:** `models/xgb_best_model.pkl`

### 3. Drift Detection (`src/drift_detection/`)

Detects data drift using Population Stability Index (PSI).

**Thresholds:**
- PSI < 0.1: Stable
- PSI 0.1 - 0.2: Mild shift (warning)
- PSI > 0.2: Significant drift - trigger retrain

### 4. Demo Interface (`src/app.py`)

Gradio web interface for direct model testing.

---

## Usage

### Using API Directly

```bash
# Start API
python src/api/index.py

# Test with curl
curl -X POST http://localhost:5000/predict \
     -F "image=@test_image.jpg"
```

**Response:**
```json
{
  "success": true,
  "predictions": {
    "haze": 85.23,
    "rain": 10.45,
    "shine": 4.32
  }
}
```

### Using Gradio Demo

```bash
python src/app.py
```

Open browser and go to `http://localhost:7860`

### Create Reference Dataset

```bash
# Ensure images are in data/raw_images/{haze,rain,shine}/
python src/extract_reference_data.py
```

### Run Drift Detection

```bash
python src/drift_detection/detect_drift.py
```

---

## API Reference

### POST /predict

Accepts an image and returns prediction results.

**Request:**
```
Content-Type: multipart/form-data
Body: image (file)
```

**Response:**
```json
{
  "success": true,
  "predictions": {
    "haze": 85.23,
    "rain": 10.45,
    "shine": 4.32
  }
}
```

### GET /health

Check API health status.

**Response:**
```json
{
  "status": "healthy"
}
```

---

## Drift Detection

### How It Works

```
Production Image Input
        |
        v
[Feature Extraction] --> 17 features
        |
        v
[Compare with Reference Data]
        |
        v
[Calculate PSI Score]
        |
        v
PSI > 0.2 ? ---- YES ----> [Trigger Retrain Pipeline]
        |
       NO
        |
        v
[Continue Monitoring]
```

### PSI Calculation

PSI (Population Stability Index):

```
PSI = Sum[(Actual_i - Expected_i) * ln(Actual_i / Expected_i)]
```

**Interpretation:**
| PSI Range | Status | Action |
|-----------|--------|--------|
| < 0.1 | Stable | Continue monitoring |
| 0.1 - 0.2 | Mild shift | Investigate |
| > 0.2 | Significant drift | Trigger retraining |
| > 0.5 | Severe drift | Immediate action required |

---

## Deployment

### Local (Docker Compose)

```bash
# Build and run all services
docker-compose up --build

# Run in background
docker-compose up -d
```

### Kubernetes (K3s)

```bash
# Install K3s
curl -sfL https://get.k3s.io | sh -

# Apply manifests
kubectl apply -f k8s/

# Check pods
kubectl get pods -n mlops
```

### CI/CD Pipeline

**CI/CD Pipeline (on push to main):**
1. Run tests
2. Build Docker image
3. Push to registry
4. Deploy to staging

**Retrain Pipeline (on drift detection):**
1. Check drift status
2. If PSI > 0.2:
   - Pull new data
   - Retrain model
   - Evaluate
   - Deploy new model
3. If PSI <= 0.2:
   - Log and continue monitoring

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

---

## References

- [Evidently AI Documentation](https://docs.evidentlyai.com/)
- [XGBoost Documentation](https://xgboost.readthedocs.io/)
- [Flask Documentation](https://flask.palletsprojects.com/)
- [scikit-image GLCM](https://scikit-image.org/docs/stable/api/skimage.feature.html#skimage.feature.graycomatrix)

---

Created for NT114 - MLOps Architecture Project
Department: Computer Networks and Data Communications
