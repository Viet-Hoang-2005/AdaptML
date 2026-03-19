import os
import cv2
import numpy as np
import pandas as pd
import random
import joblib
from tqdm import tqdm

# Sklearn Imports
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier
from skimage.feature import graycomatrix, graycoprops

# 0. CẤU HÌNH VÀ THIẾT LẬP
def seed_everything(seed=42):
    random.seed(seed)
    os.environ['PYTHONHASHSEED'] = str(seed)
    np.random.seed(seed)

SEED = 42
seed_everything(SEED)

# Giả lập đường dẫn mount từ Amazon S3 (Trong container, S3 bucket thường được mount vào một thư mục local)
DATA_DIR = os.environ.get('DATA_DIR', '/opt/ml/input/data/training') 
MODEL_DIR = os.environ.get('MODEL_DIR', '/opt/ml/model')
IMG_SIZE = 256

# Đảm bảo thư mục lưu model tồn tại
os.makedirs(MODEL_DIR, exist_ok=True)

# 1. HÀM TRÍCH XUẤT ĐẶC TRƯNG (COLOR + GLCM = 14 Features)
def get_color_stats(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    return [np.mean(hsv[:,:,i]) for i in range(3)] + [np.std(hsv[:,:,i]) for i in range(3)]

def get_glcm_stats(gray):
    glcm = graycomatrix(gray, distances=[1], angles=[0, np.pi/2], levels=256, symmetric=True, normed=True)
    contrast = graycoprops(glcm, 'contrast').flatten()
    correlation = graycoprops(glcm, 'correlation').flatten()
    energy = graycoprops(glcm, 'energy').flatten()
    homogeneity = graycoprops(glcm, 'homogeneity').flatten()
    return np.concatenate([contrast, correlation, energy, homogeneity])

def extract_features(img_path):
    img = cv2.imread(img_path)
    if img is None:
        return None
    img = cv2.resize(img, (IMG_SIZE, IMG_SIZE))
    
    color_features = get_color_stats(img)
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    glcm_features = get_glcm_stats(gray)
    
    return np.concatenate([color_features, glcm_features])

# 2. ĐỌC DỮ LIỆU VÀ CHUẨN BỊ TRAIN
def load_and_extract_data(data_path):
    print(f"[*] Đang tải dữ liệu từ: {data_path}")
    img_paths = []
    labels_raw = []
    
    # Duyệt qua các thư mục con (haze, rain, shine)
    if os.path.exists(data_path):
        for label in os.listdir(data_path):
            label_dir = os.path.join(data_path, label)
            if os.path.isdir(label_dir):
                files = sorted([os.path.join(label_dir, f) for f in os.listdir(label_dir) if f.lower().endswith(('.jpg','.png','.jpeg'))])
                img_paths.extend(files)
                labels_raw.extend([label] * len(files))
    else:
        raise ValueError(f"Thư mục dữ liệu không tồn tại: {data_path}")

    print(f"[+] Tìm thấy {len(img_paths)} ảnh.")
    
    # Mã hóa nhãn
    le = LabelEncoder()
    y_encoded = le.fit_transform(labels_raw)
    
    # Trích xuất đặc trưng
    X_features = []
    print("[*] Bắt đầu trích xuất đặc trưng (Color + GLCM)...")
    for path in tqdm(img_paths):
        features = extract_features(path)
        if features is not None:
            X_features.append(features)
        else:
            print(f"[!] Lỗi đọc ảnh: {path}. Bỏ qua.")
            # Xóa nhãn tương ứng nếu ảnh bị lỗi
            idx = img_paths.index(path)
            y_encoded = np.delete(y_encoded, idx)
            
    X_features = np.array(X_features)
    print(f"[+] Kích thước dữ liệu huấn luyện (X): {X_features.shape}")
    
    return X_features, y_encoded, le

# 3. HUẤN LUYỆN VÀ XUẤT MÔ HÌNH
def train_and_save():
    try:
        X_train, y_train, label_encoder = load_and_extract_data(DATA_DIR)
        
        print("[*] Bắt đầu huấn luyện mô hình XGBoost...")
        # Sử dụng cấu hình cơ bản. Trong môi trường MLOps thực tế, 
        # bạn có thể tích hợp lại Optuna ở đây để tìm best params tự động cho data mới.
        model = XGBClassifier(eval_metric='mlogloss', random_state=SEED, n_jobs=-1)
        model.fit(X_train, y_train)
        print("[+] Huấn luyện hoàn tất.")
        
        # Lưu artifacts
        model_path = os.path.join(MODEL_DIR, 'xgboost_color_glcm_best.pkl')
        le_path = os.path.join(MODEL_DIR, 'label_encoder.pkl')
        
        print(f"[*] Đang lưu mô hình tới: {model_path}")
        joblib.dump(model, model_path)
        joblib.dump(label_encoder, le_path)
        
        print("[+] Xong! Đã xuất các file .pkl thành công.")
        
    except Exception as e:
        print(f"[-] Lỗi trong quá trình huấn luyện: {e}")

if __name__ == "__main__":
    train_and_save()