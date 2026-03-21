# Contributing Guide

Guidelines for contributing to the MLOps Weather Classification System.

---

## Team

| Name | Email | Role |
|------|-------|------|
| Viet Hoang | 23520541@gm.uit.edu.vn | API, Drift Detection |
| Thai | 23521412@gm.uit.edu.vn | DevOps, Infrastructure |

---

## Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run tests: `pytest tests/`
5. Commit: `git commit -m "feat(scope): description"`
6. Push: `git push -u origin feature/your-feature`
7. Create Pull Request

---

## Branch Naming

```
feature/add-drift-detection
fix/api-timeout-error
docs/update-readme
chore/update-dependencies
```

---

## Commit Messages

```
feat(api): add prediction logging

- Log timestamp, features, prediction
- Store features as JSONB

Closes #42
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

---

## Pull Request Checklist

- [ ] Code follows style guidelines
- [ ] Tests pass locally
- [ ] Branch is up to date with main
- [ ] Related issue linked

See [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) for PR template.

---

## Code Standards

- Follow PEP 8
- Add type hints where applicable
- Write docstrings for functions
- No `console.log` or debug statements

---

## Testing

```bash
pytest tests/                    # All tests
pytest tests/test_api.py -v     # Specific test
pytest tests/ --cov=src        # With coverage
```

---

## Issues

Bug reports: [.github/ISSUE_TEMPLATE/ISSUE_BUG.md](.github/ISSUE_TEMPLATE/ISSUE_BUG.md)
Feature requests: [.github/ISSUE_TEMPLATE/ISSUE_FEATURE.md](.github/ISSUE_TEMPLATE/ISSUE_FEATURE.md)

---

## Questions

Email: 23520541@gm.uit.edu.vn or 23521412@gm.uit.edu.vn

---

Created for NT114 - MLOps Architecture Project
Department: Computer Networks and Data Communications
