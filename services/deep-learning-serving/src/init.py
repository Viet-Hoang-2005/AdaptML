import os
import re
from pathlib import Path
from src.loading import download_model_artifact

CORE_PACKAGES = {
    "bentoml",
    "fastapi",
    "uvicorn",
    "starlette",
    "pydantic",
    "boto3",
    "botocore",
    "httpx",
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
            
            pkg_name = re.split(r"[=<>~\[\s]", line_str)[0].strip().lower()
            if pkg_name in CORE_PACKAGES:
                print(f"Filtering out core DL serving infrastructure package from dynamic requirements: {line_str}")
                continue
            
            safe_lines.append(line_str)
            has_valid_reqs = True

    if has_valid_reqs:
        output_path.write_text("\n".join(safe_lines) + "\n", encoding="utf-8")
        print(f"Wrote {len(safe_lines)} safe DL requirements to {output_path}")
        return True
    return False

def main():
    model_id_str = os.environ.get("MODEL_ID")
    model_uri = os.environ.get("MODEL_URI")
    
    if not model_uri:
        print("MODEL_URI is not set or empty. Skipping runtime init download for DL service.")
        return

    model_id = int(model_id_str) if model_id_str and model_id_str != "unknown" and model_id_str.isdigit() else 0

    print(f"Downloading/Extracting DL model artifact from {model_uri}...")
    try:
        source_dir = download_model_artifact(model_id, model_uri)
        print(f"DL Artifact extracted to {source_dir}")
    except Exception as exc:
        print(f"Failed to download DL artifact: {exc}")
        return

    req_files = list(source_dir.rglob("requirements.txt"))
    if not req_files:
        print("No requirements.txt found in DL model artifact.")
        return

    req_file = req_files[0]
    print(f"Found requirements file at {req_file}")
    filter_core_packages(req_file, Path("/tmp/safe_requirements.txt"))

if __name__ == "__main__":
    main()
