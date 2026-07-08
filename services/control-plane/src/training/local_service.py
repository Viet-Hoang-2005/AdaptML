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
from training.s3_storage_service import (
    _safe_extract_zip,
    _s3_client,
    _s3_uri,
    _split_s3_uri,
    upload_training_inputs_to_s3,
)
from training.tracking_ingestion_service import ingest_training_job_tracking

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


def _prepare_python(source_dir: Path, workspace: Path, requirements_text: str) -> str:
    if not requirements_text or not settings.LOCAL_TRAINING_ALLOW_PIP_INSTALL:
        return sys.executable

    requirements_path = source_dir / "requirements.txt"
    requirements_path.write_text(requirements_text, encoding="utf-8")

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

        s3_client = _s3_client()
        source_bucket, source_key = _split_s3_uri(training_job.s3_source_uri)
        s3_client.download_file(source_bucket, source_key, str(source_zip_path))
        _safe_extract_zip(source_zip_path, source_dir)

        data_bucket, data_key = _split_s3_uri(training_job.s3_training_data_uri)
        s3_client.download_file(data_bucket, data_key, str(input_train_dir / "train.csv"))

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

        requirements_text = training_job.model_api.requirements_text if training_job.model_api else ""
        python_path = _prepare_python(source_dir, workspace, requirements_text)
        env = os.environ.copy()
        env.update(
            {
                "SM_CHANNEL_TRAIN": str(input_train_dir),
                "SM_MODEL_DIR": str(model_dir),
                "SM_OUTPUT_DIR": str(output_dir),
                "ENTRY_POINT": training_job.entry_point,
                "MODEL_VERSION": training_job.model_version,
                "MLFLOW_MODEL_NAME": training_job.name,
                "AWS_BUCKET_NAME": settings.AWS_STORAGE_BUCKET_NAME,
            }
        )

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
            ]
        )
        try:
            ingest_training_job_tracking(training_job)
        except Exception as exc:
            training_job.tracking_status = "failed"
            training_job.tracking_error = f"Tracking ingestion failed: {exc}"
            training_job.save(update_fields=["tracking_status", "tracking_error", "updated_at"])

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
