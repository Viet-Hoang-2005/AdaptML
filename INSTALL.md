# Installation Guide

Complete setup instructions for the MLOps Weather Classification System.

---

## Prerequisites

### System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Python | 3.10+ | 3.11 |
| RAM | 4 GB | 8 GB |
| Storage | 10 GB | 20 GB |
| OS | Windows 10+ | Ubuntu 22.04+ |

### Required Software

- [Python 3.10+](https://www.python.org/downloads/)
- [Git](https://git-scm.com/downloads)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (optional)
- [Kaggle Account](https://www.kaggle.com/) (for dataset)

---

## Step-by-Step Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/Viet-Hoang-2005/MLOps-weather-system.git
cd MLOps-weather-system
```

### Step 2: Create Virtual Environment

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

### Step 3: Install Dependencies

```bash
# Install all dependencies
pip install -r src/requirements.txt

# Or install in editable mode
pip install -e .
```

### Step 4: Download Dataset

The system uses weather images from Kaggle.

**Option A: Kaggle API (Recommended)**

```bash
# Install Kaggle CLI
pip install kaggle

# Create Kaggle API token
# 1. Go to https://www.kaggle.com/account
# 2. Click "Create New API Token"
# 3. Save kaggle.json to ~/.kaggle/

# Download datasets
kaggle datasets download -d paultimothymooney/kermany2018
kaggle datasets download -d jehanbhathena/weather-dataset
```

**Option B: Manual Download**

1. Go to [Weather Dataset](https://www.kaggle.com/datasets/jehanbhathena/weather-dataset)
2. Download and extract to `data/raw_images/`

### Step 5: Organize Dataset

```
data/
raw_images/
    haze/           <- Images from fogsmog folder
        img1.jpg
        img2.jpg
    rain/           <- Images from rain folder
        img1.jpg
        img2.jpg
    shine/          <- Images from Shine folder
        img1.jpg
        img2.jpg
```

### Step 6: Generate Reference Dataset

```bash
python src/extract_reference_data.py
```

Expected output:
```
[*] Scanning directory: data/raw_images
[*] Processing label: haze...
[#################################] 100%
[*] Processing label: rain...
[#################################] 100%
[*] Processing label: shine...
[#################################] 100%
[+] Total images extracted: 300
[*] Exporting to CSV...
SUCCESS! Reference Dataset saved to: data/reference_data.csv
```

---

## Docker Installation

### Option A: Docker Compose (Recommended)

```bash
# Build and start all services
docker-compose up --build

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Option B: Manual Docker Build

```bash
# Build API image
docker build -t weather-api -f src/api/Dockerfile .

# Build training image
docker build -t weather-training -f src/training/Dockerfile .

# Build drift detection image
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

### Deploy Application

```bash
# Create namespace
kubectl create namespace mlops

# Apply configurations
kubectl apply -f infra/k8s/

# Check status
kubectl get pods -n mlops

# View logs
kubectl logs -l app=weather-classifier -n mlops
```

---

## Verification

### Test Feature Extraction

```bash
python -c "
from src.api.index import extract_features
import numpy as np
import cv2

# Create dummy image
img = np.zeros((256, 256, 3), dtype=np.uint8)
features = extract_features(img)
print(f'Feature shape: {features.shape}')
print(f'Expected: (17,)')
"
```

### Test API

```bash
# Start API
python src/api/index.py &

# Test health endpoint
curl http://localhost:5000/health

# Test prediction
curl -X POST http://localhost:5000/predict \
     -F "image=@data/raw_images/haze/test_image.jpg"
```

### Test Drift Detection

```bash
python src/drift_detection/detect_drift.py
```

Expected output:
```
[*] Loading reference data...
[*] Loading production data...
[*] Calculating PSI scores...
[+] Drift check complete
[+] Status: Stable (PSI < 0.2)
```

---

## Troubleshooting

### Common Issues

#### Issue: ModuleNotFoundError

**Problem:** Python modules not found

**Solution:**
```bash
pip install -r src/requirements.txt
```

#### Issue: Port Already in Use

**Problem:** Port 5000 or 7860 already occupied

**Solution:**
```bash
# Find process using port
lsof -i :5000

# Kill process
kill -9 <PID>

# Or use different port
python src/api/index.py --port 5001
```

#### Issue: Permission Denied

**Problem:** Cannot create directories or files

**Solution:**
```bash
# Linux/macOS
sudo chmod -R 755 .

# Windows (run as administrator)
```

#### Issue: Dataset Not Found

**Problem:** Raw images not in correct directory

**Solution:**
```bash
# Verify directory structure
ls -la data/raw_images/

# Should show: haze/ rain/ shine/
```

#### Issue: Docker Build Fails

**Problem:** Docker build errors

**Solution:**
```bash
# Clean Docker cache
docker builder prune

# Rebuild without cache
docker build --no-cache -t weather-api -f src/api/Dockerfile .
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `/opt/ml/input/data/training` | Training data directory |
| `MODEL_DIR` | `/opt/ml/model` | Model output directory |
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/weather` | Database connection |
| `MLFLOW_TRACKING_URI` | `http://localhost:5000` | MLflow server URI |
| `AWS_ACCESS_KEY_ID` | - | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | - | AWS credentials |

---

## Next Steps

After installation, see:
- [README.md](README.md) - Usage instructions
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development guide

---

Created for NT114 - MLOps Architecture Project
Department: Computer Networks and Data Communications
