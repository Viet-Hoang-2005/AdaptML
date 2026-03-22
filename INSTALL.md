# Installation Guide

Detailed installation instructions for the MLOps Weather Classification System.

---

## Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Python | 3.10+ | 3.11 |
| RAM | 4 GB | 8 GB |
| Storage | 10 GB | 20 GB |
| OS | Windows 10+ | Ubuntu 22.04+ |

### Required Software

- [Python 3.10+](https://www.python.org/downloads/)
- [Git](https://git-scm.com/downloads)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Kaggle Account](https://www.kaggle.com/)

---

## Step 1: Clone Repository

```bash
git clone https://github.com/Viet-Hoang-2005/MLOps-weather-system.git
cd MLOps-weather-system
```

---

## Step 2: Virtual Environment

**Linux/macOS:**
```bash
python3 -m venv venv
source venv/bin/activate
```

**Windows:**
```cmd
python -m venv venv
venv\Scripts\activate
```

---

## Step 3: Install Dependencies

```bash
pip install -r src/requirements.txt
```

---

## Step 4: Dataset

### Option A: Kaggle API (Recommended)

```bash
# Install Kaggle CLI
pip install kaggle

# Create API token
# 1. Go to https://www.kaggle.com/account
# 2. Create New API Token
# 3. Save kaggle.json to ~/.kaggle/

# Download datasets
kaggle datasets download -d jehanbhathena/weather-dataset
unzip weather-dataset.zip -d data/raw_images/
```

### Option B: Manual Download

1. Download from [Kaggle Weather Dataset](https://www.kaggle.com/datasets/jehanbhathena/weather-dataset)
2. Extract to `data/raw_images/`

### Folder Structure

```
data/raw_images/
    haze/           # Images from fogsmog folder
    rain/           # Images from rain folder
    shine/          # Images from Shine folder
```

---

## Step 5: Generate Reference Dataset

```bash
python src/extract_reference_data.py
```

Expected output:
```
[*] Processing: haze...
[+] Total images: 300
SUCCESS! Reference Dataset saved to: data/reference_data.csv
```

---

## Step 6: Verify Installation

```bash
# Test feature extraction
python -c "
from src.api.index import extract_features
import numpy as np
img = np.zeros((256, 256, 3), dtype=np.uint8)
features = extract_features(img)
print(f'Feature shape: {features.shape}')  # Should be (17,)
"

# Test API
python src/api/index.py &
curl http://localhost:5000/health
```

---

## Docker Installation

### Docker Compose (Recommended)

```bash
docker-compose up --build
docker-compose up -d      # Background
docker-compose logs -f   # View logs
docker-compose down      # Stop
```

### Manual Docker Build

```bash
# Build images
docker build -t weather-api -f src/api/Dockerfile .
docker build -t weather-training -f src/training/Dockerfile .
docker build -t weather-drift -f src/drift_detection/Dockerfile .

# Run API
docker run -p 5000:5000 weather-api
```

---

## Kubernetes Installation

### Install K3s

**Linux:**
```bash
curl -sfL https://get.k3s.io | sh -
```

**macOS:**
```bash
brew install k3d
k3d cluster create weather-cluster
```

### Deploy

```bash
kubectl create namespace mlops
kubectl apply -f infra/k8s/
kubectl get pods -n mlops
```

---

## Environment Variables

Create `.env` file:

```bash
# Database
DATABASE_URL=postgresql://weather:weather@localhost:5432/weather_db

# MLflow
MLFLOW_TRACKING_URI=http://localhost:5000

# Paths
DATA_DIR=./data/raw_images
MODEL_DIR=./models
```

---

## Troubleshooting

### ModuleNotFoundError

```bash
pip install -r src/requirements.txt
```

### Port Already in Use

```bash
# Find process
lsof -i :5000

# Kill
kill -9 <PID>
```

### Permission Denied

```bash
# Linux/macOS
sudo chmod -R 755 .

# Windows (run as administrator)
```

### Dataset Not Found

```bash
ls -la data/raw_images/
# Should show: haze/ rain/ shine/
```

### Docker Build Fails

```bash
docker builder prune
docker build --no-cache -t weather-api -f src/api/Dockerfile .
```

---

## Next Steps

| Task | Guide |
|------|-------|
| Development workflow | [SETUP.md](SETUP.md) |
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Git workflow | [.github/WORKFLOW.md](.github/WORKFLOW.md) |

---

Created for NT114 - MLOps Architecture Project
Department: Computer Networks and Data Communications
