import os
import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import boto3
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from urllib import request as urlrequest
from urllib.error import URLError

WORKSPACE = Path("/workspace")
SOURCE_DIR = WORKSPACE / "source"
INPUT_TRAIN_DIR = WORKSPACE / "input" / "train"
MODEL_DIR = WORKSPACE / "model"
OUTPUT_DIR = WORKSPACE / "output"
MLOPS_DIR_NAME = "_mlops"
RUNNER_VERSION = "mlops-metadata-bundle-v1"
MODEL_FILE_EXTENSIONS = {".pkl", ".joblib", ".xgb"}
CHECKPOINT_EXTENSIONS = {".pt", ".pth", ".ckpt", ".h5", ".onnx", ".keras"}
METADATA_EXTENSIONS = {".json", ".yaml", ".yml", ".txt"}
INSIGHTS_INPUT_FILES = (
    ("model_insights.json", ""),
    ("feature_importance.json", "feature_importance"),
    ("coefficients.json", "coefficients"),
    ("weights_summary.json", "weights_summary"),
)
MAX_MODEL_INSIGHT_ITEMS = 500


def log(message: str) -> None:
    print(f"[training-runner] {message}", flush=True)


def metric_log(payload: dict) -> None:
    print(f"METRIC_JSON {json.dumps(payload, separators=(',', ':'))}", flush=True)


def warn(warnings: list[dict], code: str, message: str, **extra) -> None:
    warning = {"code": code, "message": message}
    warning.update(extra)
    warnings.append(warning)


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str), encoding="utf-8")


def safe_json_value(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [safe_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): safe_json_value(item) for key, item in value.items()}
    return str(value)


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def parse_metric_events(stdout_text: str, warnings: list[dict]) -> tuple[list[dict], dict]:
    events: list[dict] = []
    metrics: dict = {}

    for line_number, line in enumerate(stdout_text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped.startswith("METRIC_JSON:"):
            continue

        raw_payload = stripped.split("METRIC_JSON:", 1)[1].strip()
        try:
            payload = json.loads(raw_payload)
        except json.JSONDecodeError as exc:
            warn(
                warnings,
                "invalid_metric_json",
                "Invalid METRIC_JSON line was ignored.",
                line_number=line_number,
                error=str(exc),
            )
            continue

        if not isinstance(payload, dict):
            warn(
                warnings,
                "invalid_metric_json_shape",
                "METRIC_JSON payload must be a JSON object.",
                line_number=line_number,
            )
            continue

        normalized_payload = safe_json_value(payload)
        events.append({"line_number": line_number, "payload": normalized_payload})
        for key, value in normalized_payload.items():
            if is_number(value):
                metrics[str(key)] = value

    return events, metrics


def read_json_object(path: Path, label: str, warnings: list[dict]) -> dict:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        warn(warnings, f"invalid_{label}_json", f"{label}.json could not be parsed and was ignored.", error=str(exc))
        return {}
    if not isinstance(payload, dict):
        warn(warnings, f"invalid_{label}_shape", f"{label}.json must contain a JSON object.")
        return {}
    return safe_json_value(payload)


def split_numeric_metrics(payload: dict, warnings: list[dict], source: str) -> dict:
    metrics = {}
    for key, value in payload.items():
        if is_number(value):
            metrics[str(key)] = value
        elif value is not None:
            warn(
                warnings,
                "non_numeric_metric_ignored",
                "Non-numeric metric value was ignored.",
                source=source,
                metric=str(key),
            )
    return metrics


def normalize_model_insights(payload: dict, default_kind: str = "") -> dict:
    if not isinstance(payload, dict):
        return {}

    kind = str(payload.get("kind") or default_kind or "feature_importance")
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        feature_importance = payload.get("feature_importance")
        coefficients = payload.get("coefficients")
        if isinstance(feature_importance, dict):
            kind = "feature_importance"
            raw_items = [{"name": name, "value": value} for name, value in feature_importance.items()]
        elif isinstance(coefficients, dict):
            kind = "coefficients"
            raw_items = [{"name": name, "value": value} for name, value in coefficients.items()]
        else:
            raw_items = []

    items = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("feature") or "").strip()
        if not name:
            continue
        value = item.get("value", item.get("importance", item.get("coefficient")))
        if not is_number(value):
            continue
        normalized = {
            "name": name,
            "value": float(value),
            "abs_value": float(abs(value)),
        }
        class_name = item.get("class_name", item.get("class"))
        if class_name is not None:
            normalized["class_name"] = str(class_name)
        items.append(normalized)

    items = sorted(items, key=lambda entry: entry["abs_value"], reverse=True)[:MAX_MODEL_INSIGHT_ITEMS]
    for rank, item in enumerate(items, start=1):
        item["rank"] = rank

    if not items:
        return {}

    try:
        feature_count = int(payload.get("feature_count") or len(items))
    except (TypeError, ValueError):
        feature_count = len(items)

    return {
        "schema_version": "model-insights-v1",
        "kind": kind,
        "source": str(payload.get("source") or "training_artifact"),
        "feature_count": feature_count,
        "items": items,
    }


def read_model_insights(output_dir: Path, warnings: list[dict]) -> dict:
    for filename, default_kind in INSIGHTS_INPUT_FILES:
        path = output_dir / filename
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            warn(warnings, "invalid_model_insights_json", f"{filename} could not be parsed and was ignored.", error=str(exc))
            return {}
        insights = normalize_model_insights(payload, default_kind)
        if not insights:
            warn(warnings, "invalid_model_insights_shape", f"{filename} did not contain supported model insight items.")
            return {}
        return insights
    return {}


def artifact_kind(relative_path: Path) -> str:
    name = relative_path.name
    suffix = relative_path.suffix.lower()
    if name == "MLmodel" or suffix in MODEL_FILE_EXTENSIONS:
        return "model"
    if suffix in CHECKPOINT_EXTENSIONS:
        return "checkpoint"
    if suffix in METADATA_EXTENSIONS:
        return "metadata"
    if suffix == ".log":
        return "log"
    return "other"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_artifact_manifest(model_dir: Path) -> list[dict]:
    manifest = []
    root = model_dir.resolve()
    for item in sorted(model_dir.rglob("*")):
        if not item.is_file():
            continue
        resolved = item.resolve()
        if not str(resolved).startswith(str(root)):
            continue
        relative_path = item.relative_to(model_dir)
        manifest.append(
            {
                "path": relative_path.as_posix(),
                "size_bytes": item.stat().st_size,
                "sha256": sha256_file(item),
                "kind": artifact_kind(relative_path),
            }
        )
    return manifest


def write_metric_events(path: Path, events: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event, sort_keys=True, default=str))
            handle.write("\n")


def write_mlops_bundle(
    *,
    entry_point: str,
    model_version: str,
    training_job_id: str,
    status: str,
    stdout_text: str,
    stderr_text: str,
) -> None:
    warnings: list[dict] = []
    mlops_dir = MODEL_DIR / MLOPS_DIR_NAME
    mlops_dir.mkdir(parents=True, exist_ok=True)

    metric_events, stdout_metrics = parse_metric_events(stdout_text, warnings)
    file_metrics_payload = read_json_object(OUTPUT_DIR / "metrics.json", "metrics", warnings)
    params_payload = read_json_object(OUTPUT_DIR / "params.json", "params", warnings)
    metrics = {**stdout_metrics, **split_numeric_metrics(file_metrics_payload, warnings, "metrics.json")}
    params = safe_json_value(params_payload)
    model_insights = read_model_insights(OUTPUT_DIR, warnings)

    (mlops_dir / "stdout.txt").write_text(stdout_text, encoding="utf-8")
    (mlops_dir / "stderr.txt").write_text(stderr_text, encoding="utf-8")
    write_metric_events(mlops_dir / "metric_events.jsonl", metric_events)
    write_json(mlops_dir / "metrics.json", metrics)
    write_json(mlops_dir / "params.json", params)
    if model_insights:
        write_json(mlops_dir / "model_insights.json", model_insights)
    write_json(mlops_dir / "warnings.json", warnings)

    manifest = build_artifact_manifest(MODEL_DIR)
    write_json(mlops_dir / "artifact_manifest.json", manifest)

    summary = {
        "runner_version": RUNNER_VERSION,
        "entry_point": entry_point,
        "model_version": model_version,
        "training_job_id": training_job_id,
        "status": status,
        "metrics": metrics,
        "params": params,
        "artifact_count": len(manifest),
        "warnings_count": len(warnings),
    }
    write_json(mlops_dir / "training_summary.json", summary)


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


def _imds_request(path: str, token: str | None = None, method: str = "GET", timeout: float = 1.0) -> str:
    headers = {}
    if token:
        headers["X-aws-ec2-metadata-token"] = token
    if method == "PUT" and path.lstrip("/") == "api/token":
        headers["X-aws-ec2-metadata-token-ttl-seconds"] = "21600"
    req = urlrequest.Request(
        f"http://169.254.169.254/latest/{path.lstrip('/')}",
        headers=headers,
        method=method,
    )
    with urlrequest.urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8").strip()


def tag_current_ec2_instance(training_job_id: str) -> None:
    if not training_job_id:
        return
    try:
        token = _imds_request(
            "api/token",
            method="PUT",
            timeout=1.0,
        )
    except (OSError, URLError):
        token = None

    try:
        instance_id = _imds_request("meta-data/instance-id", token=token)
        availability_zone = _imds_request("meta-data/placement/availability-zone", token=token)
    except (OSError, URLError) as exc:
        log(f"Skipping EC2 Name tag update because instance metadata is unavailable: {exc}")
        return

    region = availability_zone[:-1]
    instance_name = f"mlops-training-{training_job_id}"
    try:
        boto3.client("ec2", region_name=region).create_tags(
            Resources=[instance_id],
            Tags=[{"Key": "Name", "Value": instance_name}],
        )
        log(f"Tagged EC2 instance {instance_id} as {instance_name}")
    except Exception as exc:
        log(f"Skipping EC2 Name tag update for {instance_id}: {exc}")


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


def run_training(entry_point: str, model_version: str) -> subprocess.CompletedProcess:
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
        result = subprocess.run(
            [sys.executable, str(entry_point_path)],
            cwd=str(SOURCE_DIR),
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
    finally:
        stop_metrics.set()
    if result.stdout:
        print(result.stdout, end="", flush=True)
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr, flush=True)
    return result


def create_model_archive(archive_path: Path) -> None:
    model_files = [
        item
        for item in MODEL_DIR.rglob("*")
        if item.is_file() and MLOPS_DIR_NAME not in item.relative_to(MODEL_DIR).parts
    ]
    if not model_files:
        raise RuntimeError("Training completed but SM_MODEL_DIR does not contain any model files.")

    log(f"Packaging {len(model_files)} model file(s) into model.tar.gz")
    with tarfile.open(archive_path, "w:gz") as archive:
        for item in MODEL_DIR.rglob("*"):
            if item.is_file():
                archive.add(item, arcname=item.relative_to(MODEL_DIR))


def main() -> None:
    source_uri = require_env("S3_SOURCE_URI")
    training_data_uri = require_env("S3_TRAINING_DATA_URI")
    output_uri = require_env("S3_OUTPUT_URI")
    entry_point = os.environ.get("ENTRY_POINT", "train.py").strip() or "train.py"
    model_version = os.environ.get("MODEL_VERSION", "").strip()
    training_job_id = os.environ.get("TRAINING_JOB_ID", "").strip()
    requirements_uri = os.environ.get("S3_REQUIREMENTS_URI", "").strip()

    tag_current_ec2_instance(training_job_id)

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
    result = run_training(entry_point, model_version)
    training_status = "succeeded" if result.returncode == 0 else "failed"
    write_mlops_bundle(
        entry_point=entry_point,
        model_version=model_version,
        training_job_id=training_job_id,
        status=training_status,
        stdout_text=result.stdout or "",
        stderr_text=result.stderr or "",
    )
    if result.returncode != 0:
        raise RuntimeError(f"Training entry point failed with exit code {result.returncode}")
    create_model_archive(model_archive_path)
    upload_s3(model_archive_path, output_uri)
    log("Training job completed successfully")


if __name__ == "__main__":
    main()
