# Quick Start Guide

Get up and running in 5 minutes.

---

## Option 1: Docker (Fastest)

```bash
git clone https://github.com/Viet-Hoang-2005/MLOps-weather-system.git
cd MLOps-weather-system

docker-compose up --build
```

Access:
- API: http://localhost:5000
- Gradio Demo: http://localhost:7860

---

## Option 2: Local Development

### Step 1: Clone and Install

```bash
git clone https://github.com/Viet-Hoang-2005/MLOps-weather-system.git
cd MLOps-weather-system

python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

pip install -r src/requirements.txt
```

### Step 2: Prepare Dataset

```bash
mkdir -p data/raw_images/{haze,rain,shine}

# Copy images into folders, then:
python src/extract_reference_data.py
```

### Step 3: Start API

```bash
# Terminal 1: API
python src/api/index.py

# Terminal 2: Test
curl -X POST http://localhost:5000/predict -F "image=@your_image.jpg"
```

### Step 4: Start Demo (Optional)

```bash
python src/app.py
# Open: http://localhost:7860
```

---

## Option 3: Kubernetes

```bash
# Install K3s
curl -sfL https://get.k3s.io | sh -

# Deploy
kubectl create namespace mlops
kubectl apply -f infra/k8s/
kubectl get pods -n mlops
```

---

## What's Next?

| Task | Guide |
|------|-------|
| Full installation | [INSTALL.md](INSTALL.md) |
| Development workflow | [SETUP.md](SETUP.md) |
| Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Contribute | [CONTRIBUTING.md](CONTRIBUTING.md) |

---

## Common Commands

```bash
# API
python src/api/index.py

# Gradio Demo
python src/app.py

# Drift Detection
python src/drift_detection/detect_drift.py

# Training
python src/training/train.py

# Docker
docker-compose up -d    # Start
docker-compose logs -f  # Logs
docker-compose down     # Stop

# Tests
pytest tests/
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 5000 in use | `lsof -i :5000` then `kill -9 <PID>` |
| Module not found | `pip install -r src/requirements.txt` |
| Dataset not found | Check `data/raw_images/{haze,rain,shine}/` |

For detailed troubleshooting, see [INSTALL.md](INSTALL.md#troubleshooting).
