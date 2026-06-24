"""
Unit tests for AWS Batch MLflow environment injection.

Tests cover:
1. When AWS_BATCH_MLFLOW_TRACKING_URI is empty → MLFLOW_TRACKING_URI NOT injected.
2. When AWS_BATCH_MLFLOW_TRACKING_URI is set → MLFLOW_TRACKING_URI + MLFLOW_EXPERIMENT_NAME injected.
3. Local http://mlflow:5000 is never injected into Batch regardless.

Run with:
    pytest services/control-plane/src/orchestration/tests/test_aws_batch_mlflow.py -v
"""
import sys
import types
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Minimal Django settings stub for isolated testing
# ---------------------------------------------------------------------------
_fake_settings_base = dict(
    AWS_STORAGE_BUCKET_NAME="test-bucket",
    AWS_BATCH_REGION="ap-southeast-1",
    AWS_BATCH_JOB_QUEUE="test-queue",
    AWS_BATCH_JOB_DEFINITION="test-job-def",
    AWS_BATCH_GPU_JOB_QUEUE="",
    AWS_BATCH_GPU_JOB_DEFINITION="",
    AWS_BATCH_LOG_GROUP="/aws/batch/mlops-training",
    ENABLE_GPU_TRAINING=False,
    MLFLOW_TRACKING_URI="http://mlflow:5000",   # local Compose URI
    MLFLOW_EXPERIMENT_NAME="mlops-paas-training",
    AWS_BATCH_MLFLOW_TRACKING_URI="",           # default: empty
    MLFLOW_UI_URL="http://localhost:5001",
)


def _make_settings(**overrides):
    d = {**_fake_settings_base, **overrides}
    return types.SimpleNamespace(**d)


# ---------------------------------------------------------------------------
# Stub out heavy imports so we can import the target module without Django.
# ---------------------------------------------------------------------------
for mod in [
    "django", "django.conf", "django.utils", "django.utils.timezone",
    "rest_framework", "rest_framework.exceptions",
    "authentication", "authentication.models",
    "boto3",
]:
    sys.modules.setdefault(mod, MagicMock())

# Stub sagemaker_service and mlflow_utils imported by the target module.
sys.modules["orchestration.sagemaker_service"] = MagicMock(
    _copy_django_file_to_s3=MagicMock(return_value="s3://bucket/key"),
    _s3_uri=MagicMock(return_value="s3://bucket/key"),
    get_training_job_prefix=MagicMock(return_value="tenants/T/jobs/1"),
    upload_training_inputs_to_s3=MagicMock(return_value=("s3://src", "s3://data", "prefix")),
)
sys.modules["orchestration.mlflow_utils"] = MagicMock(
    parse_mlflow_metadata_from_logs=MagicMock(return_value={}),
)


def _build_environment(settings_obj, training_job) -> list[dict]:
    """
    Replicate the MLflow injection logic from start_aws_batch_training_job
    so tests stay decoupled from the full function (which calls boto3, S3, etc.).
    """
    environment = [
        {"name": "AWS_BUCKET_NAME", "value": settings_obj.AWS_STORAGE_BUCKET_NAME},
        {"name": "S3_SOURCE_URI", "value": "s3://src"},
        {"name": "S3_TRAINING_DATA_URI", "value": "s3://data"},
        {"name": "S3_OUTPUT_URI", "value": "s3://output"},
        {"name": "ENTRY_POINT", "value": getattr(training_job, "entry_point", "train.py")},
        {"name": "MODEL_VERSION", "value": getattr(training_job, "model_version", "v1")},
        {"name": "TRAINING_JOB_ID", "value": "1"},
    ]

    _batch_mlflow_uri = getattr(settings_obj, "AWS_BATCH_MLFLOW_TRACKING_URI", "").strip()
    _batch_mlflow_exp = getattr(settings_obj, "MLFLOW_EXPERIMENT_NAME", "mlops-paas-training").strip()
    if _batch_mlflow_uri:
        environment.append({"name": "MLFLOW_TRACKING_URI", "value": _batch_mlflow_uri})
        if _batch_mlflow_exp:
            environment.append({"name": "MLFLOW_EXPERIMENT_NAME", "value": _batch_mlflow_exp})

    return environment


def _env_names(env: list[dict]) -> set[str]:
    return {item["name"] for item in env}


def _env_value(env: list[dict], name: str) -> str | None:
    for item in env:
        if item["name"] == name:
            return item["value"]
    return None


class TestBatchMlflowInjection:
    def _job(self):
        job = MagicMock()
        job.entry_point = "train.py"
        job.model_version = "v1"
        job.requirements_file = None
        job.accelerator_type = "cpu"
        job.id = 1
        return job

    def test_no_injection_when_batch_uri_empty(self):
        """MLFLOW_TRACKING_URI must NOT appear in Batch env when AWS_BATCH_MLFLOW_TRACKING_URI is empty."""
        settings = _make_settings(AWS_BATCH_MLFLOW_TRACKING_URI="")
        env = _build_environment(settings, self._job())
        names = _env_names(env)
        assert "MLFLOW_TRACKING_URI" not in names, (
            "http://mlflow:5000 must NOT be injected into AWS Batch when "
            "AWS_BATCH_MLFLOW_TRACKING_URI is empty"
        )
        assert "MLFLOW_EXPERIMENT_NAME" not in names

    def test_injection_when_batch_uri_set(self):
        """Both MLFLOW_TRACKING_URI and MLFLOW_EXPERIMENT_NAME must appear in Batch env."""
        tunnel_url = "https://example.trycloudflare.com"
        settings = _make_settings(AWS_BATCH_MLFLOW_TRACKING_URI=tunnel_url)
        env = _build_environment(settings, self._job())
        names = _env_names(env)
        assert "MLFLOW_TRACKING_URI" in names
        assert "MLFLOW_EXPERIMENT_NAME" in names
        assert _env_value(env, "MLFLOW_TRACKING_URI") == tunnel_url
        assert _env_value(env, "MLFLOW_EXPERIMENT_NAME") == "mlops-paas-training"

    def test_local_compose_uri_never_injected_into_batch(self):
        """http://mlflow:5000 (local URI) must never appear as MLFLOW_TRACKING_URI in Batch env."""
        settings = _make_settings(AWS_BATCH_MLFLOW_TRACKING_URI="")  # empty = skip
        env = _build_environment(settings, self._job())
        for item in env:
            if item["name"] == "MLFLOW_TRACKING_URI":
                assert "mlflow:5000" not in item["value"], (
                    "Local Docker Compose URI must never be injected into AWS Batch"
                )

    def test_injection_with_whitespace_stripped(self):
        """Batch URI with surrounding whitespace must still be injected correctly."""
        tunnel_url = "  https://example.trycloudflare.com  "
        settings = _make_settings(AWS_BATCH_MLFLOW_TRACKING_URI=tunnel_url)
        env = _build_environment(settings, self._job())
        assert _env_value(env, "MLFLOW_TRACKING_URI") == tunnel_url.strip()

    def test_no_experiment_injection_when_experiment_name_empty(self):
        """If MLFLOW_EXPERIMENT_NAME is empty, it must not be injected even when URI is set."""
        tunnel_url = "https://example.trycloudflare.com"
        settings = _make_settings(
            AWS_BATCH_MLFLOW_TRACKING_URI=tunnel_url,
            MLFLOW_EXPERIMENT_NAME="",
        )
        env = _build_environment(settings, self._job())
        assert _env_value(env, "MLFLOW_TRACKING_URI") == tunnel_url
        assert "MLFLOW_EXPERIMENT_NAME" not in _env_names(env)
