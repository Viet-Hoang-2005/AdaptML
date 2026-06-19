import os
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import boto3


WORKSPACE = Path("/workspace")
SOURCE_DIR = WORKSPACE / "source"
INPUT_TRAIN_DIR = WORKSPACE / "input" / "train"
MODEL_DIR = WORKSPACE / "model"
OUTPUT_DIR = WORKSPACE / "output"


def log(message: str) -> None:
    print(f"[training-runner] {message}", flush=True)


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def parse_s3_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path:
        raise RuntimeError(f"Invalid S3 URI for {uri!r}")
    return parsed.netloc, parsed.path.lstrip("/")


def s3_client():
    return boto3.client("s3", region_name=os.environ.get("AWS_DEFAULT_REGION"))


def download_s3(uri: str, destination: Path) -> None:
    bucket, key = parse_s3_uri(uri)
    destination.parent.mkdir(parents=True, exist_ok=True)
    log(f"Downloading s3://{bucket}/{key} to {destination}")
    s3_client().download_file(bucket, key, str(destination))


def upload_s3(source: Path, uri: str) -> None:
    bucket, key = parse_s3_uri(uri)
    log(f"Uploading model artifact to s3://{bucket}/{key}")
    s3_client().upload_file(str(source), bucket, key)


def safe_extract_zip(zip_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        destination_root = destination.resolve()
        for member in archive.infolist():
            member_path = destination / member.filename
            if not str(member_path.resolve()).startswith(str(destination_root)):
                raise RuntimeError("Source zip contains an unsafe path.")
        archive.extractall(destination)


def install_requirements(requirements_path: Path) -> None:
    if not requirements_path.exists():
        return
    log("Installing requirements.txt")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", str(requirements_path)],
        cwd=str(SOURCE_DIR),
        check=True,
    )


def run_training(entry_point: str, model_version: str) -> None:
    entry_point_path = SOURCE_DIR / entry_point
    if not entry_point_path.exists() or not entry_point_path.is_file():
        raise RuntimeError(f"Source zip must contain entry point: {entry_point}")

    env = os.environ.copy()
    env.update(
        {
            "SM_CHANNEL_TRAIN": str(INPUT_TRAIN_DIR),
            "SM_MODEL_DIR": str(MODEL_DIR),
            "SM_OUTPUT_DIR": str(OUTPUT_DIR),
            "MODEL_VERSION": model_version,
            "AWS_BUCKET_NAME": os.environ.get("AWS_BUCKET_NAME", ""),
        }
    )

    log(f"Running training entry point: {entry_point}")
    subprocess.run(
        [sys.executable, str(entry_point_path)],
        cwd=str(SOURCE_DIR),
        env=env,
        check=True,
    )


def create_model_archive(archive_path: Path) -> None:
    model_files = [item for item in MODEL_DIR.rglob("*") if item.is_file()]
    if not model_files:
        raise RuntimeError("Training completed but SM_MODEL_DIR does not contain any model files.")

    log(f"Packaging {len(model_files)} model file(s) into model.tar.gz")
    with tarfile.open(archive_path, "w:gz") as archive:
        for item in MODEL_DIR.rglob("*"):
            archive.add(item, arcname=item.relative_to(MODEL_DIR))


def main() -> None:
    source_uri = require_env("S3_SOURCE_URI")
    training_data_uri = require_env("S3_TRAINING_DATA_URI")
    output_uri = require_env("S3_OUTPUT_URI")
    entry_point = os.environ.get("ENTRY_POINT", "train.py").strip() or "train.py"
    model_version = os.environ.get("MODEL_VERSION", "").strip()
    requirements_uri = os.environ.get("S3_REQUIREMENTS_URI", "").strip()

    log("Preparing workspace")
    if WORKSPACE.exists():
        shutil.rmtree(WORKSPACE)
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    INPUT_TRAIN_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    source_zip_path = WORKSPACE / "source.zip"
    train_csv_path = INPUT_TRAIN_DIR / "train.csv"
    requirements_path = SOURCE_DIR / "requirements.txt"
    model_archive_path = OUTPUT_DIR / "model.tar.gz"

    download_s3(source_uri, source_zip_path)
    download_s3(training_data_uri, train_csv_path)
    if requirements_uri:
        download_s3(requirements_uri, requirements_path)

    log("Extracting source zip")
    safe_extract_zip(source_zip_path, SOURCE_DIR)

    install_requirements(requirements_path)
    run_training(entry_point, model_version)
    create_model_archive(model_archive_path)
    upload_s3(model_archive_path, output_uri)
    log("Training job completed successfully")


if __name__ == "__main__":
    main()
