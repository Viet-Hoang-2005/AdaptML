import cv2
import numpy as np
from skimage.feature import graycomatrix, graycoprops, hog, local_binary_pattern

# Hằng số thông số HOG
HOG_PPC = 16

# 1. CÁC HÀM TRÍCH XUẤT ĐẶC TRƯNG LÕI
def get_color(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    return [np.mean(hsv[:,:,i]) for i in range(3)] + [np.std(hsv[:,:,i]) for i in range(3)]

def get_hog(gray):
    hog_v = hog(gray, orientations=12, pixels_per_cell=(HOG_PPC, HOG_PPC), cells_per_block=(2,2), visualize=False, feature_vector=True)
    return [np.mean(hog_v), np.std(hog_v), np.max(hog_v)]

def get_glcm(gray):
    glcm = graycomatrix(gray, distances=[1], angles=[0, np.pi/2], levels=256, symmetric=True, normed=True)
    return np.concatenate([graycoprops(glcm, p).flatten() for p in ['contrast', 'correlation', 'energy', 'homogeneity']])

def get_sobel(gray):
    sx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3); sy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    mag = np.sqrt(sx**2 + sy**2)
    return [np.mean(mag), np.var(mag)]

def get_lbp(gray):
    lbp = local_binary_pattern(gray, P=8, R=1, method="uniform")
    hist, _ = np.histogram(lbp.ravel(), bins=10, range=(0, 10))
    hist = hist.astype("float"); return hist / (hist.sum() + 1e-7)

# 2. HÀM GỘP CHUNG
def extract_features(img, active_features):
    """
    Hàm nhận vào ảnh màu BGR (đã resize) và danh sách features cần trích xuất.
    Trả về một numpy array 1 chiều chứa toàn bộ các đặc trưng.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    features_list = []
    
    for feat_name in active_features:
        if feat_name == "Color":
            features_list.append(get_color(img))
        elif feat_name == "HOG":
            features_list.append(get_hog(gray))
        elif feat_name == "GLCM":
            features_list.append(get_glcm(gray))
        elif feat_name == "Sobel":
            features_list.append(get_sobel(gray))
        elif feat_name == "LBP":
            features_list.append(get_lbp(gray))
            
    return np.concatenate(features_list)

# 3. HÀM TẠO TÊN CỘT
def get_column_names(active_features):
    """
    Hàm sinh tên cột tự động dựa trên danh sách features đang kích hoạt.
    """
    cols = ['image_name']
    
    for feat in active_features:
        if feat == "Color":
            cols.extend(['hsv_mean_h', 'hsv_mean_s', 'hsv_mean_v', 'hsv_std_h', 'hsv_std_s', 'hsv_std_v'])
        elif feat == "HOG":
            cols.extend(['hog_mean', 'hog_std', 'hog_max'])
        elif feat == "GLCM":
            cols.extend([
                'glcm_contrast_0', 'glcm_contrast_90', 
                'glcm_correlation_0', 'glcm_correlation_90',
                'glcm_energy_0', 'glcm_energy_90', 
                'glcm_homogeneity_0', 'glcm_homogeneity_90'
            ])
        elif feat == "Sobel":
            cols.extend(['sobel_mean', 'sobel_var'])
        elif feat == "LBP":
            cols.extend([f'lbp_bin_{i}' for i in range(10)])
            
    cols.append('target_label')
    return cols