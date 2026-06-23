import os
import json
import pickle
import shutil
import zipfile
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

import boto3
import httpx
import mlflow.pyfunc
from fastapi import HTTPException

MODEL_CACHE_DIR = os.environ.get("MODEL_CACHE_DIR", "/tmp/mlops_paas_models")
MODEL_CACHE: Dict[int, Dict[str, Any]] = {}

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

def load_model_for_record(model_record: Dict[str, Any]) -> Dict[str, Any]:
    model_id = int(model_record["id"])
    version_marker = str(model_record.get("updated_at"))
    cached = MODEL_CACHE.get(model_id)

    if cached and cached.get("version_marker") == version_marker:
        return cached

    model_uri = model_record.get("model_uri")
    if not model_uri:
        raise HTTPException(status_code=503, detail="Model API does not have a model artifact.")

    try:
        source_dir = download_model_artifact(model_id, model_uri)
        mlflow_model_dir = resolve_mlflow_model_dir(source_dir)
        pyfunc_model = mlflow.pyfunc.load_model(str(mlflow_model_dir))
        signature = pyfunc_model.metadata.signature
        expected_features = [inp.name for inp in signature.inputs] if signature and signature.inputs else None

        label_mapping = None
        for ext, loader, mode in [(".json", json.load, "r"), (".pkl", pickle.load, "rb")]:
            mapping_file = next(mlflow_model_dir.glob(f"*{ext}"), None)
            if mapping_file and ("mapping" in mapping_file.name.lower() or "label" in mapping_file.name.lower() or "dictionary" in mapping_file.name.lower()):
                try:
                    with mapping_file.open(mode) as f:
                        label_mapping = loader(f)
                        if isinstance(label_mapping, list):
                            label_mapping = {i: v for i, v in enumerate(label_mapping)}
                    break
                except Exception as e:
                    print(f"Failed to load mapping file {mapping_file}: {e}")

        # Fallback to check entire source_dir if not found in mlflow_model_dir
        if not label_mapping:
            for ext, loader, mode in [(".json", json.load, "r"), (".pkl", pickle.load, "rb")]:
                mapping_file = next(source_dir.rglob(f"*{ext}"), None)
                if mapping_file and ("mapping" in mapping_file.name.lower() or "label" in mapping_file.name.lower() or "dictionary" in mapping_file.name.lower()):
                    try:
                        with mapping_file.open(mode) as f:
                            label_mapping = loader(f)
                            if isinstance(label_mapping, list):
                                label_mapping = {i: v for i, v in enumerate(label_mapping)}
                        break
                    except Exception as e:
                        pass

    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Unable to load model artifact: {exc}")

    try:
        raw_model = None
        if hasattr(pyfunc_model, "unwrap_python_model"):
            try:
                raw_model = pyfunc_model.unwrap_python_model()
            except Exception:
                pass
        if not raw_model and hasattr(pyfunc_model, "_model_impl"):
            raw_model = getattr(pyfunc_model._model_impl, "xgb_model", None)
            
        if raw_model and type(raw_model).__name__ == "XGBClassifier":
            if not hasattr(raw_model, "n_classes_"):
                if label_mapping:
                    raw_model.n_classes_ = len(label_mapping)
                else:
                    raw_model.n_classes_ = len(getattr(raw_model, "classes_", [0, 1]))
                
        # If signature is missing, try to extract expected features from raw model
        if not expected_features and raw_model:
            if hasattr(raw_model, "feature_names_in_") and getattr(raw_model, "feature_names_in_", None) is not None:
                expected_features = list(raw_model.feature_names_in_)
            elif hasattr(raw_model, "get_booster"):
                expected_features = raw_model.get_booster().feature_names
            elif hasattr(raw_model, "feature_names"):
                expected_features = raw_model.feature_names
    except Exception as e:
        print(f"Failed to apply XGBClassifier workaround or extract feature names: {e}")

    MODEL_CACHE[model_id] = {
        "model": pyfunc_model,
        "expected_features": expected_features,
        "label_mapping": label_mapping,
        "version_marker": version_marker,
    }
    return MODEL_CACHE[model_id]
