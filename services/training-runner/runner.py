import os
import json
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import zipfile
from datetime import datetime, timezone
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


def metric_log(payload: dict) -> None:
    print(f"METRIC_JSON {json.dumps(payload, separators=(',', ':'))}", flush=True)


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


def _read_int_file(path: str) -> int | None:
    try:
        value = Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if value in {"", "max"}:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _read_cgroup_cpu_usage_seconds() -> float | None:
    cpu_stat = Path("/sys/fs/cgroup/cpu.stat")
    if cpu_stat.exists():
        try:
            for line in cpu_stat.read_text(encoding="utf-8").splitlines():
                key, value = line.split(maxsplit=1)
                if key == "usage_usec":
                    return int(value) / 1_000_000
        except (OSError, ValueError):
            return None

    usage_ns = _read_int_file("/sys/fs/cgroup/cpuacct/cpuacct.usage")
    if usage_ns is not None:
        return usage_ns / 1_000_000_000
    return None


def _read_cgroup_cpu_limit() -> float:
    cpu_max = Path("/sys/fs/cgroup/cpu.max")
    if cpu_max.exists():
        try:
            quota_raw, period_raw = cpu_max.read_text(encoding="utf-8").strip().split(maxsplit=1)
            if quota_raw != "max":
                quota = int(quota_raw)
                period = int(period_raw)
                if quota > 0 and period > 0:
                    return max(quota / period, 0.001)
        except (OSError, ValueError):
            pass

    quota = _read_int_file("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")
    period = _read_int_file("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
    if quota and period and quota > 0 and period > 0:
        return max(quota / period, 0.001)
    return float(os.cpu_count() or 1)


def _read_cgroup_memory() -> tuple[float | None, float | None, float | None]:
    used = _read_int_file("/sys/fs/cgroup/memory.current")
    limit = _read_int_file("/sys/fs/cgroup/memory.max")

    if used is None:
        used = _read_int_file("/sys/fs/cgroup/memory/memory.usage_in_bytes")
    if limit is None:
        limit = _read_int_file("/sys/fs/cgroup/memory/memory.limit_in_bytes")

    if limit and limit > 8 * 1024 * 1024 * 1024 * 1024:
        limit = None

    used_mb = round(used / 1024 / 1024, 2) if used is not None else None
    limit_mb = round(limit / 1024 / 1024, 2) if limit else None
    percent = round((used / limit) * 100, 2) if used is not None and limit else None
    return used_mb, limit_mb, percent


def _read_gpu_metrics() -> dict:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {
            "gpu_available": False,
            "gpu_percent": None,
            "gpu_memory_used_mb": None,
            "gpu_memory_total_mb": None,
            "gpu_memory_percent": None,
        }

    if result.returncode != 0 or not result.stdout.strip():
        return {
            "gpu_available": False,
            "gpu_percent": None,
            "gpu_memory_used_mb": None,
            "gpu_memory_total_mb": None,
            "gpu_memory_percent": None,
        }

    gpu_rows = []
    for line in result.stdout.strip().splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) != 3:
            continue
        try:
            gpu_percent, memory_used, memory_total = (float(parts[0]), float(parts[1]), float(parts[2]))
        except ValueError:
            continue
        gpu_rows.append((gpu_percent, memory_used, memory_total))

    if not gpu_rows:
        return {
            "gpu_available": False,
            "gpu_percent": None,
            "gpu_memory_used_mb": None,
            "gpu_memory_total_mb": None,
            "gpu_memory_percent": None,
        }

    gpu_percent = max(row[0] for row in gpu_rows)
    memory_used = sum(row[1] for row in gpu_rows)
    memory_total = sum(row[2] for row in gpu_rows)
    return {
        "gpu_available": True,
        "gpu_percent": round(gpu_percent, 2),
        "gpu_memory_used_mb": round(memory_used, 2),
        "gpu_memory_total_mb": round(memory_total, 2),
        "gpu_memory_percent": round((memory_used / memory_total) * 100, 2) if memory_total else None,
    }


def start_metric_emitter(stop_event: threading.Event, interval_seconds: int = 5) -> threading.Thread:
    def emit_loop() -> None:
        cpu_limit = _read_cgroup_cpu_limit()
        previous_usage = _read_cgroup_cpu_usage_seconds()
        previous_time = time.monotonic()

        while not stop_event.is_set():
            now = time.monotonic()
            current_usage = _read_cgroup_cpu_usage_seconds()
            cpu_percent = None
            if previous_usage is not None and current_usage is not None and now > previous_time:
                cpu_percent = round(((current_usage - previous_usage) / (now - previous_time) / cpu_limit) * 100, 2)
                cpu_percent = max(0.0, min(cpu_percent, 100.0))
            previous_usage = current_usage
            previous_time = now

            memory_used_mb, memory_limit_mb, memory_percent = _read_cgroup_memory()
            metric_log(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "cpu_percent": cpu_percent,
                    "cpu_limit_cores": round(cpu_limit, 2),
                    "memory_used_mb": memory_used_mb,
                    "memory_limit_mb": memory_limit_mb,
                    "memory_percent": memory_percent,
                    **_read_gpu_metrics(),
                }
            )
            stop_event.wait(interval_seconds)

    thread = threading.Thread(target=emit_loop, name="training-metrics", daemon=True)
    thread.start()
    return thread


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
    stop_metrics = threading.Event()
    start_metric_emitter(stop_metrics)
    try:
        subprocess.run(
            [sys.executable, str(entry_point_path)],
            cwd=str(SOURCE_DIR),
            env=env,
            check=True,
        )
    finally:
        stop_metrics.set()


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
