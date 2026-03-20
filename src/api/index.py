import os
import cv2
import numpy as np
import joblib
from flask import Flask, request, jsonify
from flask_cors import CORS
from skimage.feature import graycomatrix, graycoprops, hog

# Khởi tạo ứng dụng Flask và cho phép gọi API từ mọi domain (CORS)
app = Flask(__name__)
CORS(app)

# Cấu hình đường dẫn tới model và encoder
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL_PATH = os.path.join(ROOT_DIR, 'models', 'xgb_best_model.pkl')
LE_PATH = os.path.join(ROOT_DIR, 'models', 'label_encoder.pkl')

# Cấu hình kích thước ảnh và thông số HOG (đồng bộ với quá trình huấn luyện)
IMG_SIZE = (256, 256)
HOG_PPC = 16

# Load model và label encoder
try:
    model = joblib.load(MODEL_PATH)
    le = joblib.load(LE_PATH)
    print(f"✅ The XGBoost model has been successfully loaded!")
except Exception as e:
    print(f"❌ ERROR: Could not load model. Details: {e}")
    model = le = None

# Hàm trích xuất đặc trưng từ ảnh (Color + HOG + GLCM = 17 features)
def extract_features(image):
    # 1. Color Moments (6 đặc trưng)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mean_hsv = [np.mean(hsv[:,:,i]) for i in range(3)]
    std_hsv = [np.std(hsv[:,:,i]) for i in range(3)]
    feat_color = np.array(mean_hsv + std_hsv)

    # Chuyển ảnh sang ảnh xám dùng chung cho HOG và GLCM
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # 2. HOG (3 đặc trưng)
    hog_v = hog(gray, orientations=12, pixels_per_cell=(HOG_PPC, HOG_PPC), cells_per_block=(2,2), visualize=False, feature_vector=True)
    feat_hog = np.array([np.mean(hog_v), np.std(hog_v), np.max(hog_v)])

    # 3. GLCM (8 đặc trưng)
    glcm = graycomatrix(gray, distances=[1], angles=[0, np.pi/2], levels=256, symmetric=True, normed=True)
    contrast = graycoprops(glcm, 'contrast').flatten()
    correlation = graycoprops(glcm, 'correlation').flatten()
    energy = graycoprops(glcm, 'energy').flatten()
    homogeneity = graycoprops(glcm, 'homogeneity').flatten()
    feat_glcm = np.concatenate([contrast, correlation, energy, homogeneity])
    
    # 4. Kết hợp thành vector 17 chiều (Color -> HOG -> GLCM)
    final_features = np.hstack([feat_color, feat_hog, feat_glcm])
    return final_features

# API endpoint để nhận ảnh và trả về dự đoán từ model
@app.route('/predict', methods=['POST'])
def predict_weather():
    # 1. Kiểm tra trạng thái model
    if model is None or le is None:
        return jsonify({"success": False, "error": "The model has not been initialized on the server."}), 500
        
    # 2. Kiểm tra dữ liệu đầu vào
    if 'image' not in request.files:
        return jsonify({"success": False, "error": "Image data not found! Key body must be 'image'."}), 400
        
    file = request.files['image']
    if file.filename == '':
        return jsonify({"success": False, "error": "Empty image file!"}), 400

    try:
        # 3. Đọc ảnh trực tiếp từ bộ nhớ (không cần lưu xuống ổ cứng)
        file_bytes = np.frombuffer(file.read(), np.uint8)
        image = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
        
        if image is None:
            return jsonify({"success": False, "error": "Invalid image format!"}), 400

        # 4. Tiền xử lý và dự đoán
        image_resized = cv2.resize(image, IMG_SIZE)
        features = extract_features(image_resized).reshape(1, -1)
        probas = model.predict_proba(features)[0]
        
        # 5. Format kết quả thành dictionary %
        results = {
            str(le.inverse_transform([i])[0]): round(float(probas[i]) * 100, 2) 
            for i in range(len(probas))
        }
        
        print(f"🌟 Success: {results}")

        return jsonify({
            "success": True,
            "predictions": results
        }), 200
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)