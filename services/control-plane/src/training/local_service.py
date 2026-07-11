import os
import subprocess
import sys
import tarfile
import venv
import base64
import threading
import docker

from django.core.cache import cache
from pathlib import Path
from django.conf import settings
from rest_framework.exceptions import ValidationError
from authentication.models import TrainingJob
from integrations.hashid_utils import encode_model_id
from integrations.s3_paths import training_job_mlflow_prefix
from training.tracking_ingestion_service import ingest_training_job_tracking

from training.s3_storage_service import (
    _s3_uri,
    upload_training_inputs_to_s3,
    generate_presigned_download_url,
    generate_presigned_upload_url,
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
    _, _, prefix = upload_training_inputs_to_s3(training_job)
    bucket_name = getattr(settings, "AWS_STORAGE_BUCKET_NAME", "")
    
    training_job.status = "running"
    training_job.error_message = ""
    training_job.stop_reason = ""
    training_job.sagemaker_job_name = ""
    
    output_prefix = f"{prefix}/output"
    model_artifact_uri = _s3_uri(bucket_name, f"{output_prefix}/model.tar.gz")
    training_job.output_s3_uri = _s3_uri(bucket_name, f"{output_prefix}/")
    training_job.model_artifact_uri = model_artifact_uri
    
    training_job.mark_started(save=False)
    training_job.save(
        update_fields=[
            "status",
            "error_message",
            "stop_reason",
            "sagemaker_job_name",
            "output_s3_uri",
            "model_artifact_uri",
            "started_at",
            "updated_at",
        ]
    )

    try:
        cache.client.get_client().delete(f"training_logs:{training_job.id}")
    except Exception:
        pass

    raw_req = training_job.requirements_text
    requirements_text = base64.b64encode(raw_req.encode("utf-8")).decode("utf-8") if raw_req else ""

    source_presigned = generate_presigned_download_url(str(training_job.s3_source_uri), expiry_seconds=14400)
    data_presigned = generate_presigned_download_url(str(training_job.s3_training_data_uri), expiry_seconds=14400)
    output_presigned = generate_presigned_upload_url(model_artifact_uri, expiry_seconds=14400)
    
    tenant_id = training_job.tenant.tenant_id
    
    mlflow_experiment_name = f"tenant-{tenant_id}-training-job-{training_job.id}"
    mlflow_artifact_root = ""
    if getattr(training_job, "model_api", None):
        model_hash_id = encode_model_id(training_job.model_api.id)
        mlflow_prefix = training_job_mlflow_prefix(tenant_id, model_hash_id, training_job.id)
        mlflow_artifact_root = f"s3://{bucket_name}/{mlflow_prefix}"

    environment = {
        "S3_SOURCE_URI": source_presigned,
        "S3_TRAINING_DATA_URI": data_presigned,
        "S3_OUTPUT_URI": output_presigned,
        "ENTRY_POINT": str(training_job.entry_point),
        "MODEL_VERSION": str(training_job.model_version),
        "TRAINING_JOB_ID": str(training_job.id),
        "TENANT_ID": str(tenant_id),
        "REQUIREMENTS_TEXT": requirements_text,
        "REDIS_URL": os.environ.get("REDIS_URL", "redis://redis:6379/1"),
        "MLFLOW_TRACKING_URI": os.environ.get("MLFLOW_TRACKING_URI", "http://mlflow-server:5000"),
        "MLFLOW_EXPERIMENT_NAME": mlflow_experiment_name,
        "MLFLOW_ARTIFACT_ROOT": mlflow_artifact_root,
    }

    client = docker.from_env()
    network_name = getattr(settings, "DOCKER_NETWORK_NAME", "mlops_paas_network")
    image_name = "mlops-paas-training-runner:latest"
    container_name = f"local_tjob_{tenant_id.lower()}_{training_job.id}"

    try:
        container = client.containers.run(
            image=image_name,
            name=container_name,
            environment=environment,
            network=network_name,
            detach=True,
        )
    except Exception as exc:
        training_job.status = "failed"
        training_job.error_message = f"Failed to start local Docker container: {exc}"
        training_job.stop_reason = str(exc)
        training_job.mark_finished(training_job.stop_reason, save=False)
        training_job.save(
            update_fields=["status", "error_message", "stop_reason", "completed_at", "runtime_seconds", "updated_at"]
        )
        raise

    def _wait_for_container():
        try:
            result = container.wait()
            status_code = result.get("StatusCode")
            
            try:
                logs_bytes = container.logs()
                training_logs = _short_log(logs_bytes.decode("utf-8", errors="replace"), "")
            except Exception:
                training_logs = "Could not fetch container logs."

            if status_code == 0:
                training_job.status = "completed"
                training_job.error_message = ""
            else:
                training_job.status = "failed"
                training_job.error_message = f"Container exited with code {status_code}"
                training_job.stop_reason = f"Exit code {status_code}"

            training_job.training_logs = training_logs
            training_job.mark_finished(save=False)
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

            try:
                ingest_training_job_tracking(training_job)
            except Exception as exc:
                training_job.tracking_status = "failed"
                training_job.tracking_error = f"Tracking ingestion failed: {exc}"
                training_job.save(update_fields=["tracking_status", "tracking_error", "updated_at"])

            if status_code == 0:
                try:
                    container.remove()
                except Exception:
                    pass
        except Exception as exc:
            pass

    threading.Thread(target=_wait_for_container, name=f"local-train-job-{training_job.id}", daemon=True).start()

    return {
        "status": training_job.status,
        "model_artifact_uri": training_job.model_artifact_uri,
        "output_s3_uri": training_job.output_s3_uri,
    }
