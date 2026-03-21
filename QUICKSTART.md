# Quick Start Guide

Get up and running with the MLOps Weather Classification System in 5 minutes.

---

## Option 1: Docker (Fastest)

```bash
# Clone and start
git clone https://github.com/Viet-Hoang-2005/MLOps-weather-system.git
cd MLOps-weather-system

# Start all services
docker-compose up --build

# Access:
# - API: http://localhost:5000
# - Gradio Demo: http://localhost:7860
```

---

## Option 2: Local Development

### Step 1: Install Dependencies

```bash
git clone https://github.com/Viet-Hoang-2005/MLOps-weather-system.git
cd MLOps-weather-system

python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

pip install -r src/requirements.txt
```

### Step 2: Prepare Dataset

```bash
# Create folders
mkdir -p data/raw_images/{haze,rain,shine}

# Copy images into folders, then:
python src/extract_reference_data.py
```

### Step 3: Start API

```bash
# Terminal 1: Start API
cd src
python api/index.py

# Terminal 2: Test prediction
curl -X POST http://localhost:5000/predict -F "image=@your_image.jpg"
```

### Step 4: Start Demo (Optional)

```bash
# Terminal 3: Start Gradio
python src/app.py

# Open browser: http://localhost:7860
```

---

## Option 3: Kubernetes

```bash
# Install K3s
curl -sfL https://get.k3s.io | sh -

# Deploy
kubectl apply -f infra/k8s/

# Check status
kubectl get pods -n mlops
```

---

## What's Next?

| Task | Guide |
|------|-------|
| Understand the system | [README.md](README.md) |
| Full installation | [INSTALL.md](INSTALL.md) |
| Development setup | [SETUP.md](SETUP.md) |
| System architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Contribute | [CONTRIBUTING.md](CONTRIBUTING.md) |

---

## Common Commands

```bash
# Start API
python src/api/index.py

# Start Gradio demo
python src/app.py

# Run drift detection
python src/drift_detection/detect_drift.py

# Train model
python src/training/train.py

# Docker: start all
docker-compose up -d

# Docker: view logs
docker-compose logs -f

# Docker: stop
docker-compose down
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 5000 in use | `lsof -i :5000` then `kill -9 <PID>` |
| Module not found | `pip install -r src/requirements.txt` |
| Dataset not found | Check `data/raw_images/{haze,rain,shine}/` |

---

For more help, see [INSTALL.md](INSTALL.md#troubleshooting).
