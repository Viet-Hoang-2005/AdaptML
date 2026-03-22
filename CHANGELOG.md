# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.0] - 2026-03-XX

### Added

- Initial MLOps Weather Classification System
- Flask API for weather prediction
- XGBoost model with Color + HOG + GLCM features (17 features)
- Gradio demo interface
- Drift detection with PSI (Population Stability Index)
- GitHub Actions CI/CD pipeline
- Docker and Docker Compose support
- Terraform infrastructure for AWS
- Reference data extraction script
- Model training pipeline

### Features

- Real-time weather classification (Haze/Rain/Shine)
- Automated drift detection and retraining
- Zero-downtime deployment with Kubernetes
- Feature distribution monitoring

### Components

- `src/api/` - Flask REST API
- `src/training/` - XGBoost training pipeline
- `src/drift_detection/` - Evidently AI drift detection
- `src/app.py` - Gradio demo interface
- `.github/workflows/` - CI/CD pipelines

---

## [Unreleased]

### Planned

- FastAPI migration for better async support
- Real-time streaming drift detection
- Multi-model ensemble support
- Federated learning integration
- Cost-aware retraining scheduler
- Real-world edge device deployment

---

## Versioning

This project uses [Semantic Versioning](https://semver.org/).

Format: `MAJOR.MINOR.PATCH`

- MAJOR: Breaking changes
- MINOR: New features, backward compatible
- PATCH: Bug fixes, backward compatible

---

Created for NT114 - MLOps Architecture Project
Department: Computer Networks and Data Communications
