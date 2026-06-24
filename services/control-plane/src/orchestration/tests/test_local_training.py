"""
Unit tests for orchestration.local_training_service._resolve_requirements_path

These tests are standalone (no Django DB needed) – run with:
    pytest services/control-plane/src/orchestration/tests/test_local_training.py -v
"""
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Import the target function WITHOUT Django setup
# ---------------------------------------------------------------------------
# We monkey-patch django.conf.settings before importing so the module loads.
_fake_settings = types.SimpleNamespace(
    LOCAL_TRAINING_ALLOW_PIP_INSTALL=True,
    LOCAL_TRAINING_TIMEOUT=300,
    LOCAL_TRAINING_MAX_OUTPUT_MB=500,
    AWS_STORAGE_BUCKET_NAME="test-bucket",
    MLFLOW_TRACKING_URI="http://mlflow:5000",
    MLFLOW_EXPERIMENT_NAME="test-experiment",
)
sys.modules.setdefault("django", MagicMock())
sys.modules.setdefault("django.conf", MagicMock(settings=_fake_settings))
sys.modules.setdefault("django.core", MagicMock())
sys.modules.setdefault("rest_framework", MagicMock())
sys.modules.setdefault("rest_framework.exceptions", MagicMock())
sys.modules.setdefault("authentication", MagicMock())
sys.modules.setdefault("authentication.models", MagicMock())
# Stub out heavy imports used at module level
sys.modules.setdefault("orchestration.sagemaker_service", MagicMock(
    _safe_extract_zip=MagicMock(),
    _s3_client=MagicMock(),
    _s3_uri=MagicMock(return_value="s3://bucket/key"),
    _write_field_file_to_path=MagicMock(),
    get_training_job_prefix=MagicMock(return_value="tenants/T-1/jobs/1"),
    upload_training_inputs_to_s3=MagicMock(return_value=("uri", "uri", "prefix")),
))
sys.modules.setdefault("orchestration.mlflow_utils", MagicMock(
    parse_mlflow_metadata_from_logs=MagicMock(return_value={}),
    build_mlflow_run_url=MagicMock(return_value=None),
))

# NOW import the function under test
from orchestration.local_training_service import _resolve_requirements_path  # noqa: E402


class TestResolveRequirementsPath:
    """Tests for _resolve_requirements_path with 3-level priority."""

    def test_priority1_uploaded_field_exists_on_disk(self, tmp_path):
        """Priority 1: uploaded FieldFile whose backing file exists."""
        uploaded = tmp_path / "uploaded_reqs.txt"
        uploaded.write_text("numpy\n")

        field_mock = MagicMock()
        field_mock.name = "uploaded_reqs.txt"
        field_mock.storage.path.return_value = str(uploaded)

        source_dir = tmp_path / "source"
        source_dir.mkdir()

        result = _resolve_requirements_path(source_dir, field_mock)
        assert result == uploaded

    def test_priority1_uploaded_field_missing_on_disk_falls_to_priority2(self, tmp_path):
        """Priority 1 FieldFile exists in DB but not on disk → fall to priority 2."""
        field_mock = MagicMock()
        field_mock.name = "ghost_reqs.txt"
        field_mock.storage.path.return_value = str(tmp_path / "DOES_NOT_EXIST.txt")

        source_dir = tmp_path / "source"
        source_dir.mkdir()
        source_reqs = source_dir / "requirements.txt"
        source_reqs.write_text("pandas\n")

        result = _resolve_requirements_path(source_dir, field_mock)
        assert result == source_reqs

    def test_priority2_source_requirements_no_upload(self, tmp_path):
        """Priority 2: no upload, requirements.txt inside source dir."""
        source_dir = tmp_path / "source"
        source_dir.mkdir()
        source_reqs = source_dir / "requirements.txt"
        source_reqs.write_text("sklearn\n")

        result = _resolve_requirements_path(source_dir, None)
        assert result == source_reqs

    def test_priority3_no_requirements_at_all(self, tmp_path):
        """Priority 3: nothing found → returns None, no exception raised."""
        source_dir = tmp_path / "source"
        source_dir.mkdir()

        result = _resolve_requirements_path(source_dir, None)
        assert result is None

    def test_priority3_empty_field_name(self, tmp_path):
        """FieldFile with blank name treated same as no upload."""
        field_mock = MagicMock()
        field_mock.name = ""  # blank name → falsy

        source_dir = tmp_path / "source"
        source_dir.mkdir()

        result = _resolve_requirements_path(source_dir, field_mock)
        assert result is None

    def test_priority1_storage_raises_falls_to_priority2(self, tmp_path):
        """If storage.path() raises (e.g. S3 backend), fall to priority 2."""
        field_mock = MagicMock()
        field_mock.name = "reqs.txt"
        field_mock.storage.path.side_effect = NotImplementedError("S3 storage")

        source_dir = tmp_path / "source"
        source_dir.mkdir()
        source_reqs = source_dir / "requirements.txt"
        source_reqs.write_text("torch\n")

        result = _resolve_requirements_path(source_dir, field_mock)
        assert result == source_reqs


class TestMlflowParser:
    """Smoke tests for parse_mlflow_metadata_from_logs (via import)."""

    def test_parser_import_and_delegate(self):
        """Parser is importable and returns a dict from the mock."""
        from orchestration.mlflow_utils import parse_mlflow_metadata_from_logs
        result = parse_mlflow_metadata_from_logs("MLFLOW_RUN_ID:abc")
        assert isinstance(result, dict)
