import os
os.system("pip install mlflow --quiet")
os.environ["MODEL_VERSION"] = "v2"
os.environ["TARGET_CSV"] = "train_3_classes.csv"

# Import các thư viện cần thiết cho machine learning và xử lý dữ liệu
import pandas as pd
import numpy as np
import joblib
import warnings
import json
import mlflow

warnings.simplefilter(action='ignore', category=FutureWarning)

from datetime import datetime
from sklearn.model_selection import train_test_split, RandomizedSearchCV, StratifiedKFold
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import precision_score, recall_score, f1_score, accuracy_score
from sklearn.utils.class_weight import compute_sample_weight
from scipy.stats import uniform, randint
from xgboost import XGBClassifier

# --- 0. CẤU HÌNH BIẾN MÔI TRƯỜNG & MLFLOW ---
# Thiết lập phiên bản model và file CSV mục tiêu từ biến môi trường
MODEL_VERSION = os.environ.get('MODEL_VERSION', 'v1')
TARGET_CSV = os.environ.get('TARGET_CSV', 'train_2_classes.csv')
OUTPUT_DIR = '/kaggle/working/models'

# Cấu hình MLflow để theo dõi thí nghiệm
MLFLOW_URI = os.environ.get('MLFLOW_TRACKING_URI', 'file:///kaggle/working/mlruns')
mlflow.set_tracking_uri(MLFLOW_URI)
mlflow.set_experiment("MLOps_NIDS_Training")

# Khởi tạo MLflow Context ngay từ đầu để theo dõi toàn bộ tiến trình
with mlflow.start_run(run_name=f"Train_Run_{MODEL_VERSION}"):
    mlflow.log_param("model_version", MODEL_VERSION)
    mlflow.log_param("target_csv", TARGET_CSV)

    # --- 1. LOAD DATA ---
    # Tìm và load file CSV chứa dữ liệu training từ thư mục /kaggle/input
    csv_file_path = None
    print(f"Scanning /kaggle/input/ directory to find {TARGET_CSV}...")

    for dirname, _, filenames in os.walk('/kaggle/input'):
        for filename in filenames:
            if filename == TARGET_CSV:
                csv_file_path = os.path.join(dirname, filename)
                print(f"[FOUND] Data located at: {csv_file_path}")
                break
        if csv_file_path:
            break

    if not csv_file_path:
        raise FileNotFoundError(f"Could not find {TARGET_CSV} in /kaggle/input")

    # Đọc dữ liệu vào DataFrame, tách features (X) và labels (y)
    df = pd.read_csv(csv_file_path)
    X = df.drop(columns=['Label'])
    y_raw = df['Label']

    # --- 2. AUTOMATED LABEL ENCODING ---
    # Chuyển đổi labels từ string sang số nguyên để phù hợp với XGBoost
    le = LabelEncoder()
    y = le.fit_transform(y_raw)
    num_classes = len(le.classes_)

    print(f"Detected attack classes: {le.classes_}")
    print(f"Total classes (num_classes): {num_classes}")
    mlflow.log_param("num_classes", num_classes)

    # --- 3. DATASET SPLITTING (STRATIFIED) ---
    # Chia dữ liệu thành train, validation và test với tỷ lệ 60:20:20, giữ nguyên phân phối classes
    X_temp, X_test, y_temp, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)
    X_train, X_val, y_train, y_val = train_test_split(X_temp, y_temp, test_size=0.2, random_state=42, stratify=y_temp)
    print(f"Dataset shapes - Train: {X_train.shape}, Val: {X_val.shape}, Test: {X_test.shape}")

    # --- 4. CONFIGURING XGBOOST & TUNING ---
    # Thiết lập các tham số cơ bản cho XGBoost
    xgb_params = {
        'tree_method': 'hist',
        'verbosity': 0,
        'random_state': 42
    }

    train_sample_weight = None

    # Cấu hình động hoạt cho cả binary và multi-class classification
    if num_classes == 2:
        xgb_params['objective'] = 'binary:logistic'
        xgb_params['eval_metric'] = 'logloss'
        # Tính scale_pos_weight để cân bằng classes trong binary classification
        neg_count = (y_train == 0).sum()
        pos_count = (y_train == 1).sum()
        xgb_params['scale_pos_weight'] = neg_count / max(pos_count, 1)
    else:
        xgb_params['objective'] = 'multi:softprob'
        xgb_params['eval_metric'] = 'mlogloss'
        xgb_params['num_class'] = num_classes
        # Tính sample weights để cân bằng classes trong multi-class
        train_sample_weight = compute_sample_weight(class_weight='balanced', y=y_train)

    mlflow.log_param("objective", xgb_params['objective'])

    # Khởi tạo model XGBoost với tham số cơ bản
    xgb = XGBClassifier(**xgb_params)
    
    # Định nghĩa không gian tìm kiếm hyperparameters
    p_grid = {
        "max_depth": randint(3, 8),
        "n_estimators": randint(100, 200),
        "learning_rate": uniform(0.01, 0.2),
        "subsample": uniform(0.6, 0.4),
        "colsample_bytree": uniform(0.6, 0.4)
    }

    # Chọn metric đánh giá phù hợp
    scoring_method = 'f1' if num_classes == 2 else 'f1_macro'

    # Thực hiện RandomizedSearchCV để tìm hyperparameters tốt nhất
    search = RandomizedSearchCV(
        xgb,
        param_distributions=p_grid,
        n_iter=15, 
        cv=StratifiedKFold(n_splits=3, shuffle=True, random_state=42),
        scoring=scoring_method,
        verbose=1,
        random_state=42,
        n_jobs=-1
    )

    print("\nRunning hyperparameter tuning...")
    fit_params = {}
    if train_sample_weight is not None:
        fit_params['sample_weight'] = train_sample_weight

    search.fit(X_train, y_train, **fit_params)
    print(f"Best hyperparameters: {search.best_params_}")
    mlflow.log_params(search.best_params_)

    # --- 5. FINAL MODEL TRAINING ---
    # Kết hợp tham số tốt nhất từ tuning với tham số cơ bản, thêm early stopping
    best_xgb_params = xgb_params.copy()
    best_xgb_params.update(search.best_params_)
    best_xgb_params['early_stopping_rounds'] = 10

    # Khởi tạo model với tham số tối ưu
    best_xgb = XGBClassifier(**best_xgb_params)

    print("\nTraining final model with Early Stopping...")
    # Train model với early stopping trên validation set
    best_xgb.fit(
        X_train, y_train, 
        eval_set=[(X_val, y_val)], 
        sample_weight=train_sample_weight, 
        verbose=False
    )

    # --- 6. EVALUATION ---
    # Dự đoán trên test set và tính các metrics
    y_pred = best_xgb.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    average_method = 'binary' if num_classes == 2 else 'macro'
    prec = precision_score(y_test, y_pred, average=average_method)
    rec = recall_score(y_test, y_pred, average=average_method)
    f1 = f1_score(y_test, y_pred, average=average_method)

    print("\n=== EVALUATION RESULTS ===")
    print(f"Accuracy: {acc:.4f} | Precision: {prec:.4f} | Recall: {rec:.4f} | F1: {f1:.4f}")

    # Log metrics vào MLflow
    mlflow.log_metric("accuracy", acc)
    mlflow.log_metric("precision", prec)
    mlflow.log_metric("recall", rec)
    mlflow.log_metric("f1_score", f1)

    # --- 7. EXPORT ARTIFACTS CHO GITHUB ACTIONS ---
    # Tạo thư mục output nếu chưa tồn tại
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Lưu danh sách classes (labels) dưới dạng JSON
    label_classes = le.classes_.tolist()
    classes_path = os.path.join(OUTPUT_DIR, f'label_classes_{MODEL_VERSION}.json')
    with open(classes_path, 'w') as f:
        json.dump(label_classes, f)

    # Lưu model đã train dưới dạng pickle
    model_path = os.path.join(OUTPUT_DIR, f'xgb_nids_model_{MODEL_VERSION}.pkl')
    joblib.dump(best_xgb, model_path)

    # Tạo scorecard với thông tin chi tiết về model, hyperparameters và metrics
    metrics_scorecard = {
        "model_version": MODEL_VERSION,
        "timestamp": datetime.now().isoformat(),
        "num_classes": int(num_classes),
        "objective": xgb_params['objective'],
        "evaluation_metrics": {
            "accuracy": round(float(acc), 4),
            "precision": round(float(prec), 4),
            "recall": round(float(rec), 4),
            "f1_score": round(float(f1), 4)
        },
        "best_hyperparameters": search.best_params_
    }

    # Lưu scorecard dưới dạng JSON
    metrics_path = os.path.join(OUTPUT_DIR, f'metrics_{MODEL_VERSION}.json')
    with open(metrics_path, 'w') as f:
        json.dump(metrics_scorecard, f, indent=4)

    # Đẩy toàn bộ thư mục output lên MLflow làm bản sao lưu nội bộ
    mlflow.log_artifacts(OUTPUT_DIR, artifact_path="deployment_exports")
    
    print(f"\n[SUCCESS] Artifacts & Scorecard exported to {OUTPUT_DIR} for CI/CD.")