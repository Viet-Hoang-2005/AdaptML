import gradio as gr
import joblib
import cv2
import numpy as np
import os
from skimage.feature import graycomatrix, graycoprops

# --- 1. CẤU HÌNH ĐƯỜNG DẪN ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, 'models', 'xgboost_color_glcm_best.pkl')
LE_PATH = os.path.join(BASE_DIR, 'models', 'label_encoder.pkl')
IMG_SIZE = (256, 256)

# --- 2. LOAD MODEL & ENCODER ---
try:
    model = joblib.load(MODEL_PATH)
    le = joblib.load(LE_PATH)
    print(f"✅ Đã load thành công model từ: {MODEL_PATH}")
except Exception as e:
    print(f"❌ LỖI: Không thể load file. Hãy đảm bảo file .pkl nằm cùng thư mục với code.")
    model = le = None

def extract_features_for_demo(image):
    # 1. Color Moments (HSV - 6 đặc trưng)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mean_hsv = [np.mean(hsv[:,:,i]) for i in range(3)]
    std_hsv = [np.std(hsv[:,:,i]) for i in range(3)]
    feat_color = np.array(mean_hsv + std_hsv)

    # 2. GLCM (Texture - 8 đặc trưng) - Đã đồng bộ với mlops.ipynb
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # Cập nhật lại distances=[1] và angles=[0, np.pi/2]
    glcm = graycomatrix(gray, distances=[1], angles=[0, np.pi/2], levels=256, symmetric=True, normed=True)
    
    # Lấy 4 thuộc tính và làm phẳng mảng (flatten) để lấy giá trị cho cả 2 góc
    contrast = graycoprops(glcm, 'contrast').flatten()
    correlation = graycoprops(glcm, 'correlation').flatten()
    energy = graycoprops(glcm, 'energy').flatten()
    homogeneity = graycoprops(glcm, 'homogeneity').flatten()
    
    feat_glcm = np.concatenate([contrast, correlation, energy, homogeneity])
    
    # 3. Kết hợp thành vector 14 chiều (6 Color + 8 GLCM)
    final_features = np.hstack([feat_color, feat_glcm])
    return final_features

# --- 4. HÀM DỰ ĐOÁN ---
def predict_weather(image):
    if model is None or le is None:
        return "Lỗi: Model chưa được load"
    if image is None: return None

    # Chuyển RGB (Gradio) sang BGR (OpenCV) và resize
    image_bgr = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    image_resized = cv2.resize(image_bgr, IMG_SIZE)
    
    # Trích xuất và dự báo nhãn tốt nhất
    features = extract_features_for_demo(image_resized).reshape(1, -1)
    pred_idx = model.predict(features)[0] 
    
    # Ép kiểu np.str_ thành str của Python
    result_label = str(le.inverse_transform([pred_idx])[0])
    return result_label

# --- 5. GIAO DIỆN ---
iface = gr.Interface(
    fn=predict_weather,
    inputs=gr.Image(type="numpy"),
    outputs=gr.Textbox(label="Kết quả dự đoán"),
    title="CS231: Weather Image Classification",
    show_progress="hidden",
    flagging_mode="never"
)

if __name__ == "__main__":
    iface.launch()