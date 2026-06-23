import json
import os
import uuid
from datetime import datetime
from typing import Any, Dict

import httpx
import jwt
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
from database import get_model_api_record, model_registry_engine
from loading import load_model_for_record, MODEL_CACHE

JWKS_URL = os.environ.get("JWKS_URL", "http://django-service/.well-known/jwks.json")
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

JWKS_CACHE: Dict[str, Any] = {}
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



async def verify_model_access(
    model_id: int,
    api_key: str = Security(api_key_header),
    authorization: str = Header(None),
):
    try:
        model_record = get_model_api_record(model_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
    if not model_record:
        raise HTTPException(status_code=404, detail="Model API not found.")
        
    model_tenant_id = model_record["tenant_id"]

    if model_record["access_mode"] == "public":
        return {"tenant_id": model_tenant_id, "auth_type": "public", "model_api": model_record}

    if api_key:
        if not redis_client:
            raise HTTPException(status_code=500, detail="Internal Server Error: Redis cache unavailable")

        cached_data_str = redis_client.get(f"api_key:{api_key}")
        if not cached_data_str:
            raise HTTPException(status_code=401, detail="Unauthorized: Invalid or revoked API Key")
            
        try:
            cached_data = json.loads(cached_data_str)
            cached_tenant_id = cached_data.get("tenant_id")
            scope = cached_data.get("scope", "all")
            allowed_models = cached_data.get("allowed_models", [])
        except json.JSONDecodeError:
            # Fallback for old plain string API Keys
            cached_tenant_id = cached_data_str
            scope = "all"
            allowed_models = []

        if cached_tenant_id != model_tenant_id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not have permission to access this model.")
            
        allowed_model_ids = {str(allowed_model_id) for allowed_model_id in allowed_models}
        if scope == "specific" and str(model_id) not in allowed_model_ids:
            raise HTTPException(status_code=403, detail="Forbidden: This API Key is not authorized for this specific endpoint.")

        return {"tenant_id": cached_tenant_id, "auth_type": "api_key", "model_api": model_record, "scope": scope}

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
        
        # Unwrap nested list if it exists
        while isinstance(single_result, list) and len(single_result) > 0:
            single_result = single_result[0]
            
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
    except ValueError as exc:
        exc_str = str(exc)
        paas_predictions_counter.labels(
            tenant_id=model_record["tenant_id"], model_id=str(model_record["id"]), status="error_400"
        ).inc()
        # Sklearn raises ValueError for feature name mismatches; return 400 with a helpful message.
        if "feature names" in exc_str.lower() or "feature_names" in exc_str.lower():
            received = list(payload.model_dump().get("features", {}).keys())
            raise HTTPException(
                status_code=400,
                detail={
                    "success": False,
                    "error": "Invalid feature columns",
                    "message": exc_str,
                    "received_features": received,
                    "hint": (
                        "The input columns do not match the model's training features. "
                        "Remove label/target columns (e.g. 'label', 'target', 'y', 'class') "
                        "from your prediction input."
                    ),
                },
            )
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        paas_predictions_counter.labels(
            tenant_id=model_record["tenant_id"], model_id=str(model_record["id"]), status="error_500"
        ).inc()
        raise HTTPException(status_code=500, detail=str(exc))
