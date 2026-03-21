# Development Setup Guide

Development workflow for contributing to the project.
See [INSTALL.md](INSTALL.md) for initial installation.

---

## Starting Development

### Start API

```bash
cd src
python api/index.py
# Access: http://localhost:5000
```

### Start Gradio Demo

```bash
python src/app.py
# Access: http://localhost:7860
```

### Start MLflow

```bash
mlflow server \
    --backend-store-uri sqlite:///mlflow.db \
    --default-artifact-root ./mlartifacts \
    --host 0.0.0.0 --port 5000
```

---

## Git Workflow

### Create Branch

```bash
git checkout main && git pull
git checkout -b feature/your-feature-name
```

### Commit

```bash
git add .
git commit -m "feat(scope): description

- Bullet point 1
- Bullet point 2

Closes #123"
```

### Push and PR

```bash
git push -u origin feature/your-feature-name
# Create PR on GitHub
```

See [.github/WORKFLOW.md](.github/WORKFLOW.md) for complete workflow guide.

---

## Testing

### Run All Tests

```bash
pytest tests/
```

### Run Specific Tests

```bash
pytest tests/test_api.py -v
pytest tests/test_features.py -v
```

### With Coverage

```bash
pytest tests/ --cov=src --cov-report=html
```

---

## Docker Development

### Build

```bash
docker-compose build api
docker-compose build training
docker-compose build drift
```

### Run

```bash
docker-compose up api
docker-compose up -d  # Background
```

### Logs

```bash
docker-compose logs -f api
docker-compose exec api /bin/bash
```

---

## Database

### PostgreSQL

```bash
docker-compose up -d postgres
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

## Code Quality

### Format

```bash
black src/
isort src/
```

### Lint

```bash
flake8 src/
```

---

## Troubleshooting

### Port Conflicts

```bash
lsof -i :5000
lsof -i :7860
kill -9 <PID>
```

### Reset Environment

```bash
rm -rf venv
python -m venv venv
pip install -r src/requirements.txt
```

### Docker Reset

```bash
docker-compose down -v
docker builder prune
docker-compose build --no-cache
```

---

Created for NT114 - MLOps Architecture Project
Department: Computer Networks and Data Communications
