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

## Project Structure

```
└───MLOps-weather-system
    │   .dockerignore
    │   .gitignore
    │   ARCHITECTURE.md
    │   CHANGELOG.md
    │   CONTRIBUTING.md
    │   docker-compose.yml
    │   INSTALL.md
    │   LICENSE
    │   QUICKSTART.md
    │   README.md
    │   SETUP.md
    │
    ├───.github
    │   │   PULL_REQUEST_TEMPLATE.md
    │   │   WORKFLOW.md
    │   │
    │   ├───ISSUE_TEMPLATE
    │   │       ISSUE_BUG.md
    │   │       ISSUE_FEATURE.md
    │   │
    │   └───workflows
    │           ci_cd_pipeline.yml
    │           retrain_pipeline.yml
    │
    ├───.vscode
    │       settings.json
    │
    ├───data
    │       reference_data.csv
    │       xgb_smart_tuning_results.csv
    │
    ├───infra
    │       main.tf
    │       variables.tf
    │
    ├───models
    │       label_encoder.pkl
    │       xgb_best_model.pkl
    │
    ├───notebooks
    │       MinhHoa.ipynb
    │       XGB.ipynb
    │       XGB_GridSearchHOG.ipynb
    │
    └───src
        │   app.py
        │   extract_reference_data.py
        │   requirements.txt
        │
        ├───api
        │       Dockerfile
        │       index.py
        │       requirements.txt
        │
        ├───drift_detection
        │       detect_drift.py
        │       requirements.txt
        │
        └───training
                Dockerfile
                requirements.txt
                train.py
```

---

## Component Descriptions

### .github/

| File/Folder | Description |
|-------------|-------------|
| `PULL_REQUEST_TEMPLATE.md` | Standard Pull Request template |
| `WORKFLOW.md` | Git workflow guide with Mermaid diagrams |
| `ISSUE_TEMPLATE/ISSUE_BUG.md` | Bug report template |
| `ISSUE_TEMPLATE/ISSUE_FEATURE.md` | Feature request template |
| `workflows/ci_cd_pipeline.yml` | CI/CD: test -> build Docker -> push to ECR -> deploy |
| `workflows/retrain_pipeline.yml` | Auto-retrain when drift detected (PSI > 0.2) |

### .vscode/

| File | Description |
|------|-------------|
| `settings.json` | VS Code settings for Python, Docker |

### data/

| File | Description |
|------|-------------|
| `reference_data.csv` | Baseline features from original images (17 columns) |
| `xgb_smart_tuning_results.csv` | Results of all Optuna experiments |

### infra/

| File | Description |
|------|-------------|
| `main.tf` | AWS resources definition (S3, ECR, Lambda, SageMaker) |
| `variables.tf` | Terraform variables |

### models/

| File | Description |
|------|-------------|
| `label_encoder.pkl` | Encode labels: haze=0, rain=1, shine=2 |
| `xgb_best_model.pkl` | Trained XGBoost model (F1 ~95.56%) |

### notebooks/

| File | Description |
|------|-------------|
| `MinhHoa.ipynb` | Compare best vs worst model predictions |
| `XGB.ipynb` | XGBoost experiments with 31 feature combinations |
| `XGB_GridSearchHOG.ipynb` | XGBoost with HOG GridSearch |

### src/

| File/Folder | Description |
|-------------|-------------|
| `app.py` | Gradio web interface for direct model testing |
| `extract_reference_data.py` | Extract 17 features from original dataset |
| `requirements.txt` | Main Python dependencies |
| `api/index.py` | Flask API: receive image, extract features, return prediction |
| `api/Dockerfile` | Docker image for API service |
| `api/requirements.txt` | API dependencies |
| `drift_detection/detect_drift.py` | Compare production vs reference features, calculate PSI |
| `drift_detection/requirements.txt` | Evidently AI dependencies |
| `training/train.py` | Train XGBoost with Optuna hyperparameter tuning |
| `training/Dockerfile` | Docker image for training service |
| `training/requirements.txt` | Training dependencies |

---

## Feature Engineering

| Type | Features | Count |
|------|----------|-------|
| Color Moments (HSV) | Mean, Std of H, S, V | 6 |
| HOG | Mean, Std, Max of HOG vector | 3 |
| GLCM | Contrast, Correlation, Energy, Homogeneity (2 angles) | 8 |
| **Total** | | **17 features** |

---

## Drift Detection Thresholds

| PSI | Status | Action |
|-----|--------|--------|
| < 0.1 | Stable | Continue monitoring |
| 0.1 - 0.2 | Mild shift | Investigate |
| > 0.2 | Drift | Trigger retraining |
| > 0.5 | Severe | Immediate action |

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| ML Model | XGBoost |
| Features | OpenCV, scikit-image |
| API | Flask |
| Drift Detection | Evidently AI (PSI-based) |
| Orchestration | K3s (Lightweight Kubernetes) |
| CI/CD | GitHub Actions |
| Container | Docker |

---

## Documentation

| File | Description |
|------|-------------|
| [QUICKSTART.md](QUICKSTART.md) | 5-minute quick start |
| [INSTALL.md](INSTALL.md) | Detailed installation |
| [SETUP.md](SETUP.md) | Development setup |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture with Mermaid |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contribution guidelines |

---

Created for NT114 - MLOps Architecture Project
Department: Computer Networks and Data Communications
