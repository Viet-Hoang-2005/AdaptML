# index.py: FastAPI service phục vụ dự đoán và ghi log vào Redpanda
import os
import json
import numpy as np
import pandas as pd
import joblib
import uvicorn
import uuid

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Dict
from datetime import datetime
from confluent_kafka import Producer
from prometheus_client import Counter, Histogram, Gauge
from prometheus_fastapi_instrumentator import Instrumentator

# 1. KHỞI TẠO FASTAPI
app = FastAPI(
    title="MLOPs NIDS System API",
    description="An End-to-End MLOps Architecture for Data Drift Monitoring and Continuous Retraining in NIDS.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1.1. PROMETHEUS MONITORING
# Tự động expose /metrics endpoint với đầy đủ HTTP metrics (latency, request count, error rate)
Instrumentator().instrument(app).expose(app)

# Custom NIDS Metrics: Đếm số phân loại theo từng loại traffic
nids_predictions_counter = Counter(
    "nids_predictions_total",
    "Total number of predictions by traffic class",
    ["label", "model_version"]
)

# Phân phối điểm tin cậy (Confidence Score) theo từng nhãn
nids_confidence_histogram = Histogram(
    "nids_prediction_confidence",
    "Distribution of model prediction confidence scores",
    ["label"],
    buckets=[0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1.0]
)

# Gauge thông tin model đang active (dùng trong Grafana để biết version nào đang chạy)
nids_active_model_info = Gauge(
    "nids_active_model_info",
    "Information about the currently loaded model version",
    ["model_version"]
)

# Cấu hình Redpanda Producer
REDPANDA_BROKERS = os.environ.get('REDPANDA_BROKERS', 'localhost:19092')
KAFKA_TOPIC = "nids_production_data"
try:
    kafka_producer = Producer({
        'bootstrap.servers': REDPANDA_BROKERS,
        'client.id': 'fastapi-nids-producer',
        'linger.ms': 5  # Gom nhóm message để tăng tốc độ ghi
    })
    print(f"Connected setup for Redpanda at {REDPANDA_BROKERS} - Topic: {KAFKA_TOPIC}")
except Exception as e:
    print(f"Failed to setup Redpanda producer: {e}")
    kafka_producer = None

# 2. CẤU HÌNH ĐƯỜNG DẪN VÀ THAM SỐ (ĐỘNG HÓA)
# Bắt biến môi trường MODEL_VERSION
MODEL_VERSION = os.environ.get('MODEL_VERSION', 'v1')
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Đường dẫn tự động nhảy theo version
MODEL_PATH = os.path.join(ROOT_DIR, 'models', MODEL_VERSION, f'xgb_nids_model_{MODEL_VERSION}.pkl')
LABEL_PATH = os.path.join(ROOT_DIR, 'models', MODEL_VERSION, f'label_classes_{MODEL_VERSION}.json')

# 3. LOAD MODEL VÀ ĐỌC FILE CẤU HÌNH FEATURES
try:
    # Load model XGBoost đã train
    model = joblib.load(MODEL_PATH)
    EXPECTED_FEATURES = model.get_booster().feature_names
    
    # Load Label từ file JSON
    with open(LABEL_PATH, 'r') as f:
        LABEL_CLASSES = json.load(f)
    
    print(f"Loaded XGBoost Model {MODEL_VERSION.upper()} (expecting {len(EXPECTED_FEATURES)} features)")
    print(f"Loaded Labels: {LABEL_CLASSES}")
    
    # Đánh dấu model version đang chạy trên Prometheus Gauge
    nids_active_model_info.labels(model_version=MODEL_VERSION).set(1)
except Exception as e:
    print(f"Error! Could not load model or labels. Details: {e}")
    model = LABEL_CLASSES = EXPECTED_FEATURES = None

class NetworkTraffic(BaseModel):
    features: Dict[str, float]

# 4. HÀM CHẠY NGẦM (BACKGROUND TASK) ĐỂ LƯU REDPANDA
def send_to_redpanda(features_dict: dict, predicted_label: str, confidence: float):
    if kafka_producer is None:
        print("Redpanda producer is not available. Skipping log.")
        return

    try:
        # Copy features để tạo row dữ liệu mới, thêm thông tin dự đoán
        row_data = features_dict.copy()
        
        row_data['id'] = str(uuid.uuid4()) # Sinh khóa chính (UUID)
        row_data['created_at'] = datetime.utcnow().isoformat() # Convert to string for JSON payload
        row_data['Predicted_Label'] = predicted_label  
        row_data['Confidence_Score'] = confidence 
        
        # Ép kiểu json cho msg
        payload = json.dumps(row_data).encode('utf-8')
        
        # Bắn vào Kafka/Redpanda
        kafka_producer.produce(topic=KAFKA_TOPIC, key=row_data['id'].encode('utf-8'), value=payload)
        kafka_producer.poll(0) # Trigger async callback
        
    except Exception as e:
        print(f"Error in background task while sending to Redpanda: {e}")

# Flush khi app shutdown (nếu muốn)
@app.on_event("shutdown")
def shutdown_event():
    if kafka_producer:
        print("Flushing Redpanda messages...")
        kafka_producer.flush(timeout=5.0)

# 5. API ENDPOINT
# Endpoint kiểm tra sức khỏe của API, trả về trạng thái và version của model đang chạy.
@app.get("/")
async def health_check():
    return {"status": "healthy", "model_version": MODEL_VERSION}

# Endpoint chính để nhận dữ liệu mạng, dự đoán và trả về kết quả dự đoán cùng xác suất cho từng lớp.
@app.post("/predict")
async def predict_intrusion(payload: NetworkTraffic, background_tasks: BackgroundTasks):    
    if model is None or LABEL_CLASSES is None or EXPECTED_FEATURES is None:
        raise HTTPException(status_code=500, detail="Error! The model has not been initialized on the server")

    try:
        # Chuyển đổi JSON thành DataFrame
        df_input = pd.DataFrame([payload.features])
        
        # Fail-fast Validation: Kiểm tra xem payload có bị thiếu cột nào không
        missing_cols = set(EXPECTED_FEATURES) - set(df_input.columns)
        if missing_cols:
            raise HTTPException(
                status_code=400, 
                detail=f"Bad Request: Missing {len(missing_cols)} required features (e.g., {list(missing_cols)[:3]}...)"
            )

        # Schema Alignment: Ép Pandas sắp xếp lại cột theo đúng thứ tự lúc Train
        df_input = df_input[EXPECTED_FEATURES]
        
        # Tiến hành dự đoán và tính toán xác suất cho từng lớp
        probas = model.predict_proba(df_input)[0]
        best_class_idx = int(np.argmax(probas))
        
        # Ánh xạ nhãn siêu tốc bằng cách truy xuất index mảng (O(1))
        predicted_label = str(LABEL_CLASSES[best_class_idx])
        confidence = float(probas[best_class_idx])
        
        # Tạo dictionary kết quả
        results = {
            str(LABEL_CLASSES[i]): round(float(probas[i]) * 100, 2) 
            for i in range(len(probas))
        }

        print(f"Prediction Success: {results}")

        # Cập nhật Prometheus metrics sau mỗi lần predict thành công
        nids_predictions_counter.labels(
            label=predicted_label,
            model_version=MODEL_VERSION
        ).inc()
        nids_confidence_histogram.labels(label=predicted_label).observe(confidence)

        # Trích xuất lại dictionary đã được lọc đúng thứ tự và số lượng của EXPECTED_FEATURES
        validated_features = df_input.iloc[0].to_dict()

        # Lưu kết quả dự đoán vào Redpanda dưới dạng background task
        background_tasks.add_task(
            send_to_redpanda, 
            features_dict=validated_features, 
            predicted_label=predicted_label,
            confidence=confidence
        )

        return JSONResponse(
            content={
                "success": True,
                "prediction": predicted_label,
                "confidence": round(confidence * 100, 2),
                "probabilities": results,
                "model_version": MODEL_VERSION
            },
            status_code=200
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("index:app", host="0.0.0.0", port=5000, reload=True)