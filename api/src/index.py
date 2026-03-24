import os
import cv2
import numpy as np
import pandas as pd
import joblib
import json
import uvicorn

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from src.feature_extractor import extract_features, get_column_names
from src.db_manager import save_dataframe_to_db

# 1. KHỞI TẠO FASTAPI
app = FastAPI(
    title="Weather Classification API",
    description="The API system for machine learning models uses XGBoost to classify weather based on images.",
    version="1.0.0"
)

# Cho phép gọi API từ mọi domain (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. CẤU HÌNH ĐƯỜNG DẪN VÀ THAM SỐ
# Cấu hình đường dẫn tới model và encoder
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL_PATH = os.path.join(ROOT_DIR, 'models', 'xgb_best_model.pkl')
LE_PATH = os.path.join(ROOT_DIR, 'models', 'label_encoder.pkl')
CONFIG_PATH = os.path.join(ROOT_DIR, 'models', 'feature_config.json')

IMG_SIZE = (256, 256)

# 3. LOAD MODEL VÀ ĐỌC FILE CẤU HÌNH FEATURES
try:
    model = joblib.load(MODEL_PATH)
    le = joblib.load(LE_PATH)

    # Đọc danh sách các đặc trưng cần dùng từ file JSON
    with open(CONFIG_PATH, 'r') as f:
        ACTIVE_FEATURES = json.load(f)

    print(f"✅ The XGBoost model has been successfully loaded! The combo features used are: {ACTIVE_FEATURES}")
except Exception as e:
    print(f"❌ Error! Could not load model. Details: {e}")
    model = le = ACTIVE_FEATURES = None

# 4. HÀM CHẠY NGẦM (BACKGROUND TASK) ĐỂ LƯU DATABASE
def save_to_database(filename: str, features_1d: np.ndarray, active_features: list, predicted_label: str):
    try:
        # 1. Lấy danh sách tên cột động dựa trên cấu hình hiện tại
        cols = get_column_names(active_features)
        
        # 2. Ghép dữ liệu thành 1 mảng duy nhất
        row_data = [filename] + features_1d.tolist() + [predicted_label]
        
        # 3. Chuyển thành Pandas DataFrame (1 dòng)
        df = pd.DataFrame([row_data], columns=cols)
        
        # 4. Lưu vào PostgreSQL, đặt tên bảng là 'production_data'
        save_dataframe_to_db(df, "production_data")
        
    except Exception as e:
        print(f"[-] Error in background task while saving to database: {e}")

# 5. API ENDPOINT
# API endpoint để nhận ảnh và trả về dự đoán từ model
@app.post("/predict")
async def predict_weather(background_tasks: BackgroundTasks, image: UploadFile = File(...)):
    # 1. Kiểm tra trạng thái model
    if model is None or le is None:
        raise HTTPException(status_code=500, detail="Error! The model has not been initialized on the server")
        
    # 2. Kiểm tra file (FastAPI tự động validate key 'image', ta chỉ cần check tên file)
    if not image.filename:
        raise HTTPException(status_code=400, detail="Error! Empty image file")

    try:
        # 3. Đọc ảnh trực tiếp từ bộ nhớ một cách bất đồng bộ
        file_bytes = np.frombuffer(await image.read(), np.uint8)
        img_cv = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
        
        if img_cv is None:
            raise HTTPException(status_code=400, detail="Invalid image format!")

        # 4. Tiền xử lý trích xuất đặc trưng và dự đoán
        image_resized = cv2.resize(img_cv, IMG_SIZE)
        features_1d = extract_features(image_resized, ACTIVE_FEATURES) # Lấy mảng 1 chiều để lưu DB
        features_2d = features_1d.reshape(1, -1) # Reshape thành 2 chiều để đưa vào mô hình XGBoost
        
        probas = model.predict_proba(features_2d)[0]
        
        # 5. Lấy nhãn có xác suất cao nhất để lưu vào DB
        best_class_idx = np.argmax(probas)
        predicted_label = str(le.inverse_transform([best_class_idx])[0])

        # 6. Format kết quả thành dictionary %
        results = {
            str(le.inverse_transform([i])[0]): round(float(probas[i]) * 100, 2) 
            for i in range(len(probas))
        }
        
        print(f"⭐ Prediction Success: {results}")

        background_tasks.add_task(
            save_to_database, 
            filename=image.filename, 
            features_1d=features_1d, 
            active_features=ACTIVE_FEATURES, 
            predicted_label=predicted_label
        )

        return JSONResponse(
            content={
                "success": True,
                "predictions": results
            },
            status_code=200
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("index:app", host="0.0.0.0", port=5000, reload=True)