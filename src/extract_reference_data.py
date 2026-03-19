import os
import cv2
import numpy as np
import pandas as pd
from tqdm import tqdm
from skimage.feature import graycomatrix, graycoprops


# 1. CẤU HÌNH ĐƯỜNG DẪN
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DATA_DIR = os.path.join(ROOT_DIR, 'data', 'raw_images')
OUTPUT_CSV = os.path.join(ROOT_DIR, 'data', 'reference_data.csv')
IMG_SIZE = 256

# 2. HÀM TRÍCH XUẤT ĐẶC TRƯNG (Đồng bộ 14 Features)
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

# 3. ĐỊNH NGHĨA TÊN CỘT CHO FILE CSV
COLUMN_NAMES = [
    # 6 Color Features
    'hsv_mean_h', 'hsv_mean_s', 'hsv_mean_v', 
    'hsv_std_h', 'hsv_std_s', 'hsv_std_v',
    # 8 GLCM Features (4 thuộc tính x 2 góc [0, 90 độ])
    'glcm_contrast_0', 'glcm_contrast_90',
    'glcm_correlation_0', 'glcm_correlation_90',
    'glcm_energy_0', 'glcm_energy_90',
    'glcm_homogeneity_0', 'glcm_homogeneity_90',
    # Cột Nhãn
    'target_label'
]

# 4. CHẠY VÒNG LẶP XỬ LÝ
def create_reference_dataset():
    print(f"[*] Đang quét thư mục ảnh gốc tại: {RAW_DATA_DIR}")
    
    if not os.path.exists(RAW_DATA_DIR):
        print("[-] LỖI: Không tìm thấy thư mục chứa ảnh gốc. Vui lòng kiểm tra lại cấu hình RAW_DATA_DIR.")
        return

    dataset_rows = []
    
    # Duyệt qua các thư mục con (chính là tên nhãn: Haze, Rain, Shine)
    for label_name in os.listdir(RAW_DATA_DIR):
        label_dir = os.path.join(RAW_DATA_DIR, label_name)
        
        if not os.path.isdir(label_dir):
            continue
            
        print(f"\n[*] Đang xử lý nhãn: {label_name}...")
        image_files = [f for f in os.listdir(label_dir) if f.lower().endswith(('.jpg', '.png', '.jpeg'))]
        
        for img_name in tqdm(image_files):
            img_path = os.path.join(label_dir, img_name)
            
            # Trích xuất 14 đặc trưng
            features = extract_features(img_path)
            
            if features is not None:
                # Ép kiểu về list và thêm nhãn (label) vào cuối mảng
                row_data = features.tolist()
                row_data.append(label_name.lower()) # Chuyển nhãn về chữ thường (haze, rain, shine)
                dataset_rows.append(row_data)
            else:
                print(f"[-] Lỗi đọc ảnh: {img_name}")

    print(f"\n[+] Tổng số ảnh trích xuất thành công: {len(dataset_rows)}")
    
    # Tạo DataFrame và lưu ra CSV
    print(f"[*] Đang xuất ra file CSV...")
    df = pd.DataFrame(dataset_rows, columns=COLUMN_NAMES)
    
    # Đảm bảo thư mục lưu file CSV tồn tại
    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    df.to_csv(OUTPUT_CSV, index=False)
    
    print(f"SUCCESS! File Reference Dataset đã được lưu tại:\n {OUTPUT_CSV}")

if __name__ == "__main__":
    create_reference_dataset()