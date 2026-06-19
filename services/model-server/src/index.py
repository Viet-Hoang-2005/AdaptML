import json
import os
import pickle
import shutil
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse
import re

import boto3
import httpx
import jwt
import mlflow.pyfunc
import numpy as np
import pandas as pd
import redis
from confluent_kafka import Producer
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Request, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
from jwt.algorithms import RSAAlgorithm
from prometheus_client import Counter, Histogram
from prometheus_fastapi_instrumentator import Instrumentator
from pydantic import BaseModel
from sqlalchemy import create_engine, text

JWKS_URL = os.environ.get("JWKS_URL", "http://django-service/.well-known/jwks.json")
CONTROL_PLANE_DATABASE_URL = os.environ.get("CONTROL_PLANE_DATABASE_URL")
CONTROL_PLANE_DB_SCHEMA = os.environ.get("CONTROL_PLANE_DB_SCHEMA", "control_plane")
MODEL_CACHE_DIR = os.environ.get("MODEL_CACHE_DIR", "/tmp/mlops_paas_models")
REDPANDA_BROKERS = os.environ.get("REDPANDA_BROKERS", "localhost:19092")
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC", "mlops_paas_production_logs")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/1")

app = FastAPI(
    title="AI PaaS Dynamic Inference API",
    description="Generic multi-tenant inference server backed by Django model registry.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", CONTROL_PLANE_DB_SCHEMA):
    raise RuntimeError("CONTROL_PLANE_DB_SCHEMA must be a simple PostgreSQL identifier.")

paas_predictions_counter = Counter(
    "paas_predictions_total",
    "Total predictions processed",
    ["tenant_id", "model_id", "status"],
)

paas_latency_histogram = Histogram(
    "paas_prediction_latency_seconds",
    "Latency of prediction requests",
    ["tenant_id", "model_id"],
)

Instrumentator().instrument(app).expose(app)

try:
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    redis_client.ping()
    print(f"Redis Connected: {REDIS_URL}")
except Exception as exc:
    print(f"Failed to connect to Redis: {exc}")
    redis_client = None

try:
    kafka_producer = Producer({
        "bootstrap.servers": REDPANDA_BROKERS,
        "client.id": "fastapi-dynamic-model-registry",
        "linger.ms": 5,
    })
    print(f"Redpanda Connected: {REDPANDA_BROKERS} - Topic: {KAFKA_TOPIC}")
except Exception as exc:
    print(f"Failed to setup Redpanda producer: {exc}")
    kafka_producer = None

try:
    model_registry_engine = (
        create_engine(
            CONTROL_PLANE_DATABASE_URL,
            pool_pre_ping=True,
            connect_args={"options": f"-c search_path={CONTROL_PLANE_DB_SCHEMA},public"},
        )
        if CONTROL_PLANE_DATABASE_URL
        else None
    )
    print("Connected to Control Plane model registry." if model_registry_engine else "CONTROL_PLANE_DATABASE_URL is not set.")
except Exception as exc:
    print(f"Failed to connect to Control Plane model registry: {exc}")
    model_registry_engine = None

JWKS_CACHE: Dict[str, Any] = {}
MODEL_CACHE: Dict[int, Dict[str, Any]] = {}
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


class InferenceRequest(BaseModel):
    features: Dict[str, Any]


async def get_public_key(kid: str):
    if kid not in JWKS_CACHE:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(JWKS_URL, timeout=5.0)
                response.raise_for_status()
                jwks = response.json()
                for key_data in jwks.get("keys", []):
                    if key_data.get("kid") == kid:
                        public_key = RSAAlgorithm.from_jwk(json.dumps(key_data))
                        JWKS_CACHE[kid] = public_key
                        return public_key
        except Exception as exc:
            print(f"Failed to fetch or parse JWKS: {exc}")
            return None
    return JWKS_CACHE.get(kid)


def get_model_api_record(model_id: int) -> Dict[str, Any]:
    if model_registry_engine is None:
        raise HTTPException(status_code=500, detail="Model registry database is unavailable.")

    query = text("""
        SELECT
            model.id,
            model.name,
            model.access_mode,
            model.model_uri,
            model.endpoint_url,
            model.status,
            model.updated_at,
            users.tenant_id
        FROM authentication_modelapi AS model
        INNER JOIN authentication_customuser AS users ON users.id = model.tenant_id
        WHERE model.id = :model_id AND model.status != 'disabled'
        LIMIT 1
    """)

    with model_registry_engine.connect() as conn:
        row = conn.execute(query, {"model_id": model_id}).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Model API not found.")

    return dict(row)


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

    MODEL_CACHE[model_id] = {
        "model": pyfunc_model,
        "expected_features": expected_features,
        "label_mapping": label_mapping,
        "version_marker": version_marker,
    }
    return MODEL_CACHE[model_id]


async def verify_model_access(
    model_id: int,
    api_key: str = Security(api_key_header),
    authorization: str = Header(None),
):
    model_record = get_model_api_record(model_id)
    model_tenant_id = model_record["tenant_id"]

    if model_record["access_mode"] == "public":
        return {"tenant_id": model_tenant_id, "auth_type": "public", "model_api": model_record}

    if api_key:
        if not redis_client:
            raise HTTPException(status_code=500, detail="Internal Server Error: Redis cache unavailable")

        cached_tenant_id = redis_client.get(f"api_key:{api_key}")
        if not cached_tenant_id:
            raise HTTPException(status_code=401, detail="Unauthorized: Invalid or revoked API Key")

        if cached_tenant_id != model_tenant_id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not have permission to access this model.")

        return {"tenant_id": cached_tenant_id, "auth_type": "api_key", "model_api": model_record}

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized: Missing API Key or Bearer Token")

    token = authorization.split(" ")[1]

    try:
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            raise HTTPException(status_code=401, detail="Unauthorized: JWT missing 'kid' header")

        public_key = await get_public_key(kid)
        if not public_key:
            raise HTTPException(status_code=401, detail="Unauthorized: Unable to verify token signature")

        payload = jwt.decode(token, public_key, algorithms=["RS256"], audience="mlops-paas")
        token_tenant_id = payload.get("tenant_id")
        if token_tenant_id != model_tenant_id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not have permission to access this model.")

        payload["auth_type"] = "jwt"
        payload["model_api"] = model_record
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Unauthorized: Token has expired")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail=f"Unauthorized: Invalid token ({exc})")


def send_to_redpanda(tenant_id: str, model_id: str, features_dict: dict, prediction_result: Any):
    if kafka_producer is None:
        return

    try:
        payload = {
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "model_id": model_id,
            "timestamp": datetime.utcnow().isoformat(),
            "features": features_dict,
            "prediction": prediction_result,
        }

        kafka_producer.produce(
            topic=KAFKA_TOPIC,
            key=payload["id"].encode("utf-8"),
            value=json.dumps(payload).encode("utf-8"),
        )
        kafka_producer.poll(0)
    except Exception as exc:
        print(f"Error sending log to Redpanda: {exc}")


@app.on_event("shutdown")
def shutdown_event():
    if kafka_producer:
        kafka_producer.flush(timeout=5.0)


@app.get("/")
async def health_check():
    return {
        "status": "healthy",
        "mode": "dynamic-model-registry",
        "model_registry_connected": model_registry_engine is not None,
        "cached_models": list(MODEL_CACHE.keys()),
    }


@app.get("/models/{model_id}/health")
async def model_health(model_id: int, token_payload: dict = Depends(verify_model_access)):
    model_record = token_payload["model_api"]
    loaded = load_model_for_record(model_record)
    return {
        "status": "healthy",
        "tenant_id": model_record["tenant_id"],
        "model_id": str(model_record["id"]),
        "access_mode": model_record["access_mode"],
        "model_loaded": loaded.get("model") is not None,
    }


@app.post("/models/{model_id}/predict")
async def predict(
    model_id: int,
    request: Request,
    payload: InferenceRequest,
    background_tasks: BackgroundTasks,
    token_payload: dict = Depends(verify_model_access),
):
    model_record = token_payload["model_api"]
    loaded_model = load_model_for_record(model_record)
    model = loaded_model["model"]
    expected_features = loaded_model.get("expected_features")

    try:
        features_dict = payload.model_dump().get("features", {})

        if expected_features:
            missing_cols = set(expected_features) - set(features_dict.keys())
            if missing_cols:
                raise HTTPException(
                    status_code=400,
                    detail=f"Bad Request: Missing {len(missing_cols)} required features (e.g., {list(missing_cols)[:3]})",
                )

        df_input = pd.DataFrame([features_dict])
        if expected_features:
            df_input = df_input[expected_features]

        prediction = model.predict(df_input)

        if isinstance(prediction, (np.ndarray, pd.Series)):
            result = prediction.tolist()
        else:
            result = prediction if isinstance(prediction, list) else [prediction]

        single_result = result[0] if len(result) > 0 else result
        tenant_id = model_record["tenant_id"]
        resolved_model_id = str(model_record["id"])

        # Map label if mapping exists
        label_mapping = loaded_model.get("label_mapping")
        if label_mapping is not None:
            # Try to map the result. Convert to string to check if the keys are strings.
            str_result = str(single_result)
            if single_result in label_mapping:
                single_result = label_mapping[single_result]
            elif str_result in label_mapping:
                single_result = label_mapping[str_result]
            elif type(single_result) == int or type(single_result) == float:
                # sometimes mapping keys are integers
                if int(single_result) in label_mapping:
                    single_result = label_mapping[int(single_result)]

        confidence = None
        try:
            raw_model = getattr(model, "_model_impl", None)
            if not raw_model and hasattr(model, "unwrap_python_model"):
                raw_model = model.unwrap_python_model()
            if hasattr(raw_model, "predict_proba"):
                proba = raw_model.predict_proba(df_input)
                if hasattr(proba, "tolist"):
                    proba = proba.tolist()
                if isinstance(proba, list) and len(proba) > 0:
                    confidence = round(max(proba[0]) * 100, 2)
        except Exception:
            pass

        print(f"Prediction: {single_result}")
        print(f"Confidence: {confidence}%" if confidence else "Confidence: Not available")

        paas_predictions_counter.labels(tenant_id=tenant_id, model_id=resolved_model_id, status="success").inc()
        background_tasks.add_task(send_to_redpanda, tenant_id, resolved_model_id, features_dict, single_result)

        return JSONResponse(
            content={
                "success": True,
                "prediction": single_result,
                "confidence": confidence,
                "tenant_id": tenant_id,
                "model_id": resolved_model_id,
            },
            status_code=200,
        )
    except HTTPException:
        paas_predictions_counter.labels(
            tenant_id=model_record["tenant_id"], model_id=str(model_record["id"]), status="error_400"
        ).inc()
        raise
    except Exception as exc:
        paas_predictions_counter.labels(
            tenant_id=model_record["tenant_id"], model_id=str(model_record["id"]), status="error_500"
        ).inc()
        raise HTTPException(status_code=500, detail=str(exc))
