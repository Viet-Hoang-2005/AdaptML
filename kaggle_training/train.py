import pandas as pd
import numpy as np
import joblib
import os
import warnings

warnings.simplefilter(action='ignore', category=FutureWarning)

from sklearn.model_selection import train_test_split, RandomizedSearchCV, KFold
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import precision_score, recall_score, f1_score, accuracy_score
from scipy.stats import uniform, randint
from xgboost import XGBClassifier

# --- 1. LOAD DATA ---
OUTPUT_DIR = '/kaggle/working/models'
csv_file_path = None

print("Scanning /kaggle/input/ directory to find the CSV file...")

for dirname, _, filenames in os.walk('/kaggle/input'):
    for filename in filenames:
        if filename == 'train_3_classes.csv':
            csv_file_path = os.path.join(dirname, filename)
            print(f"[FOUND] Data located at: {csv_file_path}")
            break
    if csv_file_path:
        break

df = pd.read_csv(csv_file_path)

X = df.drop(columns=['Label'])
y_raw = df['Label']

# --- 2. AUTOMATED LABEL ENCODING FOR MULTICLASS ---
le = LabelEncoder()
y = le.fit_transform(y_raw)
num_classes = len(le.classes_)

print(f"Detected attack classes: {le.classes_}")
print(f"Total number of classes (num_classes): {num_classes}")

# --- 3. DATASET SPLITTING ---
X_temp, X_test, y_temp, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
X_train, X_val, y_train, y_val = train_test_split(X_temp, y_temp, test_size=0.2, random_state=42)

print(f"Dataset shapes - Train: {X_train.shape}, Val: {X_val.shape}, Test: {X_test.shape}")

# --- 4. CONFIGURING XGBOOST DIFFERENTIALLY ---
xgb_params = {
    'tree_method': 'hist',
    'verbosity': 0,
    'random_state': 42
}

# Cấu hình linh hoạt dựa trên số lượng lớp
if num_classes == 2:
    xgb_params['objective'] = 'binary:logistic'
    xgb_params['eval_metric'] = 'logloss'
else:
    xgb_params['objective'] = 'multi:softprob'
    xgb_params['eval_metric'] = 'mlogloss'
    xgb_params['num_class'] = num_classes

xgb = XGBClassifier(**xgb_params)

p_grid = {
    "max_depth": randint(3, 8),
    "n_estimators": randint(100, 200),
    "learning_rate": uniform(0.01, 0.2),
    "subsample": uniform(0.6, 0.4),
    "colsample_bytree": uniform(0.6, 0.4)
}

search = RandomizedSearchCV(
    xgb,
    param_distributions=p_grid,
    n_iter=15, 
    cv=KFold(n_splits=3, shuffle=True, random_state=42),
    verbose=1,
    random_state=42,
    n_jobs=-1
)

print("\nRunning hyperparameter tuning...")
search.fit(X_train, y_train)
print(f"Best hyperparameters found: {search.best_params_}")

# --- 5. FINAL MODEL TRAINING ---
best_xgb_params = xgb_params.copy()
best_xgb_params.update(search.best_params_)
best_xgb_params['early_stopping_rounds'] = 10

best_xgb = XGBClassifier(**best_xgb_params)

print("\nTraining the final model with Early Stopping...")
best_xgb.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)

# --- 6. MODEL EVALUATION ---
y_pred = best_xgb.predict(X_test)
print("\n=== EVALUATION RESULTS ON TEST SET ===")
print(f"Accuracy: {accuracy_score(y_test, y_pred):.4f}")

average_method = 'binary' if num_classes == 2 else 'macro'
print(f"Precision ({average_method.capitalize()}): {precision_score(y_test, y_pred, average=average_method):.4f}")
print(f"Recall ({average_method.capitalize()}): {recall_score(y_test, y_pred, average=average_method):.4f}")
print(f"F1-Score ({average_method.capitalize()}): {f1_score(y_test, y_pred, average=average_method):.4f}")

# --- 7. SAVE ARTIFACTS ---
os.makedirs(OUTPUT_DIR, exist_ok=True)

encoder_path = os.path.join(OUTPUT_DIR, 'label_nids_encoder_v2.pkl')
model_path = os.path.join(OUTPUT_DIR, 'xgb_nids_model_v2.pkl')

joblib.dump(le, encoder_path)
joblib.dump(best_xgb, model_path)

print(f"\n[SUCCESS] Model weights saved at {model_path} and label encoder at {encoder_path}")