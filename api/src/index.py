import os
import numpy as np
import pandas as pd
import joblib
import uvicorn

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Dict
from src.db_manager import save_dataframe_to_db

# 1. KHỞI TẠO FASTAPI
app = FastAPI(
    title="NIDS MLOps API",
    description="The cyberattack detection system (BENIGN, DDoS, PortScan) uses the XGBoost algorithm.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. CẤU HÌNH ĐƯỜNG DẪN VÀ THAM SỐ
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL_PATH = os.path.join(ROOT_DIR, 'models', 'v1', 'xgb_nids_model_v1.pkl')
LE_PATH = os.path.join(ROOT_DIR, 'models', 'v1', 'label_nids_encoder_v1.pkl')

# 3. LOAD MODEL VÀ ĐỌC FILE CẤU HÌNH FEATURES
try:
    model = joblib.load(MODEL_PATH)
    le = joblib.load(LE_PATH)
    print(f"✅ The XGBoost Multiclass model and Label Encoder have been successfully loaded!")
except Exception as e:
    print(f"❌ Error! Could not load model. Details: {e}")
    model = le = None

class NetworkTraffic(BaseModel):
    features: Dict[str, float]

# 4. HÀM CHẠY NGẦM (BACKGROUND TASK) ĐỂ LƯU DATABASE
def save_to_database(features_dict: dict, predicted_label: str, confidence: float):
    try:
        row_data = features_dict.copy()
        row_data['Predicted_Label'] = predicted_label
        row_data['Confidence_Score'] = confidence
        
        df = pd.DataFrame([row_data])
        save_dataframe_to_db(df, "nids_production_data")
        
    except Exception as e:
        print(f"[-] Error in background task while saving to database: {e}")

# 5. API ENDPOINT
# API endpoint để nhận payload JSON chứa đặc trưng mạng và trả về dự đoán
@app.post("/predict")
async def predict_intrusion(payload: NetworkTraffic, background_tasks: BackgroundTasks):
    if model is None or le is None:
        raise HTTPException(status_code=500, detail="Error! The model has not been initialized on the server")

    try:
        df_input = pd.DataFrame([payload.features])
        probas = model.predict_proba(df_input)[0]
        
        best_class_idx = np.argmax(probas)
        predicted_label = str(le.inverse_transform([best_class_idx])[0])
        confidence = float(probas[best_class_idx])
        
        results = {
            str(le.inverse_transform([i])[0]): round(float(probas[i]) * 100, 2) 
            for i in range(len(probas))
        }

        print(f"⭐ Prediction Success: {results}")

        background_tasks.add_task(
            save_to_database, 
            features_dict=payload.features, 
            predicted_label=predicted_label,
            confidence=confidence
        )

        return JSONResponse(
            content={
                "success": True,
                "prediction": predicted_label,
                "confidence": round(confidence * 100, 2),
                "probabilities": results
            },
            status_code=200
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("index:app", host="0.0.0.0", port=5000, reload=True)