import os
import re
import sys
from pathlib import Path
from src.database import get_model_api_record
from src.loading import download_model_artifact

CORE_PACKAGES = {
    "fastapi",
    "uvicorn",
    "starlette",
    "pydantic",
    "mlflow",
    "boto3",
    "botocore",
    "psycopg2",
    "psycopg2-binary",
    "redis",
    "confluent-kafka",
    "prometheus-client",
    "prometheus-fastapi-instrumentator",
    "httpx",
    "pyjwt",
    "hashids",
}

def filter_core_packages(req_file_path: Path, output_path: Path) -> bool:
    if not req_file_path.exists():
        return False

    safe_lines = []
    has_valid_reqs = False
    with req_file_path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line_str = line.strip()
            if not line_str or line_str.startswith("#"):
                continue
            
            # Extract package name before any version specifier (=, <, >, ~, [)
            pkg_name = re.split(r"[=<>~\[\s]", line_str)[0].strip().lower()
            if pkg_name in CORE_PACKAGES:
                print(f"[InitRuntime] Filtering out core package from dynamic requirements: {line_str}")
                continue
            
            safe_lines.append(line_str)
            has_valid_reqs = True

    if has_valid_reqs:
        output_path.write_text("\n".join(safe_lines) + "\n", encoding="utf-8")
        print(f"[InitRuntime] Wrote {len(safe_lines)} safe requirements to {output_path}")
        return True
    return False

def main():
    model_id_str = os.environ.get("MODEL_ID")
    if not model_id_str or model_id_str == "unknown":
        print("[InitRuntime] MODEL_ID is not set or unknown. Skipping runtime init.")
        return

    try:
        model_id = int(model_id_str)
    except ValueError:
        print(f"[InitRuntime] Invalid MODEL_ID integer: {model_id_str}")
        return

    print(f"[InitRuntime] Fetching model record for ID: {model_id}...")
    record = get_model_api_record(model_id)
    if not record:
        print(f"[InitRuntime] Model record not found for ID: {model_id}")
        return

    model_uri = record.get("model_uri")
    if not model_uri:
        print(f"[InitRuntime] Model record {model_id} has no model_uri.")
        return

    print(f"[InitRuntime] Downloading/Extracting model artifact from {model_uri}...")
    try:
        source_dir = download_model_artifact(model_id, model_uri)
        print(f"[InitRuntime] Artifact extracted to {source_dir}")
    except Exception as exc:
        print(f"[InitRuntime] Failed to download artifact: {exc}")
        return

    # Look for requirements.txt in the artifact directory
    req_files = list(source_dir.rglob("requirements.txt"))
    if not req_files:
        print("[InitRuntime] No requirements.txt found in model artifact.")
        return

    req_file = req_files[0]
    print(f"[InitRuntime] Found requirements file at {req_file}")
    filter_core_packages(req_file, Path("/tmp/safe_requirements.txt"))

if __name__ == "__main__":
    main()
