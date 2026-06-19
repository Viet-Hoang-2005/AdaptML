import base64
import json
import pickle
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import cloudpickle
import joblib
import mlflow.sklearn
import mlflow.xgboost
import xgboost as xgb
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from .core import build_preview_tree, load_model, make_zip, parse_requirements, save_mlflow_model

app = FastAPI(title="MLflow Model Packager", version="0.1.0")

SUPPORTED_FLAVORS = {"sklearn", "xgboost"}
SUPPORTED_EXTENSIONS = {".pkl", ".joblib", ".xgb"}
MAX_ARTIFACT_SIZE_BYTES = 512 * 1024 * 1024

def encode_header_json(value: object) -> str:
    raw = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/build")
async def build_model_package(
    flavor: str = Form(...),
    requirements_text: str = Form(""),
    package_name: str = Form("model"),
    artifact: UploadFile = File(...),
):
    flavor = flavor.strip().lower()
    if flavor not in SUPPORTED_FLAVORS:
        raise HTTPException(status_code=400, detail="Flavor must be sklearn or xgboost.")

    artifact_name = Path(artifact.filename or "").name
    if Path(artifact_name).suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Artifact must be .pkl, .joblib, or .xgb.")

    package_name = "model"
    workspace = Path(tempfile.mkdtemp(prefix="model-packager-"))
    try:
        artifact_path = workspace / artifact_name
        size = 0
        with artifact_path.open("wb") as output:
            while chunk := await artifact.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_ARTIFACT_SIZE_BYTES:
                    raise HTTPException(status_code=400, detail="Model artifact must be 512MB or smaller.")
                output.write(chunk)

        model = load_model(artifact_path, flavor)
        package_dir = workspace / package_name
        requirements = parse_requirements(requirements_text)
        save_mlflow_model(model, flavor, package_dir, requirements)

        if requirements_text.strip():
            (package_dir / "requirements.txt").write_text(requirements_text.strip() + "\n", encoding="utf-8")

        preview_tree = build_preview_tree(package_dir)
        manifest = {
            "flavor": flavor,
            "source_artifact": artifact_name,
            "package_root": package_name,
            "requirements_count": len(requirements or []),
        }

        zip_path = workspace / "model-package.zip"
        make_zip(package_dir, zip_path)

        return FileResponse(
            zip_path,
            media_type="application/zip",
            filename="model-package.zip",
            background=BackgroundTask(shutil.rmtree, workspace, ignore_errors=True),
            headers={
                "X-Package-Preview-Tree": encode_header_json(preview_tree),
                "X-Package-Manifest": encode_header_json(manifest),
            },
        )
    except HTTPException:
        shutil.rmtree(workspace, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(workspace, ignore_errors=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        await artifact.close()
