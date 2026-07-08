import os
import shutil
import zipfile
from pathlib import Path
from urllib.parse import urlparse
import boto3
import httpx

MODEL_CACHE_DIR = os.environ.get("MODEL_CACHE_DIR", "/tmp/mlops_paas_models")

def download_model_artifact(model_id: int, model_uri: str) -> Path:
    model_dir = Path(MODEL_CACHE_DIR) / str(model_id)
    source_dir = model_dir / "source"
    artifact_path = model_dir / "artifact.zip"

    if source_dir.exists() and any(source_dir.rglob("MLmodel")):
        return source_dir

    if model_dir.exists():
        shutil.rmtree(model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)

    parsed = urlparse(model_uri)
    if parsed.scheme in {"http", "https"}:
        with httpx.Client(timeout=60.0, follow_redirects=True) as client:
            response = client.get(model_uri)
            response.raise_for_status()
            artifact_path.write_bytes(response.content)
    elif parsed.scheme == "s3":
        boto3.client("s3").download_file(parsed.netloc, parsed.path.lstrip("/"), str(artifact_path))
    else:
        local_path = Path(model_uri)
        if local_path.is_dir():
            return local_path
        if not local_path.exists():
            raise FileNotFoundError(f"Model artifact not found: {model_uri}")
        shutil.copyfile(local_path, artifact_path)

    with zipfile.ZipFile(artifact_path) as archive:
        destination_root = source_dir.resolve()
        for member in archive.infolist():
            member_path = source_dir / member.filename
            if not str(member_path.resolve()).startswith(str(destination_root)):
                raise ValueError("Model artifact contains an unsafe path.")
        archive.extractall(source_dir)

    return source_dir

def resolve_mlflow_model_dir(source_dir: Path) -> Path:
    root_mlmodel = source_dir / "MLmodel"
    if root_mlmodel.exists():
        return source_dir

    candidates = list(source_dir.rglob("MLmodel"))
    if not candidates:
        raise FileNotFoundError("MLmodel file was not found in the model artifact.")
    return candidates[0].parent
