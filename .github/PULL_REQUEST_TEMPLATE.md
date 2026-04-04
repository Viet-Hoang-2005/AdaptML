# Pull Request Template

## Description

- Optimize the performance of the XGBoost algorithm and balance data flow in model training.
- Develop a script to detect data drift by comparing reference data and production data in PostgreSQL.
- Develop a script to compare model versions during updates and new version deployments.
- Rebuild the CI/CD pipeline.

## Type of Change

<!-- Mark the appropriate box with an [x] -->

- [x] `feat` - New feature
- [ ] `fix` - Bug fix
- [x] `docs` - Documentation changes
- [ ] `refactor` - Code refactoring (no functional change)
- [x] `test` - Adding or updating tests
- [x] `chore` - Maintenance tasks (deps, config, CI/CD)

## Related Issue

<!-- Link to the related issue using keywords: "Closes #", "Fixes #", "Relates to #" -->

Closes #

## Testing

<!-- Describe testing performed -->

- [x] Unit tests added/updated
- [x] Integration tests added/updated
- [x] Manual testing performed

**Testing steps:**

1. API + PostgreSQL: docker-compose up --build
2. Load Testing: locust -f web/src/locustfile.py --host=http://localhost:5000
3. Data Drift: python monitoring/detect_drift.py

## Checklist

<!-- Make sure all applicable items are checked -->

- [x] Code follows project style guidelines
- [x] Self-review completed
- [x] Code commented where necessary
- [x] Documentation updated (if applicable)
- [ ] No console.log or debug statements left
- [x] Branch is up to date with main

## Screenshots (if applicable)

<!-- Add screenshots for UI changes -->

## Additional Notes

<!-- Any other information reviewers should know -->

## Reviewer Checklist

<!-- For reviewers only -->

- [x] Code is well-structured and readable
- [x] Tests are adequate and passing
- [ ] Documentation is accurate
- [ ] No breaking changes without justification
- [x] Changes align with project architecture

---

**PR Info:**

- Branch: feature/workflow-for-nids-model
- Author: Viet-Hoang-2005
- Created: 19-03-2026
