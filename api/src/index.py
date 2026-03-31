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
from src.db_manager import save_dataframe_to_db

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

# 2. CẤU HÌNH ĐƯỜNG DẪN VÀ THAM SỐ (ĐỘNG HÓA)
# Bắt biến môi trường MODEL_VERSION
MODEL_VERSION = os.environ.get('MODEL_VERSION', 'v2')
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
    
    print(f"🤖 Loaded XGBoost Model {MODEL_VERSION.upper()} (expecting {len(EXPECTED_FEATURES)} features)!")
    print(f"🏷️ Loaded Labels: {LABEL_CLASSES}")
except Exception as e:
    print(f"❌ Error! Could not load model or labels. Details: {e}")
    model = LABEL_CLASSES = EXPECTED_FEATURES = None

class NetworkTraffic(BaseModel):
    features: Dict[str, float]

# 4. HÀM CHẠY NGẦM (BACKGROUND TASK) ĐỂ LƯU DATABASE
def save_to_database(features_dict: dict, predicted_label: str, confidence: float):
    try:
        # Copy features để tạo row dữ liệu mới, thêm thông tin dự đoán và metadata trước khi lưu vào database
        row_data = features_dict.copy()
        
        row_data['id'] = str(uuid.uuid4()) # Sinh khóa chính (UUID)
        row_data['created_at'] = datetime.utcnow() # Thêm thuộc tính created_at để theo dõi thời gian dự đoán
        row_data['Predicted_Label'] = predicted_label  # Lưu nhãn dự đoán vào database
        row_data['Confidence_Score'] = confidence # Lưu điểm số confidence vào database
        
        # Chuyển row_data thành DataFrame và lưu vào database
        df = pd.DataFrame([row_data])
        save_dataframe_to_db(df, "nids_production_data")
        
    except Exception as e:
        print(f"❌ Error in background task while saving to database: {e}")

# 5. API ENDPOINT
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
                detail=f"⚠️ Bad Request: Missing {len(missing_cols)} required features (e.g., {list(missing_cols)[:3]}...)"
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

        print(f"⭐ Prediction Success: {results}")

        # Trích xuất lại dictionary đã được lọc đúng thứ tự và số lượng của EXPECTED_FEATURES
        validated_features = df_input.iloc[0].to_dict()

        # Lưu kết quả dự đoán vào database dưới dạng background task
        background_tasks.add_task(
            save_to_database, 
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