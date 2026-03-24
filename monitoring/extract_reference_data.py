import os
import cv2
import json
import pandas as pd
from tqdm import tqdm
from api import extract_features, get_column_names

# 1. CẤU HÌNH ĐƯỜNG DẪN VÀ THAM SỐ
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DATA_DIR = os.path.join(ROOT_DIR, 'data', 'raw_images')
OUTPUT_CSV = os.path.join(ROOT_DIR, 'data', 'reference_data.csv')
CONFIG_PATH = os.path.join(ROOT_DIR, 'models', 'feature_config.json')

IMG_SIZE = (256, 256)

# Đọc cấu hình features từ file JSON
try:
    with open(CONFIG_PATH, 'r') as f:
        ACTIVE_FEATURES = json.load(f)
    print(f"[+] The features configuration has been successfully loaded: {ACTIVE_FEATURES}")
except Exception as e:
    print(f"[-] Error reading configuration file: {e}")
    print("[*] Fallback: Use default ['Color', 'HOG', 'GLCM']")
    ACTIVE_FEATURES = ["Color", "HOG", "GLCM"]


# 2. VÒNG LẶP CHÍNH ĐỂ TẠO DATASET
def create_reference_dataset():
    print(f"[*] Scanning image folders at: {RAW_DATA_DIR}")
    
    if not os.path.exists(RAW_DATA_DIR):
        print("[-] Error: The folder containing images not found!")
        return

    dataset_rows = []
    
    for label_name in os.listdir(RAW_DATA_DIR):
        label_dir = os.path.join(RAW_DATA_DIR, label_name)
        
        if not os.path.isdir(label_dir):
            continue
            
        print(f"\n[*] Labels are being processed: {label_name}...")
        image_files = [f for f in os.listdir(label_dir) if f.lower().endswith(('.jpg', '.png', '.jpeg'))]
        
        for img_name in tqdm(image_files):
            img_path = os.path.join(label_dir, img_name)
            img = cv2.imread(img_path)
            
            if img is not None:
                img_resized = cv2.resize(img, IMG_SIZE)
                
                # Gọi hàm dùng chung từ feature_extractor
                features = extract_features(img_resized, ACTIVE_FEATURES)
                
                row_data = [img_name] + features.tolist()
                row_data.append(label_name.lower())
                dataset_rows.append(row_data)
            else:
                print(f"[-] Error reading images: {img_name}")

    print(f"\n[+] Total number of images extracted: {len(dataset_rows)}")
    
    cols = get_column_names(ACTIVE_FEATURES)
    print(f"[*] The generated DataFrame structure: {len(cols)} col.")
    
    df = pd.DataFrame(dataset_rows, columns=cols)
    
    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    df.to_csv(OUTPUT_CSV, index=False)
    
    print(f"[+] Success! The Reference Dataset file has been saved at:\n {OUTPUT_CSV}")

if __name__ == "__main__":
    create_reference_dataset()