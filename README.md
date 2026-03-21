# MLOps Weather Classification System

An end-to-end MLOps pipeline for detecting Data Drift and automated Retraining on a Weather Image Classification model (Haze/Rain/Shine) using XGBoost with hand-crafted features (Color Moments, HOG, and GLCM).

**Research Topic:** *"Drift-Aware MLOps: Real-Time Feature Distribution Monitoring for Traditional ML Models in Uncontrolled Weather Sensing"*

**Project:** NT114 - MLOps Architecture
**Team:** Viet Hoang (23520541@gm.uit.edu.vn), Thai (23521412@gm.uit.edu.vn)
**Department:** Computer Networks and Data Communications

---

## Quick Reference

| Task | Command |
|------|---------|
| Start API | `python src/api/index.py` |
| Start Demo | `python src/app.py` |
| Build Docker | `docker-compose up --build` |
| Run Tests | `pytest tests/` |

---

## Quick Start (5 minutes)

See [QUICKSTART.md](QUICKSTART.md) for detailed 5-minute setup.

**TL;DR:**
```bash
git clone https://github.com/Viet-Hoang-2005/MLOps-weather-system.git
cd MLOps-weather-system

# Option 1: Docker (Fastest)
docker-compose up --build

# Option 2: Local
python -m venv venv && source venv/bin/activate
pip install -r src/requirements.txt
python src/extract_reference_data.py
python src/api/index.py
```

---

## Project Structure

```
MLOps-weather-system/
|
|-- src/
|   |-- api/              # Flask REST API
|   |-- training/         # XGBoost training
|   |-- drift_detection/ # Evidently AI drift detection
|   |-- app.py           # Gradio demo
|
|-- .github/workflows/   # CI/CD pipelines
|-- data/                # Reference data
|-- models/              # Trained models
|-- infra/               # Terraform IaC
```

---

## Feature Engineering

| Type | Features | Count |
|------|----------|-------|
| Color Moments (HSV) | Mean, Std of H, S, V | 6 |
| HOG | Mean, Std, Max | 3 |
| GLCM | Contrast, Correlation, Energy, Homogeneity | 8 |
| **Total** | | **17 features** |

---

## Drift Detection Thresholds

| PSI Range | Status | Action |
|-----------|--------|--------|
| < 0.1 | Stable | Continue monitoring |
| 0.1 - 0.2 | Warning | Investigate |
| > 0.2 | Drift | Trigger retraining |

---

## Documentation

| File | Description |
|------|-------------|
| [QUICKSTART.md](QUICKSTART.md) | 5-minute quick start guide |
| [INSTALL.md](INSTALL.md) | Detailed installation instructions |
| [SETUP.md](SETUP.md) | Development workflow (Git, Test, Docker, MLflow) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture with Mermaid diagrams |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |
| [WORKFLOW.md](.github/WORKFLOW.md) | Git workflow guide |

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| ML Model | XGBoost |
| Features | OpenCV, scikit-image |
| API | Flask |
| Monitoring | Evidently AI |
| Orchestration | K3s |
| CI/CD | GitHub Actions |
| Container | Docker |

---

## Performance Targets

| Metric | Target |
|--------|--------|
| API Latency (P95) | < 500ms |
| Throughput | 100 req/sec |
| MTTR | < 30 min |
| Zero Downtime | 100% |

---

## References

- [Evidently AI](https://docs.evidentlyai.com/)
- [XGBoost](https://xgboost.readthedocs.io/)
- [Flask](https://flask.palletsprojects.com/)
- [scikit-image GLCM](https://scikit-image.org/docs/stable/api/skimage.feature.html)

---

Created for NT114 - MLOps Architecture Project
Department: Computer Networks and Data Communications
