import json
import logging
import os
import shutil
import sys
import tarfile
import tempfile
import traceback
from pathlib import Path
from urllib.parse import urlparse

import boto3
import redis
import requests
import docker

from core import build_preview_tree, load_model, make_zip, parse_requirements, save_mlflow_model

SUPPORTED_MODEL_EXTENSIONS = {".pkl", ".joblib", ".xgb"}
PREFERRED_MODEL_FILENAMES = ("model.pkl", "model.joblib", "model.xgb")

class RedisLogHandler(logging.Handler):
    def __init__(self, redis_url: str, model_id: str):
        super().__init__()
        self.redis_client = redis.from_url(redis_url)
        self.log_key = f"build_logs:{model_id}"
        # Xóa log cũ nếu có
        self.redis_client.delete(self.log_key)

    def emit(self, record):
        try:
            msg = self.format(record)
            self.redis_client.rpush(self.log_key, msg)
            # Expire log sau 1 giờ
            self.redis_client.expire(self.log_key, 3600)
        except Exception:
            self.handleError(record)


def parse_s3_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path:
        raise ValueError(f"Invalid S3 URI: {uri}")
    return parsed.netloc, parsed.path.lstrip("/")


def download_s3_uri(s3, uri: str, destination: Path) -> None:
    bucket, key = parse_s3_uri(uri)
    print(f"Downloading training artifact from s3://{bucket}/{key}...")
    destination.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(bucket, key, str(destination))
    print("Download completed.")


def safe_extract_tar(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    destination_root = destination.resolve()
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            member_path = destination / member.name
            resolved = member_path.resolve()
            if not str(resolved).startswith(str(destination_root)):
                raise ValueError("Training artifact contains an unsafe path.")
            if member.islnk() or member.issym():
                raise ValueError("Training artifact contains links, which are not supported.")
        archive.extractall(destination)


def find_supported_model_file(root: Path) -> Path:
    files = [item for item in root.rglob("*") if item.is_file() and item.suffix.lower() in SUPPORTED_MODEL_EXTENSIONS]
    if not files:
        raise ValueError("Training artifact is not deployable because no .pkl, .joblib, or .xgb file was found.")

    by_name = {item.name: item for item in sorted(files)}
    for preferred in PREFERRED_MODEL_FILENAMES:
        if preferred in by_name:
            if len(files) > 1:
                print(f"Warning: multiple model files found; using {preferred}.")
            return by_name[preferred]

    selected = sorted(files, key=lambda item: item.as_posix())[0]
    if len(files) > 1:
        print(f"Warning: multiple model files found; using {selected.relative_to(root).as_posix()}.")
    return selected


def find_label_mapping_file(root: Path) -> Path | None:
    candidates = []
    for item in root.rglob("*"):
        if not item.is_file() or item.suffix.lower() not in {".json", ".pkl"}:
            continue
        lowered = item.name.lower()
        if "mapping" in lowered or "label" in lowered or "dictionary" in lowered:
            candidates.append(item)
    return sorted(candidates, key=lambda item: item.as_posix())[0] if candidates else None

def main():
    model_id = os.environ.get("MODEL_ID")
    if not model_id:
        print("Missing MODEL_ID")
        sys.exit(1)

    redis_url = os.environ.get("REDIS_URL", "redis://redis:6379/1")
    logger = logging.getLogger(f"build-{model_id}")
    logger.setLevel(logging.INFO)

    # Thêm stdout handler
    original_stdout = sys.stdout
    stdout_handler = logging.StreamHandler(original_stdout)
    stdout_handler.setFormatter(logging.Formatter('%(message)s'))
    logger.addHandler(stdout_handler)

    class StreamToLogger(object):
        def __init__(self, logger, level):
            self.logger = logger
            self.level = level

        def write(self, buf):
            for line in buf.splitlines():
                line = line.rstrip()
                if line:
                    self.logger.log(self.level, line)

        def flush(self):
            pass

    sys.stdout = StreamToLogger(logger, logging.INFO)
    sys.stderr = StreamToLogger(logger, logging.ERROR)

    # Thêm Redis handler
    try:
        redis_handler = RedisLogHandler(redis_url, model_id)
        redis_handler.setFormatter(logging.Formatter('%(message)s'))
        logger.addHandler(redis_handler)
    except Exception as e:
        logger.warning(f"Could not connect to Redis for log streaming: {e}")

    try:
        logger.info(f"Starting build process for model {model_id}...")

        flavor = os.environ.get("FLAVOR", "").lower()
        requirements_text = os.environ.get("REQUIREMENTS_TEXT", "")
        source_key = os.environ.get("SOURCE_KEY")
        source_type = os.environ.get("SOURCE_TYPE", "manual_upload")
        training_artifact_uri = os.environ.get("TRAINING_ARTIFACT_URI", "")
        output_key = os.environ.get("OUTPUT_KEY")
        bucket_name = os.environ.get("AWS_BUCKET_NAME")
        webhook_url = os.environ.get("CONTROL_PLANE_WEBHOOK_URL")

        if source_type == "training_job":
            if not all([flavor, training_artifact_uri, output_key, bucket_name]):
                raise ValueError("Missing required environment variables for training artifact build.")
        elif not all([flavor, source_key, output_key, bucket_name]):
            raise ValueError("Missing required environment variables for build.")

        s3 = boto3.client(
            "s3",
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
            region_name=os.environ.get("AWS_DEFAULT_REGION", "ap-southeast-1")
        )

        workspace = Path(tempfile.mkdtemp(prefix=f"build-{model_id}-"))
        try:
            artifact_name = ""
            artifact_path = None
            extracted_label_mapping_path = None

            if source_type == "training_job":
                training_archive_path = workspace / "training-model.tar.gz"
                extracted_dir = workspace / "training-artifact"
                download_s3_uri(s3, training_artifact_uri, training_archive_path)
                print("Extracting training artifact safely...")
                safe_extract_tar(training_archive_path, extracted_dir)
                artifact_path = find_supported_model_file(extracted_dir)
                artifact_name = artifact_path.name

                if not requirements_text.strip():
                    requirements_file = next(iter(sorted(extracted_dir.rglob("requirements.txt"))), None)
                    if requirements_file:
                        requirements_text = requirements_file.read_text(encoding="utf-8").strip()
                        print("Using requirements.txt from training artifact.")

                extracted_label_mapping_path = find_label_mapping_file(extracted_dir)
                if extracted_label_mapping_path:
                    print(f"Using label mapping from training artifact: {extracted_label_mapping_path.name}")
            else:
                artifact_name = Path(source_key).name
                artifact_path = workspace / artifact_name

                print(f"Downloading source artifact from s3://{bucket_name}/{source_key}...")
                s3.download_file(bucket_name, source_key, str(artifact_path))
                print("Download completed.")

            print(f"Loading {flavor} model...")
            model = load_model(artifact_path, flavor)

            package_name = "model"
            package_dir = workspace / package_name
            requirements = parse_requirements(requirements_text)

            print("Saving MLflow model format...")
            save_mlflow_model(model, flavor, package_dir, requirements)

            if requirements_text.strip():
                (package_dir / "requirements.txt").write_text(requirements_text.strip() + "\n", encoding="utf-8")

            label_mapping_key = os.environ.get("LABEL_MAPPING_KEY")
            if label_mapping_key:
                print(f"Downloading label mapping file from s3://{bucket_name}/{label_mapping_key}...")
                mapping_artifact_name = Path(label_mapping_key).name
                mapping_path = package_dir / mapping_artifact_name
                s3.download_file(bucket_name, label_mapping_key, str(mapping_path))
                print("Label mapping download completed.")
            elif extracted_label_mapping_path:
                shutil.copy2(extracted_label_mapping_path, package_dir / extracted_label_mapping_path.name)

            print("Generating package manifest...")
            preview_tree = build_preview_tree(package_dir)
            manifest = {
                "flavor": flavor,
                "source_type": source_type,
                "source_artifact": artifact_name,
                "package_root": package_name,
                "requirements_count": len(requirements or []),
            }

            zip_path = workspace / "model-package.zip"
            print("Compressing package to zip...")
            make_zip(package_dir, zip_path)

            print(f"Uploading output to s3://{bucket_name}/{output_key}...")
            s3.upload_file(str(zip_path), bucket_name, output_key)
            print("Upload completed.")

            print("Building custom Docker image...")
            try:
                dockerfile_content = """FROM mlops-paas-model-server:latest
USER root
COPY requirements.txt /tmp/custom_requirements.txt
RUN pip install --no-cache-dir -r /tmp/custom_requirements.txt || echo 'Some requirements failed to install, continuing...'
"""
                (workspace / "Dockerfile").write_text(dockerfile_content, encoding="utf-8")

                # Requirements are in package_dir/requirements.txt or requirements_text
                if requirements_text.strip():
                    (workspace / "requirements.txt").write_text(requirements_text.strip() + "\n", encoding="utf-8")
                else:
                    (workspace / "requirements.txt").write_text("\n", encoding="utf-8")

                docker_client = docker.from_env()
                image_tag = f"mlops-paas-model-{model_id}:latest"
                print(f"Building Docker image {image_tag} from workspace {workspace}...")

                # Build image directly, stream logs to stdout
                for line in docker_client.api.build(path=str(workspace), tag=image_tag, rm=True, decode=True):
                    if 'stream' in line:
                        print(line['stream'].strip())
                    elif 'errorDetail' in line:
                        raise RuntimeError(line['errorDetail'].get('message', 'Unknown Docker build error'))

                print(f"Docker image {image_tag} built successfully!")
            except Exception as docker_err:
                logger.error(f"Failed to build Docker image: {docker_err}")
                logger.error(traceback.format_exc())
                raise RuntimeError(f"Docker build failed: {docker_err}")

            print("Build completed successfully!")

            # Notify Control Plane
            if webhook_url:
                payload = {
                    "model_id": model_id,
                    "status": "success",
                    "package_manifest": manifest,
                    "package_preview_tree": preview_tree,
                }
                requests.post(webhook_url, json=payload, timeout=10)

            # Đánh dấu EOF cho frontend biết tiến trình đã xong
            logger.info("BUILD_EOF_SUCCESS")

        finally:
            shutil.rmtree(workspace, ignore_errors=True)

    except Exception as exc:
        logger.error(f"Build failed with error: {str(exc)}")

        logger.error(traceback.format_exc())

        # Notify Control Plane of failure
        webhook_url = os.environ.get("CONTROL_PLANE_WEBHOOK_URL")
        if webhook_url:
            payload = {
                "model_id": model_id,
                "status": "error",
                "error_message": str(exc)
            }
            try:
                requests.post(webhook_url, json=payload, timeout=10)
            except:
                pass

        logger.info("BUILD_EOF_ERROR")
        sys.exit(1)

if __name__ == "__main__":
    main()
