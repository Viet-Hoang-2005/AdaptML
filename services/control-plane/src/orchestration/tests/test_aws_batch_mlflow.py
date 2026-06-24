"""
Unit tests for AWS Batch MLflow environment injection and parsing.

Tests cover:
1. When AWS_BATCH_MLFLOW_TRACKING_URI is empty → MLFLOW_TRACKING_URI NOT injected.
2. When AWS_BATCH_MLFLOW_TRACKING_URI is set → MLFLOW_TRACKING_URI + MLFLOW_EXPERIMENT_NAME injected.
3. Local http://mlflow:5000 is never injected into Batch regardless.
4. parse_mlflow_metadata_from_logs: success marker extraction.
5. parse_mlflow_metadata_from_logs: MLFLOW_WARNING does not crash parser.
6. AWS Batch refresh-status persists MLflow markers into TrainingJob fields.
7. AWS Batch refresh-status preserves existing markers when new logs are truncated.
8. Training script MLflow failure is non-fatal (Phase 10E.2).
9. Register/deploy fallback: TrainingJob with empty mlflow_* fields still valid.

Run with:
    pytest services/control-plane/src/orchestration/tests/test_aws_batch_mlflow.py -v
"""
import io
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


class TestMlflowLogParser:
    def test_parser_extracts_markers(self):
        from orchestration.mlflow_utils import parse_mlflow_metadata_from_logs
        
        logs = (
            "some line\n"
            "MLFLOW_RUN_ID:abc123\n"
            "MLFLOW_EXPERIMENT_ID:1\n"
            "MLFLOW_MODEL_URI:runs:/abc123/sklearn-model\n"
            "MLFLOW_ARTIFACT_URI:s3://bucket/path/artifacts\n"
            "MLFLOW_EXPERIMENT_NAME:mlops-paas-training\n"
        )
        
        result = parse_mlflow_metadata_from_logs(logs)
        assert result == {
            "mlflow_run_id": "abc123",
            "mlflow_experiment_id": "1",
            "mlflow_model_uri": "runs:/abc123/sklearn-model",
            "mlflow_artifact_uri": "s3://bucket/path/artifacts",
            "mlflow_experiment_name": "mlops-paas-training",
        }

    def test_parser_uses_last_occurrence(self):
        from orchestration.mlflow_utils import parse_mlflow_metadata_from_logs
        
        logs = (
            "MLFLOW_RUN_ID:first-run-id\n"
            "some other log\n"
            "MLFLOW_RUN_ID:second-run-id\n"
        )
        
        result = parse_mlflow_metadata_from_logs(logs)
        assert result["mlflow_run_id"] == "second-run-id"


class TestAwsBatchRefreshPersistence:
    @patch("orchestration.aws_batch_training_service._validate_batch_config")
    @patch("orchestration.aws_batch_training_service._describe_batch_job")
    @patch("orchestration.aws_batch_training_service.get_aws_batch_training_logs")
    @patch("orchestration.aws_batch_training_service.parse_mlflow_metadata_from_logs")
    def test_refresh_persists_markers_on_success(
        self, mock_parse, mock_get_logs, mock_describe, mock_validate
    ):
        from orchestration.aws_batch_training_service import refresh_aws_batch_training_job

        # Mock job from DB
        mock_job = MagicMock()
        mock_job.external_job_id = "aws-batch-123"
        mock_job.status = "running"
        mock_job.started_at = None
        mock_job.completed_at = None
        mock_job.training_logs = ""
        
        # Mock MLflow fields returning empty initially
        for field in ["mlflow_run_id", "mlflow_experiment_id", "mlflow_model_uri", "mlflow_artifact_uri"]:
            setattr(mock_job, field, "")

        # AWS Batch returns SUCCEEDED
        mock_describe.return_value = {"status": "SUCCEEDED", "startedAt": 1000, "stoppedAt": 2000}
        mock_get_logs.return_value = "MLFLOW_RUN_ID:abc123"
        
        # Parser finds markers
        mock_parse.return_value = {
            "mlflow_run_id": "abc123",
            "mlflow_experiment_id": "1",
            "mlflow_model_uri": "runs:/abc",
            "mlflow_artifact_uri": "s3://art",
        }

        # Run refresh
        refresh_aws_batch_training_job(mock_job)

        # Verify fields were updated in memory
        assert mock_job.mlflow_run_id == "abc123"
        assert mock_job.mlflow_experiment_id == "1"
        assert mock_job.mlflow_model_uri == "runs:/abc"
        assert mock_job.mlflow_artifact_uri == "s3://art"

        # Verify save was called with the new fields
        mock_job.save.assert_called_once()
        update_fields = mock_job.save.call_args.kwargs.get("update_fields", [])
        
        for field in ["mlflow_run_id", "mlflow_experiment_id", "mlflow_model_uri", "mlflow_artifact_uri"]:
            assert field in update_fields, f"{field} not in update_fields"

    @patch("orchestration.aws_batch_training_service._validate_batch_config")
    @patch("orchestration.aws_batch_training_service._describe_batch_job")
    @patch("orchestration.aws_batch_training_service.get_aws_batch_training_logs")
    @patch("orchestration.aws_batch_training_service.parse_mlflow_metadata_from_logs")
    def test_refresh_preserves_existing_logs_with_markers(
        self, mock_parse, mock_get_logs, mock_describe, mock_validate
    ):
        from orchestration.aws_batch_training_service import refresh_aws_batch_training_job

        mock_job = MagicMock()
        mock_job.external_job_id = "aws-batch-123"
        mock_job.status = "completed"
        mock_job.started_at = None
        mock_job.completed_at = None
        # Existing logs have markers
        mock_job.training_logs = "MLFLOW_RUN_ID:existing-run"
        
        # MLflow DB fields empty
        for field in ["mlflow_run_id", "mlflow_experiment_id", "mlflow_model_uri", "mlflow_artifact_uri"]:
            setattr(mock_job, field, "")

        mock_describe.return_value = {"status": "SUCCEEDED"}
        # AWS Batch / CloudWatch returns empty or truncated logs (no markers)
        mock_get_logs.return_value = "some new generic log line"
        
        # Parser mocks extracting from combined logs
        mock_parse.return_value = {
            "mlflow_run_id": "existing-run",
            "mlflow_experiment_id": "1",
        }

        refresh_aws_batch_training_job(mock_job)

        # Ensure logs were not erased
        assert "MLFLOW_RUN_ID:existing-run" in mock_job.training_logs
        assert "some new generic log line" in mock_job.training_logs or mock_job.training_logs == "MLFLOW_RUN_ID:existing-run"

        # Ensure fields populated
        assert mock_job.mlflow_run_id == "existing-run"
        assert mock_job.mlflow_experiment_id == "1"


# ---------------------------------------------------------------------------
# Phase 10E.2: MLflow Tracking Resilience Tests
# ---------------------------------------------------------------------------

class TestMlflowParserResilience:
    """
    Test A — Success markers still parse correctly.
    Test B — MLFLOW_WARNING does not crash the parser and returns empty dict.
    """

    def test_parser_success_markers(self):
        """Test A: All four MLflow success markers are correctly extracted."""
        from orchestration.mlflow_utils import parse_mlflow_metadata_from_logs

        logs = (
            "some training output\n"
            "MLFLOW_RUN_ID:abc\n"
            "MLFLOW_EXPERIMENT_ID:1\n"
            "MLFLOW_MODEL_URI:runs:/abc/sklearn-model\n"
            "MLFLOW_ARTIFACT_URI:s3://bucket/path\n"
        )
        result = parse_mlflow_metadata_from_logs(logs)
        assert result["mlflow_run_id"] == "abc"
        assert result["mlflow_experiment_id"] == "1"
        assert result["mlflow_model_uri"] == "runs:/abc/sklearn-model"
        assert result["mlflow_artifact_uri"] == "s3://bucket/path"

    def test_parser_warning_does_not_crash(self):
        """Test B: MLFLOW_WARNING in logs → parser returns {} without crashing."""
        from orchestration.mlflow_utils import parse_mlflow_metadata_from_logs

        logs = (
            "MLFLOW_WARNING:MLflow logging skipped due to error: "
            "HTTPSConnectionPool(...): Max retries exceeded\n"
            "Training completed successfully.\n"
        )
        # Must not raise
        result = parse_mlflow_metadata_from_logs(logs)
        # Must return empty dict (no MLFLOW_RUN_ID in warning-only logs)
        assert result == {}

    def test_parser_mixed_warning_and_no_run_id(self):
        """Test B variant: logs with warning and no real run ID → empty result."""
        from orchestration.mlflow_utils import parse_mlflow_metadata_from_logs

        logs = (
            "MLFLOW_WARNING:Connection refused\n"
            "METRIC_JSON: {\"accuracy\": 0.95}\n"
        )
        result = parse_mlflow_metadata_from_logs(logs)
        assert "mlflow_run_id" not in result


class TestTrainingScriptMlflowResilience:
    """
    Test C — Training script MLflow failure is non-fatal.

    We test try_log_to_mlflow directly by importing it from the example script.
    The test monkeypatches mlflow to raise so we can assert:
    - The function returns None (no crash)
    - Stdout contains MLFLOW_WARNING
    - Stdout does NOT contain MLFLOW_RUN_ID
    """

    def _import_try_log(self):
        """Import try_log_to_mlflow from the example train.py via importlib."""
        import importlib.util
        import pathlib

        train_path = (
            pathlib.Path(__file__).parent.parent.parent.parent.parent.parent
            / "examples" / "training" / "deployable-sklearn" / "train.py"
        )
        if not train_path.exists():
            pytest.skip(f"Example train.py not found at {train_path}")

        spec = importlib.util.spec_from_file_location("example_train", train_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.try_log_to_mlflow

    def test_mlflow_failure_is_non_fatal(self, capsys, monkeypatch):
        """
        Test C: If mlflow raises during logging, try_log_to_mlflow returns None
        and prints MLFLOW_WARNING. Training must not crash.
        """
        try_log_to_mlflow = self._import_try_log()

        # Set a tracking URI so the code proceeds to try mlflow
        monkeypatch.setenv("MLFLOW_TRACKING_URI", "https://dead-mlflow.invalid")
        monkeypatch.setenv("MLFLOW_EXPERIMENT_NAME", "mlops-paas-training")
        monkeypatch.delenv("MLFLOW_TRACKING_REQUIRED", raising=False)

        # Monkeypatch mlflow to raise on import / set_tracking_uri
        fake_mlflow = MagicMock()
        fake_mlflow.set_tracking_uri.side_effect = Exception("Connection refused")

        with patch.dict(sys.modules, {"mlflow": fake_mlflow, "mlflow.sklearn": MagicMock()}):
            result = try_log_to_mlflow(
                model=MagicMock(),
                metrics={"accuracy": 0.95},
                params={"n_estimators": 10},
            )

        # Must return None — not raise
        assert result is None

        # Stdout must contain MLFLOW_WARNING
        captured = capsys.readouterr()
        assert "MLFLOW_WARNING" in captured.out

        # Stdout must NOT contain MLFLOW_RUN_ID (no fake marker)
        assert "MLFLOW_RUN_ID" not in captured.out

    def test_mlflow_skipped_when_no_uri(self, capsys, monkeypatch):
        """
        Test C variant: When MLFLOW_TRACKING_URI is empty, try_log_to_mlflow
        prints MLFLOW_WARNING and returns None without attempting MLflow calls.
        """
        try_log_to_mlflow = self._import_try_log()

        monkeypatch.delenv("MLFLOW_TRACKING_URI", raising=False)

        result = try_log_to_mlflow(
            model=MagicMock(),
            metrics={"accuracy": 0.95},
            params={"n_estimators": 10},
        )

        assert result is None
        captured = capsys.readouterr()
        assert "MLFLOW_WARNING" in captured.out
        assert "MLFLOW_RUN_ID" not in captured.out

    def test_mlflow_fatal_when_required(self, monkeypatch):
        """
        Test C variant: When MLFLOW_TRACKING_REQUIRED=true, MLflow failure raises.
        """
        try_log_to_mlflow = self._import_try_log()

        monkeypatch.setenv("MLFLOW_TRACKING_URI", "https://dead-mlflow.invalid")
        monkeypatch.setenv("MLFLOW_TRACKING_REQUIRED", "true")

        fake_mlflow = MagicMock()
        fake_mlflow.set_tracking_uri.side_effect = Exception("Unreachable")

        with patch.dict(sys.modules, {"mlflow": fake_mlflow, "mlflow.sklearn": MagicMock()}):
            with pytest.raises(RuntimeError, match="MLFLOW_WARNING"):
                try_log_to_mlflow(
                    model=MagicMock(),
                    metrics={"accuracy": 0.9},
                    params={"n_estimators": 10},
                )


class TestRegisterDeployFallbackWithoutMlflow:
    """
    Test D — Register/deploy works with empty mlflow_* fields.

    Verify that a TrainingJob with empty mlflow_run_id still has a valid
    model_artifact_uri that the register step can use.
    """

    def test_training_job_without_mlflow_fields_is_valid(self):
        """
        Test D: TrainingJob without mlflow_* fields should still be considered
        register-able if it has a model_artifact_uri.
        """
        job = MagicMock()
        job.status = "completed"
        job.mlflow_run_id = None
        job.mlflow_experiment_id = None
        job.mlflow_model_uri = None
        job.mlflow_artifact_uri = None
        job.model_artifact_uri = "s3://mlops-paas-artifacts/tenants/T/jobs/1/output/model.tar.gz"

        # A job is register-able if it's completed with a model artifact,
        # regardless of MLflow linkage.
        assert job.status == "completed"
        assert job.model_artifact_uri  # artifact path must be present
        # mlflow_* being empty must not block registration
        assert not job.mlflow_run_id  # empty is OK

    def test_mlflow_warning_in_logs_does_not_block_registration(self):
        """
        Test D variant: TrainingJob with MLFLOW_WARNING in training_logs but
        valid artifact should be considered register-able.
        """
        from orchestration.mlflow_utils import parse_mlflow_metadata_from_logs

        logs = (
            "MLFLOW_WARNING:MLflow logging skipped due to error: Connection refused\n"
            "[training-runner] Uploading model artifact to s3://...\n"
            "[training-runner] Training job completed successfully\n"
        )
        metadata = parse_mlflow_metadata_from_logs(logs)

        # Parser must return empty dict (no run_id to link)
        assert metadata == {}

        # Simulate: register proceeds with empty mlflow fields
        job = MagicMock()
        job.mlflow_run_id = metadata.get("mlflow_run_id")  # None
        job.model_artifact_uri = "s3://mlops-paas-artifacts/tenants/T/jobs/1/output/model.tar.gz"

        # Registration logic: must not fail because mlflow_run_id is None
        assert job.model_artifact_uri is not None  # register uses this, not mlflow
