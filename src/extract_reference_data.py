import os
import cv2
import numpy as np
import pandas as pd
from tqdm import tqdm
from skimage.feature import graycomatrix, graycoprops, hog

# 1. Cấu hình đường dẫn và tham số
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DATA_DIR = os.path.join(ROOT_DIR, 'data', 'raw_images')
OUTPUT_CSV = os.path.join(ROOT_DIR, 'data', 'reference_data.csv')

IMG_SIZE = 256
HOG_PPC = 16

# 2. Hàm trích xuất đặc trưng (Color + HOG + GLCM = 17 Features)
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
    
    # 2.1 Color Features
    color_features = get_color_stats(img)
    
    # Chuyển ảnh xám để dùng chung cho HOG và GLCM
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # 2.2 HOG Features
    hog_features = get_hog_stats(gray)
    
    # 2.3 GLCM Features
    glcm_features = get_glcm_stats(gray)
    
    # 2.4 Gộp theo đúng thứ tự: Color -> HOG -> GLCM
    return np.concatenate([color_features, hog_features, glcm_features])

# 3. Định nghia tên cột cho DataFrame (17 đặc trưng + 1 cột nhãn)
COLUMN_NAMES = [
    # 6 Color Features
    'hsv_mean_h', 'hsv_mean_s', 'hsv_mean_v', 
    'hsv_std_h', 'hsv_std_s', 'hsv_std_v',
    
    # 3 HOG Features
    'hog_mean', 'hog_std', 'hog_max',
    
    # 8 GLCM Features (4 thuộc tính x 2 góc [0, 90 độ])
    'glcm_contrast_0', 'glcm_contrast_90',
    'glcm_correlation_0', 'glcm_correlation_90',
    'glcm_energy_0', 'glcm_energy_90',
    'glcm_homogeneity_0', 'glcm_homogeneity_90',
    
    # Cột Nhãn
    'target_label'
]

# 4. Vòng lặp chính để quét thư mục ảnh, trích xuất đặc trưng và lưu vào DataFrame
def create_reference_dataset():
    print(f"[*] Đang quét thư mục ảnh gốc tại: {RAW_DATA_DIR}")
    
    if not os.path.exists(RAW_DATA_DIR):
        print("[-] LỖI: Không tìm thấy thư mục chứa ảnh gốc!")
        return

    dataset_rows = []
    
    # Duyệt qua các thư mục con (Haze, Rain, Shine)
    for label_name in os.listdir(RAW_DATA_DIR):
        label_dir = os.path.join(RAW_DATA_DIR, label_name)
        
        if not os.path.isdir(label_dir):
            continue
            
        print(f"\n[*] Đang xử lý nhãn: {label_name}...")
        image_files = [f for f in os.listdir(label_dir) if f.lower().endswith(('.jpg', '.png', '.jpeg'))]
        
        for img_name in tqdm(image_files):
            img_path = os.path.join(label_dir, img_name)
            
            # Trích xuất 17 đặc trưng
            features = extract_features(img_path)
            
            if features is not None:
                # Ép kiểu về list và thêm nhãn (label) vào cuối mảng
                row_data = features.tolist()
                row_data.append(label_name.lower()) # Chuyển nhãn về chữ thường
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