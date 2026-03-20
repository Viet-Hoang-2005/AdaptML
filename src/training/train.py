import os
import cv2
import numpy as np
import pandas as pd
import random
import joblib

from tqdm import tqdm
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier
from skimage.feature import graycomatrix, graycoprops, hog

# ===================================================================
# 0. CẤU HÌNH VÀ THIẾT LẬP
# ===================================================================
def seed_everything(seed=42):
    random.seed(seed)
    os.environ['PYTHONHASHSEED'] = str(seed)
    np.random.seed(seed)

SEED = 42
seed_everything(SEED)

# Giả lập đường dẫn mount từ Amazon S3 
DATA_DIR = os.environ.get('DATA_DIR', '/opt/ml/input/data/training') 
MODEL_DIR = os.environ.get('MODEL_DIR', '/opt/ml/model')

# Cấu hình kích thước ảnh và tham số HOG
IMG_SIZE = 256
HOG_PPC = 16

# Đảm bảo thư mục lưu model tồn tại
os.makedirs(MODEL_DIR, exist_ok=True)

# ===================================================================
# 1. HÀM TRÍCH XUẤT ĐẶC TRƯNG (COLOR + HOG + GLCM = 17 Features)
# ===================================================================
def get_color_stats(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    return [np.mean(hsv[:,:,i]) for i in range(3)] + [np.std(hsv[:,:,i]) for i in range(3)]

def get_hog_stats(gray):
    hog_v = hog(gray, orientations=12, pixels_per_cell=(HOG_PPC, HOG_PPC), cells_per_block=(2,2), visualize=False, feature_vector=True)
    return [np.mean(hog_v), np.std(hog_v), np.max(hog_v)]

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
    hog_features = get_hog_stats(gray)
    glcm_features = get_glcm_stats(gray)
    
    # Kết hợp chính xác theo thứ tự: Color -> HOG -> GLCM
    return np.concatenate([color_features, hog_features, glcm_features])

# ===================================================================
# 2. ĐỌC DỮ LIỆU VÀ CHUẨN BỊ TRAIN
# ===================================================================
def load_and_extract_data(data_path):
    print(f"[*] Loading data from: {data_path}")
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
        raise ValueError(f"The data folder does not exist: {data_path}")

    print(f"[+] Tìm thấy {len(img_paths)} ảnh.")
    
    # Mã hóa nhãn
    le = LabelEncoder()
    y_encoded = le.fit_transform(labels_raw)
    
    # Trích xuất đặc trưng
    X_features = []
    print("[*] Extracting features (Color + HOG + GLCM)...")
    for path in tqdm(img_paths):
        features = extract_features(path)
        if features is not None:
            X_features.append(features)
        else:
            print(f"[!] Image reading error: {path}. Skip!")
            # Xóa nhãn tương ứng nếu ảnh bị lỗi
            idx = img_paths.index(path)
            y_encoded = np.delete(y_encoded, idx)
            
    X_features = np.array(X_features)
    print(f"[+] Training data size (X): {X_features.shape}")
    
    return X_features, y_encoded, le

# ===================================================================
# 3. HUẤN LUYỆN VÀ XUẤT MÔ HÌNH
# ===================================================================
def train_and_save():
    try:
        X_train, y_train, label_encoder = load_and_extract_data(DATA_DIR)
        
        print("[*] Training the XGBoost model...")
        model = XGBClassifier(eval_metric='mlogloss', random_state=SEED, n_jobs=-1)
        model.fit(X_train, y_train)
        print("[+] Training complete!")
        
        # Cập nhật tên file model thành xgb_best_model.pkl cho khớp với api.py
        model_path = os.path.join(MODEL_DIR, 'xgb_best_model.pkl')
        le_path = os.path.join(MODEL_DIR, 'label_encoder.pkl')
        
        print(f"[*] Saving the model: {model_path}")
        joblib.dump(model, model_path)
        joblib.dump(label_encoder, le_path)
        
        print("[+] Model saved successfully!")
        
    except Exception as e:
        print(f"[-] Errors Training: {e}")

if __name__ == "__main__":
    train_and_save()