# index.py: AI PaaS Generic Model Inference Server
import os
import json
import uuid
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, Any, List

from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Header, Request, Security
from fastapi.security import APIKeyHeader
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn
import jwt
from jwt.algorithms import RSAAlgorithm
import requests
from confluent_kafka import Producer
from prometheus_client import Counter, Histogram, Gauge
from prometheus_fastapi_instrumentator import Instrumentator
import mlflow.pyfunc
import redis

# 1. ENVIRONMENT VARIABLES (POD INJECTION)
TENANT_ID = os.environ.get("TENANT_ID", "default_tenant")
MODEL_ID = os.environ.get("MODEL_ID", "default_model")
ACCESS_MODE = os.environ.get("ACCESS_MODE", "private").lower() # 'public' or 'private'
MODEL_URI = os.environ.get("MODEL_URI", "/app/models/model") # S3 Path loaded by Init Container
JWKS_URL = os.environ.get("JWKS_URL", "http://django-service/.well-known/jwks.json")

# Kafka configs
REDPANDA_BROKERS = os.environ.get('REDPANDA_BROKERS', 'localhost:19092')
KAFKA_TOPIC = "ai_paas_production_logs"

# Redis Config (API Key Cache)
REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/1')

# 2. FASTAPI INIT
app = FastAPI(
    title=f"AI PaaS Inference API - Model: {MODEL_ID}",
    description="Generic Inference Server supporting Multi-tenancy and JWT Auth.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. PROMETHEUS METRICS (MULTI-TENANT)
paas_predictions_counter = Counter(
    "paas_predictions_total",
    "Total predictions processed",
    ["tenant_id", "model_id", "status"]
)

paas_latency_histogram = Histogram(
    "paas_prediction_latency_seconds",
    "Latency of prediction requests",
    ["tenant_id", "model_id"]
)

Instrumentator().instrument(app).expose(app)

# 4. REDIS CLIENT INIT
try:
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    redis_client.ping()
    print(f"Redis Connected: {REDIS_URL}")
except Exception as e:
    print(f"Failed to connect to Redis: {e}")
    redis_client = None

# 5. REDPANDA PRODUCER INIT
try:
    kafka_producer = Producer({
        'bootstrap.servers': REDPANDA_BROKERS,
        'client.id': f'fastapi-{TENANT_ID}-{MODEL_ID}',
        'linger.ms': 5
    })
    print(f"Redpanda Connected: {REDPANDA_BROKERS} - Topic: {KAFKA_TOPIC}")
except Exception as e:
    print(f"Failed to setup Redpanda producer: {e}")
    kafka_producer = None


# 5. DYNAMIC MODEL LOADING (MLFLOW)
print(f"Starting generic server for Tenant [{TENANT_ID}] - Model [{MODEL_ID}]")
print(f"Access Mode: {ACCESS_MODE.upper()}")
print(f"Loading MLflow model from: {MODEL_URI}...")

try:
    # mlflow.pyfunc can load Sklearn, XGBoost, PyTorch, etc. dynamically
    model = mlflow.pyfunc.load_model(MODEL_URI)
    
    # Try to extract signature (expected input schema)
    signature = model.metadata.signature
    EXPECTED_FEATURES = None
    if signature and signature.inputs:
        EXPECTED_FEATURES = [inp.name for inp in signature.inputs]
        print(f"Model Signature found. Expecting {len(EXPECTED_FEATURES)} features.")
    else:
        print("Warning: Model has no MLflow signature. Input validation will be skipped.")
        
    print("Model loaded successfully.")
except Exception as e:
    print(f"Critical Error: Failed to load model from {MODEL_URI}. Details: {e}")
    model = None
    EXPECTED_FEATURES = None


# 6. AUTHENTICATION (ASYMMETRIC JWT)
JWKS_CACHE = {}

def get_public_key(kid: str):
    """Lấy Public Key từ Django JWKS endpoint (có cache)."""
    if kid not in JWKS_CACHE:
        try:
            print(f"Fetching JWKS from {JWKS_URL}...")
            response = requests.get(JWKS_URL, timeout=5)
            response.raise_for_status()
            jwks = response.json()
            for key_data in jwks.get("keys", []):
                if key_data.get("kid") == kid:
                    # Convert JWK to RSA Public Key
                    public_key = RSAAlgorithm.from_jwk(json.dumps(key_data))
                    JWKS_CACHE[kid] = public_key
                    return public_key
        except Exception as e:
            print(f"Failed to fetch or parse JWKS: {e}")
            return None
    return JWKS_CACHE.get(kid)

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def verify_tenant_access(
    api_key: str = Security(api_key_header),
    authorization: str = Header(None)
):
    """FastAPI Dependency: Kiểm tra Token hoặc API Key nếu API đang ở chế độ Private."""
    # 1. Bypass nếu đang chạy chế độ Public
    if ACCESS_MODE == "public":
        return {"tenant_id": "public_user"}
        
    # 2. KIỂM TRA LUỒNG 1: API KEY (Dành cho Code Python)
    if api_key:
        if not redis_client:
            raise HTTPException(status_code=500, detail="Internal Server Error: Redis cache unavailable")
            
        # Truy vấn trực tiếp vào Redis (Rất nhanh ~1ms)
        cached_tenant_id = redis_client.get(f"api_key:{api_key}")
        if not cached_tenant_id:
            raise HTTPException(status_code=401, detail="Unauthorized: Invalid or revoked API Key")
            
        if cached_tenant_id != TENANT_ID:
            print(f"Security Alert: API Key of Tenant {cached_tenant_id} attempted to access model of Tenant {TENANT_ID}")
            raise HTTPException(status_code=403, detail="Forbidden: You do not have permission to access this model.")
            
        return {"tenant_id": cached_tenant_id, "auth_type": "api_key"}

    # 3. KIỂM TRA LUỒNG 2: JWT BEARER (Dành cho ReactJS Web)
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized: Missing API Key or Bearer Token")
    
    token = authorization.split(" ")[1]
    
    try:
        # Trích xuất 'kid' (Key ID) từ header của JWT
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            raise HTTPException(status_code=401, detail="Unauthorized: JWT missing 'kid' header")
            
        # Lấy Public Key từ Cache/Django
        public_key = get_public_key(kid)
        if not public_key:
            raise HTTPException(status_code=401, detail="Unauthorized: Unable to verify token signature (Key not found)")

        # Verify token (sử dụng thuật toán RS256)
        payload = jwt.decode(token, public_key, algorithms=["RS256"], audience="mlops-paas")
        
        # Kiểm tra chéo (Ngăn chặn BOLA/IDOR)
        token_tenant_id = payload.get("tenant_id")
        if not token_tenant_id:
            raise HTTPException(status_code=401, detail="Unauthorized: Token payload missing 'tenant_id'")
            
        if token_tenant_id != TENANT_ID:
            print(f"Security Alert: Tenant {token_tenant_id} attempted to access model of Tenant {TENANT_ID}")
            raise HTTPException(status_code=403, detail="Forbidden: You do not have permission to access this model.")
            
        payload["auth_type"] = "jwt"
        return payload

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Unauthorized: Token has expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Unauthorized: Invalid token ({e})")


# 7. SCHEMA & BACKGROUND TASKS
class InferenceRequest(BaseModel):
    # Schema động để chấp nhận mọi loại dữ liệu dạng bảng
    features: Dict[str, Any]

def send_to_redpanda(features_dict: dict, prediction_result: Any):
    if kafka_producer is None:
        return

    try:
        # Chuẩn bị payload log cho Multi-tenant
        payload = {
            "id": str(uuid.uuid4()),
            "tenant_id": TENANT_ID,
            "model_id": MODEL_ID,
            "timestamp": datetime.utcnow().isoformat(),
            "features": features_dict, # Lưu vào cột JSONB
            "prediction": prediction_result
        }
        
        kafka_producer.produce(
            topic=KAFKA_TOPIC, 
            key=payload['id'].encode('utf-8'), 
            value=json.dumps(payload).encode('utf-8')
        )
        kafka_producer.poll(0)
    except Exception as e:
        print(f"Error sending log to Redpanda: {e}")

@app.on_event("shutdown")
def shutdown_event():
    if kafka_producer:
        print("Flushing Redpanda messages...")
        kafka_producer.flush(timeout=5.0)


# 8. API ENDPOINTS
@app.get("/")
async def health_check():
    """Kiểm tra trạng thái của API."""
    if model is None:
        raise HTTPException(
            status_code=503, 
            detail="Service Unavailable: Model failed to load."
        )
    return {
        "status": "healthy",
        "tenant_id": TENANT_ID,
        "model_id": MODEL_ID,
        "access_mode": ACCESS_MODE,
        "model_loaded": True
    }

@app.post("/predict")
async def predict(
    request: Request,
    payload: InferenceRequest, 
    background_tasks: BackgroundTasks,
    token_payload: dict = Depends(verify_tenant_access)
):
    """Thực hiện dự đoán dựa trên payload gửi lên."""
    if model is None:
        raise HTTPException(status_code=500, detail="Internal Error: Model is not initialized.")
        
    try:
        # 1. Fail-fast Validation (Nếu model có signature)
        if EXPECTED_FEATURES:
            missing_cols = set(EXPECTED_FEATURES) - set(payload.features.keys())
            if missing_cols:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Bad Request: Missing {len(missing_cols)} required features (e.g., {list(missing_cols)[:3]})"
                )

        # 2. Xử lý Pandas DataFrame (MLflow nhận DataFrame)
        df_input = pd.DataFrame([payload.features])
        if EXPECTED_FEATURES:
            df_input = df_input[EXPECTED_FEATURES] # Sắp xếp lại thứ tự cột cho đúng
            
        # 3. Tiến hành dự đoán
        prediction = model.predict(df_input)
        
        # 4. Ép kiểu về Python native (để chuyển thành JSON hợp lệ)
        if isinstance(prediction, (np.ndarray, pd.Series)):
             result = prediction.tolist()
        else:
             result = prediction if isinstance(prediction, list) else [prediction]
             
        # Giả định dự đoán trả về mảng 1 phần tử cho 1 row
        single_result = result[0] if len(result) > 0 else result
        
        # 5. Ghi nhận Metrics và đẩy log vào Redpanda
        paas_predictions_counter.labels(tenant_id=TENANT_ID, model_id=MODEL_ID, status="success").inc()
        
        background_tasks.add_task(
            send_to_redpanda, 
            features_dict=payload.features, 
            prediction_result=single_result
        )

        return JSONResponse(
            content={
                "success": True,
                "prediction": single_result,
                "tenant_id": TENANT_ID,
                "model_id": MODEL_ID
            },
            status_code=200
        )
        
    except HTTPException:
        paas_predictions_counter.labels(tenant_id=TENANT_ID, model_id=MODEL_ID, status="error_400").inc()
        raise
    except Exception as e:
        paas_predictions_counter.labels(tenant_id=TENANT_ID, model_id=MODEL_ID, status="error_500").inc()
        raise HTTPException(status_code=500, detail=str(e))