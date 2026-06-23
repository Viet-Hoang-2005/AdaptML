import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import venv
from pathlib import Path

from django.conf import settings
from rest_framework.exceptions import ValidationError

from authentication.models import TrainingJob
from .mlflow_utils import build_mlflow_run_url, parse_mlflow_metadata_from_logs
from .sagemaker_service import (
    _safe_extract_zip,
    _s3_client,
    _s3_uri,
    _write_field_file_to_path,
    get_training_job_prefix,
    upload_training_inputs_to_s3,
)

MAX_LOG_CHARS = 6000


def _short_log(stdout: str, stderr: str) -> str:
    combined = "\n".join(
        part
        for part in [
            "STDOUT:",
            stdout.strip(),
            "STDERR:",
            stderr.strip(),
        ]
        if part
    ).strip()
    if len(combined) <= MAX_LOG_CHARS:
        return combined
    return combined[-MAX_LOG_CHARS:]


def _directory_size_bytes(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def _create_model_archive(model_dir: Path, archive_path: Path) -> None:
    files = [item for item in model_dir.rglob("*") if item.is_file()]
    if not files:
        raise ValidationError({"error": "Training completed but SM_MODEL_DIR does not contain any model files."})

    max_bytes = settings.LOCAL_TRAINING_MAX_OUTPUT_MB * 1024 * 1024
    output_size = _directory_size_bytes(model_dir)
    if output_size > max_bytes:
        raise ValidationError(
            {"error": f"Local training output exceeds {settings.LOCAL_TRAINING_MAX_OUTPUT_MB}MB."}
        )

    with tarfile.open(archive_path, "w:gz") as archive:
        for item in model_dir.rglob("*"):
            archive.add(item, arcname=item.relative_to(model_dir))


def _prepare_python(source_dir: Path, workspace: Path, requirements_file) -> str:
    if not requirements_file or not settings.LOCAL_TRAINING_ALLOW_PIP_INSTALL:
        return sys.executable

    requirements_path = source_dir / "requirements.txt"
    _write_field_file_to_path(requirements_file, requirements_path)

    venv_dir = workspace / "venv"
    venv.EnvBuilder(with_pip=True).create(venv_dir)
    python_path = venv_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

    install = subprocess.run(
        [str(python_path), "-m", "pip", "install", "-r", str(requirements_path)],
        cwd=str(source_dir),
        capture_output=True,
        text=True,
        timeout=settings.LOCAL_TRAINING_TIMEOUT,
    )
    if install.returncode != 0:
        raise RuntimeError(f"Failed to install requirements.\n{_short_log(install.stdout, install.stderr)}")

    return str(python_path)


def run_local_training_job(training_job: TrainingJob) -> dict:
    # Local fallback executes uploaded code in-process on the control-plane host.
    # Use only for trusted demo/dev workloads, not production multi-tenant sandboxing.
    _, _, prefix = upload_training_inputs_to_s3(training_job)
    training_job.status = "running"
    training_job.error_message = ""
    training_job.stop_reason = ""
    training_job.sagemaker_job_name = ""
    training_job.output_s3_uri = _s3_uri(settings.AWS_STORAGE_BUCKET_NAME, f"{prefix}/output/local/")
    training_job.mark_started(save=False)
    training_job.save(
        update_fields=[
            "status",
            "error_message",
            "stop_reason",
            "sagemaker_job_name",
            "output_s3_uri",
            "started_at",
            "updated_at",
        ]
    )

    workspace = Path(tempfile.mkdtemp(prefix=f"local-training-job-{training_job.id}-"))
    try:
        source_zip_path = workspace / "source.zip"
        source_dir = workspace / "source"
        input_train_dir = workspace / "input" / "train"
        model_dir = workspace / "model"
        output_dir = workspace / "output"

        source_dir.mkdir(parents=True, exist_ok=True)
        input_train_dir.mkdir(parents=True, exist_ok=True)
        model_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)

        _write_field_file_to_path(training_job.source_zip, source_zip_path)
        _safe_extract_zip(source_zip_path, source_dir)
        _write_field_file_to_path(training_job.training_data, input_train_dir / "train.csv")

        entry_point_path = source_dir / training_job.entry_point.strip()
        if not entry_point_path.exists() or not entry_point_path.is_file():
            raise ValidationError(
                {
                    "error": (
                        "Source zip must contain the configured entry point. "
                        f"Could not find '{training_job.entry_point}'."
                    )
                }
            )

        python_path = _prepare_python(source_dir, workspace, training_job.requirements_file)
        env = os.environ.copy()
        env.update(
            {
                "SM_CHANNEL_TRAIN": str(input_train_dir),
                "SM_MODEL_DIR": str(model_dir),
                "SM_OUTPUT_DIR": str(output_dir),
                "MODEL_VERSION": training_job.model_version,
                "AWS_BUCKET_NAME": settings.AWS_STORAGE_BUCKET_NAME,
                "TRAINING_JOB_ID": str(training_job.id),
            }
        )
        # Phase 10E.1: Inject MLflow env into local training if configured.
        # Uses the container-facing MLFLOW_TRACKING_URI (http://mlflow:5000),
        # NOT the browser-facing MLFLOW_UI_URL. Never fails if MLflow is absent.
        _local_mlflow_uri = getattr(settings, "MLFLOW_TRACKING_URI", "").strip()
        _local_mlflow_exp = getattr(settings, "MLFLOW_EXPERIMENT_NAME", "").strip()
        if _local_mlflow_uri:
            env["MLFLOW_TRACKING_URI"] = _local_mlflow_uri
        if _local_mlflow_exp:
            env.setdefault("MLFLOW_EXPERIMENT_NAME", _local_mlflow_exp)

        result = subprocess.run(
            [python_path, str(entry_point_path)],
            cwd=str(source_dir),
            env=env,
            capture_output=True,
            text=True,
            timeout=min(settings.LOCAL_TRAINING_TIMEOUT, training_job.max_runtime_seconds),
        )
        if result.returncode != 0:
            raise RuntimeError(_short_log(result.stdout, result.stderr))

        training_logs = _short_log(result.stdout, result.stderr)
        archive_path = workspace / "model.tar.gz"
        _create_model_archive(model_dir, archive_path)

        artifact_key = f"{prefix}/output/local/model.tar.gz"
        _s3_client().upload_file(str(archive_path), settings.AWS_STORAGE_BUCKET_NAME, artifact_key)
        artifact_uri = _s3_uri(settings.AWS_STORAGE_BUCKET_NAME, artifact_key)

        training_job.status = "completed"
        training_job.error_message = ""
        training_job.training_logs = training_logs
        training_job.model_artifact_uri = artifact_uri
        training_job.stop_reason = ""
        training_job.mark_finished(save=False)

        # Phase 10E.1: Parse MLflow metadata from stdout and persist to TrainingJob.
        _mlflow_meta = parse_mlflow_metadata_from_logs(training_logs)
        _mlflow_fields_to_save = []
        for _field, _value in _mlflow_meta.items():
            if _value and not getattr(training_job, _field, None):
                setattr(training_job, _field, _value)
                _mlflow_fields_to_save.append(_field)
        # Store the tracking URI we used, for audit.
        if _local_mlflow_uri and not training_job.mlflow_tracking_uri:
            training_job.mlflow_tracking_uri = _local_mlflow_uri
            _mlflow_fields_to_save.append("mlflow_tracking_uri")

        training_job.save(
            update_fields=[
                "status",
                "error_message",
                "training_logs",
                "model_artifact_uri",
                "completed_at",
                "runtime_seconds",
                "stop_reason",
                "updated_at",
            ] + _mlflow_fields_to_save
        )

        return {
            "status": training_job.status,
            "model_artifact_uri": artifact_uri,
            "output_s3_uri": training_job.output_s3_uri,
        }
    except Exception as exc:
        training_job.status = "failed"
        training_job.error_message = str(exc)
        training_job.training_logs = str(exc)
        training_job.stop_reason = str(exc)
        training_job.mark_finished(training_job.stop_reason, save=False)
        training_job.save(
            update_fields=[
                "status",
                "error_message",
                "training_logs",
                "completed_at",
                "runtime_seconds",
                "stop_reason",
                "updated_at",
            ]
        )
        raise
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
