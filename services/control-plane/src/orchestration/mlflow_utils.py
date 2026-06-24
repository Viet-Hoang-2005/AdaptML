"""
mlflow_utils.py
---------------
Phase 10E.1: Shared MLflow log parser and URL builder helpers.

These utilities are used by:
- local_training_service.py
- aws_batch_training_service.py
- registry_service.py

Architecture note:
  MLflow is used exclusively for experiment lineage (run id, params, metrics,
  artifact deep-dive links). The Native Registry (ModelFamily / ModelVersion /
  ModelDeploymentHistory) remains the platform source of truth for tenant
  ownership, deployment state, and production promotion.

URL constants:
  - Container/internal: MLFLOW_TRACKING_URI  (e.g. http://mlflow:5000)
  - Browser/external:   MLFLOW_UI_URL        (e.g. http://localhost:5001)

Do NOT use MLFLOW_TRACKING_URI for browser links.
Do NOT use MLFLOW_UI_URL inside training containers.
"""

from __future__ import annotations

import re
from typing import Optional

from django.conf import settings

# ── Regex patterns for MLflow metadata markers in training log stdout ────────
#
# Supported formats (all case-insensitive on the key, not the value):
#   MLFLOW_RUN_ID:<id>
#   MLFLOW_RUN_ID: <id>
#   MLFLOW_RUN_ID=<id>
#   mlflow_run_id=<id>
#
# The value is captured as a non-whitespace token.

_PATTERNS: dict[str, re.Pattern] = {
    "mlflow_run_id": re.compile(
        r"(?i)MLFLOW_RUN_ID\s*[=:]\s*(\S+)"
    ),
    "mlflow_experiment_id": re.compile(
        r"(?i)MLFLOW_EXPERIMENT_ID\s*[=:]\s*(\S+)"
    ),
    "mlflow_experiment_name": re.compile(
        r"(?i)MLFLOW_EXPERIMENT_NAME\s*[=:]\s*(\S+)"
    ),
    "mlflow_model_uri": re.compile(
        r"(?i)MLFLOW_MODEL_URI\s*[=:]\s*(\S+)"
    ),
    "mlflow_artifact_uri": re.compile(
        r"(?i)MLFLOW_ARTIFACT_URI\s*[=:]\s*(\S+)"
    ),
}


def parse_mlflow_metadata_from_logs(log_text: Optional[str]) -> dict:
    """
    Parse MLflow run metadata markers from training job stdout/stderr logs.

    Returns a dict of whichever fields are found; absent keys are not included.
    Always safe to call — returns {} for empty/None input.

    Supported output markers in training scripts:
        print(f"MLFLOW_RUN_ID:{run.info.run_id}")
        print(f"MLFLOW_EXPERIMENT_ID:{run.info.experiment_id}")
        print(f"MLFLOW_MODEL_URI:runs:/{run.info.run_id}/model")
        print(f"MLFLOW_ARTIFACT_URI:{mlflow.get_artifact_uri()}")

    If a marker appears multiple times, the LAST valid value wins.
    """
    patterns = {
        "mlflow_run_id": r"(?i)MLFLOW_RUN_ID:\s*(\S+)",
        "mlflow_experiment_id": r"(?i)MLFLOW_EXPERIMENT_ID:\s*(\S+)",
        "mlflow_model_uri": r"(?i)MLFLOW_MODEL_URI:\s*(\S+)",
        "mlflow_artifact_uri": r"(?i)MLFLOW_ARTIFACT_URI:\s*(\S+)",
        "mlflow_experiment_name": r"(?i)MLFLOW_EXPERIMENT_NAME:\s*(\S+)",
    }

    result: dict[str, str] = {}
    if not log_text:
        return result
        
    for field, pattern in patterns.items():
        matches = re.findall(pattern, log_text)
        if matches:
            # Take the last match (most recent line in logs).
            value = matches[-1].strip()
            if value:
                result[field] = value
    return result


def build_mlflow_run_url(
    run_id: Optional[str],
    experiment_id: Optional[str],
) -> Optional[str]:
    """
    Construct a browser-safe MLflow deep-link URL using MLFLOW_UI_URL.

    Returns None if run_id is not available.
    If experiment_id is also available, returns a direct run URL.
    If only run_id is known, returns a generic UI URL (user can search).

    Format: {MLFLOW_UI_URL}/#/experiments/{experiment_id}/runs/{run_id}

    IMPORTANT: This uses settings.MLFLOW_UI_URL (browser URL, e.g. localhost:5001),
    NOT MLFLOW_TRACKING_URI (container URL, e.g. mlflow:5000).
    """
    if not run_id:
        return None

    ui_url = getattr(settings, "MLFLOW_UI_URL", "http://localhost:5001").rstrip("/")

    if experiment_id:
        return f"{ui_url}/#/experiments/{experiment_id}/runs/{run_id}"

    # Fallback: link to the UI root so user can search by run id manually.
    return f"{ui_url}/#/runs/{run_id}"
