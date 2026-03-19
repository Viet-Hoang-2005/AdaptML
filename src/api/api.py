import os
import cv2
import numpy as np
import joblib
from flask import Flask, request, jsonify
from flask_cors import CORS
from skimage.feature import graycomatrix, graycoprops

# Khởi tạo ứng dụng Flask và cho phép gọi API từ mọi domain (CORS)
app = Flask(__name__)
CORS(app)

# Cấu hình đường dẫn đến mô hình học máy và bộ giải mã
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, 'models', 'xgboost_color_glcm_best.pkl')
LE_PATH = os.path.join(BASE_DIR, 'models', 'label_encoder.pkl')
IMG_SIZE = (256, 256)

# Load model
try:
    model = joblib.load(MODEL_PATH)
    le = joblib.load(LE_PATH)
    print(f"✅ Đã load thành công model XGBoost.")
except Exception as e:
    print(f"❌ LỖI: Không thể load model. Chi tiết: {e}")
    model = le = None

# Hàm trích xuất đặc trưng từ ảnh (Color Moments + GLCM)
def extract_features(image):
    # 1. Color Moments (6 đặc trưng)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    feat_color = np.array([np.mean(hsv[:,:,i]) for i in range(3)] + [np.std(hsv[:,:,i]) for i in range(3)])

    # 2. GLCM (8 đặc trưng)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    glcm = graycomatrix(gray, distances=[1], angles=[0, np.pi/2], levels=256, symmetric=True, normed=True)
    
    contrast = graycoprops(glcm, 'contrast').flatten()
    correlation = graycoprops(glcm, 'correlation').flatten()
    energy = graycoprops(glcm, 'energy').flatten()
    homogeneity = graycoprops(glcm, 'homogeneity').flatten()
    
    feat_glcm = np.concatenate([contrast, correlation, energy, homogeneity])
    
    # Kết hợp thành vector 14 chiều
    return np.hstack([feat_color, feat_glcm])

# API endpoint để nhận ảnh và trả về dự đoán
@app.route('/predict', methods=['POST'])
def predict_weather():
    # 1. Kiểm tra trạng thái model
    if model is None or le is None:
        return jsonify({"success": False, "error": "Model chưa được khởi tạo trên server"}), 500
        
    # 2. Kiểm tra dữ liệu đầu vào
    if 'image' not in request.files:
        return jsonify({"success": False, "error": "Không tìm thấy dữ liệu ảnh. Key body phải là 'image'"}), 400
        
    file = request.files['image']
    if file.filename == '':
        return jsonify({"success": False, "error": "File ảnh rỗng"}), 400

    try:
        # 3. Đọc ảnh trực tiếp từ bộ nhớ (không cần lưu xuống ổ cứng)
        file_bytes = np.frombuffer(file.read(), np.uint8)
        image = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
        
        if image is None:
            return jsonify({"success": False, "error": "Định dạng ảnh không hợp lệ hoặc bị hỏng"}), 400

        # 4. Tiền xử lý và dự đoán
        image_resized = cv2.resize(image, IMG_SIZE)
        features = extract_features(image_resized).reshape(1, -1)
        probas = model.predict_proba(features)[0]
        
        # 5. Format kết quả thành dictionary %
        results = {
            str(le.inverse_transform([i])[0]): round(float(probas[i]) * 100, 2) 
            for i in range(len(probas))
        }
        
        return jsonify({
            "success": True,
            "predictions": results
        }), 200
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)