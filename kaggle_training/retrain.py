import os
import cv2
import random
import itertools
import optuna
import gc
import joblib
import json
import numpy as np
import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt
import boto3

from tqdm import tqdm
from dotenv import load_dotenv
from xgboost import XGBClassifier
from kaggle_secrets import UserSecretsClient
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.utils.class_weight import compute_sample_weight
from sklearn.metrics import f1_score, classification_report, confusion_matrix
from skimage.feature import hog, local_binary_pattern, graycomatrix, graycoprops
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split

optuna.logging.set_verbosity(optuna.logging.WARNING)
pd.set_option('display.float_format', lambda x: '%.4f' % x)

# ===================================================================
# 0. ENVIRONMENT SETUP
# ===================================================================
IS_KAGGLE = os.path.exists('/kaggle/working')

if IS_KAGGLE:
    ARTIFACT_DIR = '/kaggle/working'
    DATA_SOURCES = {
        'haze': '/kaggle/input/weather-dataset/dataset/fogsmog',
        'rain': '/kaggle/input/weather-dataset/dataset/rain',
        'shine': '/kaggle/input/multiclass-weather-dataset/Multi-class Weather Dataset/Shine'
    }
else:
    # Local environment setup
    ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ARTIFACT_DIR = os.path.join(ROOT_DIR, 'models')
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    
    RAW_DATA_DIR = os.path.join(ROOT_DIR, 'data', 'raw_images')
    DATA_SOURCES = {
        'haze': os.path.join(RAW_DATA_DIR, 'haze'),
        'rain': os.path.join(RAW_DATA_DIR, 'rain'),
        'shine': os.path.join(RAW_DATA_DIR, 'shine')
    }

def seed_everything(seed=42):
    random.seed(seed)
    os.environ['PYTHONHASHSEED'] = str(seed)
    np.random.seed(seed)

SEED = 42
seed_everything(SEED)

IMG_SIZE = 256
HOG_PPC = 16

print(f"[0] LOADING PATHS (Environment: {'Kaggle' if IS_KAGGLE else 'Local'})...")
img_paths, labels_raw = [], []
for label, path in DATA_SOURCES.items():
    if os.path.exists(path):
        files = sorted([os.path.join(path, f) for f in os.listdir(path) if f.lower().endswith(('.jpg','.png','.jpeg'))])
        img_paths.extend(files)
        labels_raw.extend([label] * len(files))

if not img_paths:
    raise ValueError(f"No images found! Please check your DATA_SOURCES paths.")

le = LabelEncoder()
y_encoded = le.fit_transform(labels_raw)
class_names = le.classes_

# ===================================================================
# 1. FEATURE EXTRACTION
# ===================================================================
def get_color_stats(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    return [np.mean(hsv[:,:,i]) for i in range(3)] + [np.std(hsv[:,:,i]) for i in range(3)]

def get_sobel_stats(gray):
    sx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3); sy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    mag = np.sqrt(sx**2 + sy**2)
    return [np.mean(mag), np.var(mag)]

def get_lbp_hist(gray):
    lbp = local_binary_pattern(gray, P=8, R=1, method="uniform")
    hist, _ = np.histogram(lbp.ravel(), bins=10, range=(0, 10))
    hist = hist.astype("float"); return hist / (hist.sum() + 1e-7)

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

def extract_all(paths):
    l_c, l_s, l_l, l_h, l_glcm = [], [], [], [], []
    print("[1] Extracting features...")
    for path in tqdm(paths):
        img = cv2.imread(path); img = cv2.resize(img, (IMG_SIZE, IMG_SIZE))
        l_c.append(get_color_stats(img))
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        l_s.append(get_sobel_stats(gray)); l_l.append(get_lbp_hist(gray))
        l_h.append(get_hog_stats(gray)); l_glcm.append(get_glcm_stats(gray))
    return {'Color': np.array(l_c), 'Sobel': np.array(l_s), 'LBP': np.array(l_l), 'HOG': np.array(l_h), 'GLCM': np.array(l_glcm)}

all_features = extract_all(img_paths)

indices = np.arange(len(img_paths))
X_train_idx, X_test_idx, y_train, y_test = train_test_split(indices, y_encoded, test_size=0.2, random_state=SEED, stratify=y_encoded)
cv_strategy = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)

base_features = ['Color', 'Sobel', 'LBP', 'HOG', 'GLCM']
all_combinations = []
for r in range(1, len(base_features) + 1):
    for combo in itertools.combinations(base_features, r):
        all_combinations.append({'name': " + ".join(combo), 'components': list(combo)})

# ===================================================================
# 2. MAIN LOOP: XGBOOST TUNING + TRAINING
# ===================================================================
results = []
best_overall_f1 = 0.0
best_model_info = {}

print("\n" + "="*80)
print(f" STARTING EXPERIMENT (HEADLESS MLOPS MODE)")
print("="*80)

for idx, combo in enumerate(all_combinations):
    combo_name = combo['name']
    comps = combo['components']
    
    X_train_curr = np.hstack([all_features[c][X_train_idx] for c in comps])
    X_test_curr  = np.hstack([all_features[c][X_test_idx] for c in comps])
    
    # --- OPTUNA TUNING ---
    def objective(trial):
        params = {
            'n_estimators': trial.suggest_int('n_estimators', 50, 500),
            'max_depth': trial.suggest_int('max_depth', 3, 10),
            'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.3),
            'subsample': trial.suggest_float('subsample', 0.6, 1.0),
            'colsample_bytree': trial.suggest_float('colsample_bytree', 0.6, 1.0),
            'min_child_weight': trial.suggest_int('min_child_weight', 1, 5),
            'gamma': trial.suggest_float('gamma', 0, 5),
            'eval_metric': 'mlogloss', 'random_state': SEED, 'n_jobs': -1
        }
        use_balancing = trial.suggest_categorical('use_balancing', [True, False])
        
        cv_scores = []
        for train_idx_cv, val_idx_cv in cv_strategy.split(X_train_curr, y_train):
            X_tr_fold = X_train_curr[train_idx_cv]
            X_val_fold = X_train_curr[val_idx_cv]
            y_tr_fold = y_train[train_idx_cv]
            y_val_fold = y_train[val_idx_cv]
            
            sample_w = compute_sample_weight('balanced', y_tr_fold) if use_balancing else None
            
            clf = XGBClassifier(**params)
            clf.fit(X_tr_fold, y_tr_fold, sample_weight=sample_w)
            preds = clf.predict(X_val_fold)
            cv_scores.append(f1_score(y_val_fold, preds, average='macro'))
            
        return np.mean(cv_scores)

    study = optuna.create_study(direction='maximize')
    study.enqueue_trial({
        'n_estimators': 100, 'max_depth': 6, 'learning_rate': 0.3, 'subsample': 1.0, 
        'colsample_bytree': 1.0, 'min_child_weight': 1, 'gamma': 0, 'use_balancing': False
    })
    study.optimize(objective, n_trials=30)
    
    best_params = study.best_params
    
    # --- FINAL TRAIN ---
    use_balancing_final = best_params.pop('use_balancing')
    final_xgb = XGBClassifier(**best_params, eval_metric='mlogloss', random_state=SEED, n_jobs=-1)
    final_weights = compute_sample_weight('balanced', y_train) if use_balancing_final else None
    
    final_xgb.fit(X_train_curr, y_train, sample_weight=final_weights)
    y_test_pred = final_xgb.predict(X_test_curr)
    test_f1 = f1_score(y_test, y_test_pred, average='macro')
    
    if test_f1 > best_overall_f1:
        best_overall_f1 = test_f1
        best_model_info = {'combination': combo_name, 'f1_score': test_f1}
        
        print(f"[!] New Record! F1: {test_f1:.4f} ({combo_name}). Exporting artifacts to {ARTIFACT_DIR}...")
        joblib.dump(final_xgb, os.path.join(ARTIFACT_DIR, 'xgb_best_model.pkl'))
        joblib.dump(le, os.path.join(ARTIFACT_DIR, 'label_encoder.pkl'))
        
        features_list = combo_name.split(" + ")
        with open(os.path.join(ARTIFACT_DIR, 'feature_config.json'), 'w') as f:
            json.dump(features_list, f)

    gc.collect()

print("\n" + "-"*50)
print(f"    BEST MODEL OVERALL:")
print(f"  - Features: {best_model_info['combination']}")
print(f"  - F1 Score: {best_model_info['f1_score']:.4f}")
print("-" * 50)

# ===================================================================
# 3. UPLOAD TO AWS S3 (AUTO DEPLOY)
# ===================================================================
print("[*] Uploading Artifacts to AWS S3...")
try:
    try:
        user_secrets = UserSecretsClient()
        aws_access_key = user_secrets.get_secret("AWS_ACCESS_KEY_ID") 
        aws_secret_key = user_secrets.get_secret("AWS_SECRET_ACCESS_KEY")
        print("[+] Using credentials from Kaggle Secrets.")
        
    except ImportError:
        print("[!] Kaggle environment not found. Switching to Local (.env) mode...")
        load_dotenv() 
        aws_access_key = os.getenv("AWS_ACCESS_KEY_ID")
        aws_secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")

    if not aws_access_key or not aws_secret_key:
        raise ValueError("Missing AWS Credentials! Cannot upload to S3.")

    bucket_name = "your-weather-bucket-name"

    s3 = boto3.client('s3', aws_access_key_id=aws_access_key, aws_secret_access_key=aws_secret_key)
    
    s3.upload_file(os.path.join(ARTIFACT_DIR, 'xgb_best_model.pkl'), bucket_name, 'models/xgb_best_model.pkl')
    s3.upload_file(os.path.join(ARTIFACT_DIR, 'label_encoder.pkl'), bucket_name, 'models/label_encoder.pkl')
    s3.upload_file(os.path.join(ARTIFACT_DIR, 'feature_config.json'), bucket_name, 'models/feature_config.json')
    
    print("[+] Complete! Deep Retrain successful. API is ready to receive new configuration.")
except Exception as e:
    print(f"[-] Error uploading to S3: {e}")