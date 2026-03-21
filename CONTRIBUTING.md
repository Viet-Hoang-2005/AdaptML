# Contributing to MLOps Weather Classification System

Thank you for your interest in contributing to this project.

---

## Getting Started

### Prerequisites

- Python 3.10 or higher
- Git
- Docker (optional, for containerized development)
- Kaggle account (for dataset access)

### Development Workflow

1. **Fork the repository**
2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/MLOps-weather-system.git
   cd MLOps-weather-system
   ```
3. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Make your changes**
5. **Run tests**
   ```bash
   pytest tests/
   ```
6. **Commit and push**
   ```bash
   git commit -m "Add: your feature description"
   git push origin feature/your-feature-name
   ```
7. **Create a Pull Request**

---

## Code Style

### Python

- Follow PEP 8 guidelines
- Use type hints where applicable
- Write docstrings for all functions and classes

Example:
```python
def extract_features(image_path: str) -> np.ndarray:
    """
    Extract 17 features from an image.

    Args:
        image_path: Path to the image file

    Returns:
        numpy array of shape (17,) containing features
    """
    pass
```

### Git Commit Messages

Follow conventional commits format:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Adding or updating tests
- `chore:` Maintenance tasks

Example:
```
feat(api): add health check endpoint

Add GET /health endpoint for Kubernetes readiness probes.
```

---

## Project Structure

### Where to Make Changes

| Component | Location | Notes |
|-----------|----------|-------|
| API Server | `src/api/index.py` | Flask endpoints |
| Feature Extraction | `src/api/index.py` | `extract_features()` function |
| Training | `src/training/train.py` | XGBoost training logic |
| Drift Detection | `src/drift_detection/detect_drift.py` | PSI calculations |
| Reference Data | `src/extract_reference_data.py` | Baseline dataset creation |
| CI/CD | `.github/workflows/` | GitHub Actions pipelines |
| Infrastructure | `infra/` | Terraform configurations |

---

## Testing

### Running Tests

```bash
# Run all tests
pytest tests/

# Run with coverage
pytest tests/ --cov=src

# Run specific test file
pytest tests/test_api.py -v
```

### Writing Tests

Place tests in the `tests/` directory:

```
tests/
|-- __init__.py
|-- test_api.py
|-- test_features.py
|-- test_drift.py
```

Example test:
```python
import pytest
import numpy as np
from src.api.index import extract_features

def test_extract_features_shape():
    """Test that extract_features returns correct shape."""
    # Create dummy image
    dummy_image = np.zeros((256, 256, 3), dtype=np.uint8)
    features = extract_features(dummy_image)
    assert features.shape == (17,)
```

---

## Feature Extraction Standards

When modifying feature extraction, ensure consistency across all components:

### Feature Order (17 features total)

1. **Color Moments (HSV)** - 6 features
   - mean_H, mean_S, mean_V
   - std_H, std_S, std_V

2. **HOG** - 3 features
   - hog_mean, hog_std, hog_max

3. **GLCM** - 8 features
   - glcm_contrast_0, glcm_contrast_90
   - glcm_correlation_0, glcm_correlation_90
   - glcm_energy_0, glcm_energy_90
   - glcm_homogeneity_0, glcm_homogeneity_90

### Synchronization Checklist

When changing feature extraction:
- [ ] `src/api/index.py` - API feature extraction
- [ ] `src/training/train.py` - Training feature extraction
- [ ] `src/extract_reference_data.py` - Reference data generation
- [ ] `data/reference_data.csv` - Regenerate reference dataset
- [ ] Tests updated
- [ ] Documentation updated

---

## Docker Development

### Building Images

```bash
# Build API image
docker build -t weather-api -f src/api/Dockerfile .

# Build training image
docker build -t weather-training -f src/training/Dockerfile .

# Build drift detection image
docker build -t weather-drift -f src/drift_detection/Dockerfile .
```

### Running with Docker Compose

```bash
# Start all services
docker-compose up --build

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

---

## Documentation

### Updating Documentation

When adding new features:

1. Update `README.md` with usage instructions
2. Add API documentation to `docs/API.md`
3. Update `ARCHITECTURE.md` if architecture changed
4. Add inline code comments for complex logic

### Documentation Format

- Use Markdown for all documentation
- Include code examples where applicable
- Add diagrams for architectural changes

---

## Reporting Issues

### Bug Reports

Include:
- Python version
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Error messages and stack traces

### Feature Requests

Include:
- Use case description
- Proposed solution
- Alternative solutions considered

---

## Questions

For questions or discussions:
- Open an issue with the `question` label
- Email: [your-email@example.com]

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

## Acknowledgments

- CS231 Computer Vision Course - Original model development
- Evidently AI - Drift detection framework
- XGBoost - Gradient boosting implementation
