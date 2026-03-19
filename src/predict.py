import sys
import os
import cv2
import numpy as np
import joblib
import json
import argparse
import warnings

# Tắt các cảnh báo (warnings) để đảm bảo Standard Output (stdout) chỉ chứa duy nhất chuỗi JSON
warnings.filterwarnings('ignore')

from skimage.feature import graycomatrix, graycoprops

# 1. HÀM TRÍCH XUẤT ĐẶC TRƯNG 
def extract_features(image_path):
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Không thể đọc được ảnh từ đường dẫn: {image_path}")
    
    # Tiền xử lý: Resize về 256x256
    image_resized = cv2.resize(image, (256, 256))
    
    # 1. Color Moments (HSV - 6 đặc trưng)
    hsv = cv2.cvtColor(image_resized, cv2.COLOR_BGR2HSV)
    mean_hsv = [np.mean(hsv[:,:,i]) for i in range(3)]
    std_hsv = [np.std(hsv[:,:,i]) for i in range(3)]
    feat_color = np.array(mean_hsv + std_hsv)

    # 2. GLCM (Texture - 5 đặc trưng)
    gray = cv2.cvtColor(image_resized, cv2.COLOR_BGR2GRAY)
    glcm = graycomatrix(gray, distances=[5], angles=[0], levels=256, symmetric=True, normed=True)
    
    # Danh sách 5 thuộc tính khớp với hàm extract_glcm_features trong notebook
    contrast = graycoprops(glcm, 'contrast')[0, 0]
    dissimilarity = graycoprops(glcm, 'dissimilarity')[0, 0]
    homogeneity = graycoprops(glcm, 'homogeneity')[0, 0]
    energy = graycoprops(glcm, 'energy')[0, 0]
    correlation = graycoprops(glcm, 'correlation')[0, 0]
    
    feat_glcm = np.array([contrast, dissimilarity, homogeneity, energy, correlation])
    
    # 3. Kết hợp thành vector 11 chiều (6 Color + 5 GLCM)
    return np.hstack([feat_color, feat_glcm])

# 2. HÀM DỰ ĐOÁN CHÍNH (INFERENCE)
def predict(image_path, model_path, le_path):
    try:
        # Kiểm tra sự tồn tại của file mô hình
        if not os.path.exists(model_path) or not os.path.exists(le_path):
            raise FileNotFoundError("Không tìm thấy file mô hình (.pkl) hoặc bộ giải mã.")
            
        # Nạp mô hình (Load Artifacts)
        model = joblib.load(model_path)
        le = joblib.load(le_path)
        
        # Rút trích đặc trưng từ ảnh đầu vào
        features = extract_features(image_path).reshape(1, -1)
        
        # Suy luận (Predict)
        probas = model.predict_proba(features)[0]
        predicted_idx = np.argmax(probas)
        predicted_label = le.inverse_transform([predicted_idx])[0]
        confidence = float(probas[predicted_idx])
        
        # Tạo payload JSON trả về cho backend Nest.js
        result = {
            "status": "success",
            "prediction": predicted_label,
            "confidence": round(confidence, 4),
            "probabilities": {le.inverse_transform([i])[0]: round(float(probas[i]), 4) for i in range(len(probas))}
        }
        
        # In chuỗi JSON ra Standard Output (stdout)
        print(json.dumps(result))
        
    except Exception as e:
        # Nếu có lỗi, trả về JSON chứa thông báo lỗi để Nest.js xử lý ngoại lệ (Exception Handling)
        error_result = {
            "status": "error",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)

# 3. GIAO TIẾP VỚI DÒNG LỆNH (CLI)
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Script dự đoán thời tiết từ ảnh")
    parser.add_argument("--image", type=str, required=True, help="Đường dẫn đến file ảnh cần dự đoán")
    parser.add_argument("--model", type=str, default="models/xgboost_color_glcm_best.pkl", help="Đường dẫn file model")
    parser.add_argument("--le", type=str, default="models/label_encoder.pkl", help="Đường dẫn file label encoder")
    
    args = parser.parse_args()
    predict(args.image, args.model, args.le)