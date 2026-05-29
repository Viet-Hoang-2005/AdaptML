# train.py: Huấn luyện mô hình ML phân loại tấn công mạng bằng XGBoost và giám sát bằng MLflow
import json
import os
import warnings
from datetime import datetime
from time import sleep

import joblib
import mlflow
import mlflow.xgboost
import pandas as pd
from xgboost import XGBClassifier
from mlflow.tracking import MlflowClient 
from scipy.stats import randint, uniform
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold, train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.utils.class_weight import compute_sample_weight

# Tắt cảnh báo FutureWarning
warnings.simplefilter(action="ignore", category=FutureWarning)

# Lấy cấu hình biến môi trường
def get_required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value

# Đảm bảo đã có MLflow Credentials
get_required_env("MLFLOW_TRACKING_USERNAME")
get_required_env("MLFLOW_TRACKING_PASSWORD")

# Cấu hình tham số từ biến môi trường
MODEL_VERSION = get_required_env("MODEL_VERSION")
TARGET_CSV = get_required_env("TARGET_CSV")
AWS_BUCKET_NAME = os.environ.get("AWS_BUCKET_NAME", "mlops-paas-artifacts")
S3_TRAINING_DATA_PREFIX = os.environ.get("S3_TRAINING_DATA_PREFIX", "training-data/")
MLFLOW_TRACKING_URI = get_required_env("MLFLOW_TRACKING_URI")
MLFLOW_EXPERIMENT_NAME = os.environ.get("MLFLOW_EXPERIMENT_NAME", "MLOps_NIDS_Training")
MLFLOW_MODEL_NAME = os.environ.get("MLFLOW_MODEL_NAME", "NIDS-XGBoost")
STAGING_ALIAS = os.environ.get("MLFLOW_STAGING_ALIAS", "Staging")
OUTPUT_DIR = os.environ.get("SM_MODEL_DIR", "/opt/ml/model") # SageMaker Model Directory

# Cấu hình MLflow tracking và registry URI
mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
mlflow.set_registry_uri(MLFLOW_TRACKING_URI)
mlflow.set_experiment(MLFLOW_EXPERIMENT_NAME)

print("=" * 60)
print("SageMaker training configuration")
print(f"MODEL_VERSION           : {MODEL_VERSION}")
print(f"TARGET_CSV              : {TARGET_CSV}")
print(f"AWS_BUCKET_NAME         : {AWS_BUCKET_NAME}")
print(f"S3_TRAINING_DATA_PREFIX : {S3_TRAINING_DATA_PREFIX}")
print(f"MLFLOW_TRACKING_URI     : {MLFLOW_TRACKING_URI}")
print(f"MLFLOW_EXPERIMENT_NAME  : {MLFLOW_EXPERIMENT_NAME}")
print(f"MLFLOW_MODEL_NAME       : {MLFLOW_MODEL_NAME}")
print(f"STAGING_ALIAS           : {STAGING_ALIAS}")
print("=" * 60)

# Hàm tải dữ liệu huấn luyện từ S3 hoặc local path
def download_training_data(target_csv: str) -> str:
    # Trong môi trường SageMaker, dữ liệu được mount trực tiếp vào /opt/ml/input/data/train/
    sagemaker_input_dir = os.environ.get("SM_CHANNEL_TRAIN", "/opt/ml/input/data/train")
    local_csv_path = os.path.join(sagemaker_input_dir, target_csv)
    
    if os.path.exists(local_csv_path):
        print(f"Found dataset at SageMaker input channel: {local_csv_path}")
        return local_csv_path
        
    raise FileNotFoundError(
        f"Could not find {target_csv} at {sagemaker_input_dir}. Ensure S3 Data Channel is configured correctly."
    )

# Hàm đệ quy liệt kê artifacts trong MLflow run để hỗ trợ debug khi đăng ký model thất bại
def list_run_artifacts_for_debug(client: MlflowClient, run_id: str, artifact_path: str = "") -> None:
    try:
        artifacts = client.list_artifacts(run_id, artifact_path)
    except Exception as exc:
        print(f"Failed to list artifacts under '{artifact_path or '/'}': {exc}")
        return

    if not artifacts:
        print(f"No artifacts found under '{artifact_path or '/'}' for run {run_id}.")
        return

    for item in artifacts:
        print(f"- {item.path}")
        if item.is_dir:
            list_run_artifacts_for_debug(client, run_id, item.path)

# Hàm đăng ký model vào MLflow Model Registry với xử lý trạng thái và gán alias
def register_model_to_mlflow(run_id: str, artifact_uri: str) -> tuple[str, str]:
    model_uri = f"runs:/{run_id}/model" # Đường dẫn để trỏ đến model đã log trong MLflow run artifacts
    client = MlflowClient()
    candidate_s3_prefix = f"s3://{AWS_BUCKET_NAME}/models/{MODEL_VERSION}/"

    try:
        # Đăng ký model vào MLflow Model Registry
        registration = mlflow.register_model(
            model_uri=model_uri,
            name=MLFLOW_MODEL_NAME,
        )

        # Chờ model version đạt trạng thái READY trước khi gán alias hoặc chuyển stage
        model_ready = False
        for _ in range(30):
            version_info = client.get_model_version(
                name=MLFLOW_MODEL_NAME,
                version=registration.version,
            )
            if version_info.status == "READY":
                model_ready = True
                break
            sleep(2)

        if not model_ready:
            raise RuntimeError(
                "Registered MLflow model version did not reach READY state in time."
            )

        # Cố gắng gán alias cho model version mới, nếu không thành công thì chuyển stage để đảm bảo backward compatibility
        try:
            client.set_registered_model_alias(
                name=MLFLOW_MODEL_NAME,
                alias=STAGING_ALIAS,
                version=registration.version,
            )
        except Exception as exc:
            print(f"Failed to set alias '{STAGING_ALIAS}': {exc}")
            print("Falling back to stage transition for backward compatibility...")
            client.transition_model_version_stage(
                name=MLFLOW_MODEL_NAME,
                version=registration.version,
                stage=STAGING_ALIAS,
                archive_existing_versions=False,
            )

        # Gán tags cho model version để hỗ trợ quản lý và truy xuất metadata sau này
        model_version_tags = {
            "model_version": MODEL_VERSION,
            "approval_status": "pending",
            "candidate_s3_prefix": candidate_s3_prefix,
            "registered_by": "sagemaker_train_py",
            "training_source": "sagemaker",
            "mlflow_experiment_name": MLFLOW_EXPERIMENT_NAME,
            "staging_alias": STAGING_ALIAS,
        }
        for key, value in model_version_tags.items():
            client.set_model_version_tag(
                name=MLFLOW_MODEL_NAME,
                version=registration.version,
                key=key,
                value=value,
            )

        print("=" * 60)
        print("MLflow registration completed successfully.")
        print(f"run_id: {run_id}")
        print(f"artifact_uri: {artifact_uri}")
        print(f"registered_model_name: {MLFLOW_MODEL_NAME}")
        print(f"registered_model_version: {registration.version}")
        print(f"alias: {STAGING_ALIAS}")
        print(f"candidate_s3_prefix: {candidate_s3_prefix}")
        print("=" * 60)
        return str(registration.version), candidate_s3_prefix
    except Exception as exc:
        print(f"MLflow registration failed: {exc}")
        print(f"model_uri: {model_uri}")
        print("Available artifact paths for debugging:")
        list_run_artifacts_for_debug(client, run_id)
        raise

# Hàm main thực hiện toàn bộ pipeline huấn luyện, đánh giá, logging và đăng ký model
def main() -> None:
    # Bước 1: Tải dữ liệu huấn luyện
    local_csv_path = download_training_data(TARGET_CSV)
    df = pd.read_csv(local_csv_path)

    # Bước 2: Huấn luyện model với RandomizedSearchCV để tìm hyperparameters tốt nhất, đánh giá trên tập test, và log toàn bộ thông tin vào MLflow
    X = df.drop(columns=["Label"])
    y_raw = df["Label"]

    # Mã hóa nhãn và tính số lượng lớp để cấu hình thuật toán phù hợp
    label_encoder = LabelEncoder()
    y = label_encoder.fit_transform(y_raw)
    num_classes = len(label_encoder.classes_)
    
    # Chia dữ liệu thành train, validation và test set
    X_temp, X_test, y_temp, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_temp, y_temp, test_size=0.2, random_state=42, stratify=y_temp
    )

    # Cấu hình tham số cơ bản cho XGBoost và thiết lập sample weights nếu cần để xử lý class imbalance
    xgb_params = {
        "tree_method": "hist",
        "verbosity": 0,
        "random_state": 42,
    }

    train_sample_weight = None
    # Đối với bài toán nhị phân, sử dụng scale_pos_weight để xử lý imbalance
    if num_classes == 2:
        xgb_params["objective"] = "binary:logistic"
        xgb_params["eval_metric"] = "logloss"
        neg_count = int((y_train == 0).sum())
        pos_count = int((y_train == 1).sum())
        xgb_params["scale_pos_weight"] = neg_count / max(pos_count, 1)
    # Đối với bài toán đa lớp, sử dụng balanced sample weights để xử lý imbalance
    else:
        xgb_params["objective"] = "multi:softprob"
        xgb_params["eval_metric"] = "mlogloss"
        xgb_params["num_class"] = num_classes
        train_sample_weight = compute_sample_weight(
            class_weight="balanced",
            y=y_train,
        )

    # Thiết lập RandomizedSearchCV để tìm kiếm hyperparameters tốt nhất cho XGBoost
    search = RandomizedSearchCV(
        XGBClassifier(**xgb_params),
        param_distributions={
            "max_depth": randint(3, 8),
            "n_estimators": randint(100, 200),
            "learning_rate": uniform(0.01, 0.2),
            "subsample": uniform(0.6, 0.4),
            "colsample_bytree": uniform(0.6, 0.4),
        },
        n_iter=15,
        cv=StratifiedKFold(n_splits=3, shuffle=True, random_state=42),
        scoring="f1" if num_classes == 2 else "f1_macro",
        verbose=1,
        random_state=42,
        n_jobs=-1,
    )

    # Chuẩn bị fit_params bao gồm sample_weight nếu đã được tính toán
    fit_params = {}
    if train_sample_weight is not None:
        fit_params["sample_weight"] = train_sample_weight

    # Bước 3: Bắt đầu MLflow run để log toàn bộ quá trình huấn luyện, đánh giá và đăng ký model
    with mlflow.start_run(run_name=f"Train_Run_{MODEL_VERSION}") as run:
        run_id = run.info.run_id
        mlflow.log_param("model_version", MODEL_VERSION)
        mlflow.log_param("target_csv", TARGET_CSV)
        mlflow.log_param("num_classes", num_classes)
        mlflow.log_param("mlflow_model_name", MLFLOW_MODEL_NAME)
        mlflow.log_param("aws_bucket_name", AWS_BUCKET_NAME)
        mlflow.log_param("objective", xgb_params["objective"])
        mlflow.set_tags(
            {
                "pipeline": "sagemaker_retrain",
                "approval_status": "pending",
                "model_version": MODEL_VERSION,
                "candidate_s3_prefix": f"s3://{AWS_BUCKET_NAME}/models/{MODEL_VERSION}/",
                "training_source": "sagemaker",
            }
        )

        print("Running hyperparameter search...")
        # Đảm bảo RandomizedSearchCV sử dụng trọng số mẫu trong quá trình huấn luyện
        search.fit(X_train, y_train, **fit_params)
        
        # Log hyperparameters tốt nhất vào MLflow
        mlflow.log_params(search.best_params_)

        # Huấn luyện lại model XGBoost với hyperparameters tốt nhất và đánh giá trên tập test
        best_xgb_params = xgb_params.copy()
        best_xgb_params.update(search.best_params_)
        best_xgb_params["early_stopping_rounds"] = 10

        # Huấn luyện model với tập validation để theo dõi quá trình huấn luyện và tránh overfitting
        best_xgb = XGBClassifier(**best_xgb_params)
        best_xgb.fit(
            X_train,
            y_train,
            eval_set=[(X_val, y_val)],
            sample_weight=train_sample_weight,
            verbose=False,
        )

        # Đánh giá model trên tập test và log các metrics vào MLflow
        y_pred = best_xgb.predict(X_test)
        average_method = "binary" if num_classes == 2 else "macro"
        metrics_scorecard = {
            "model_version": MODEL_VERSION,
            "timestamp": datetime.now().isoformat(),
            "num_classes": int(num_classes),
            "objective": xgb_params["objective"],
            "evaluation_metrics": {
                "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
                "precision": round(
                    float(
                        precision_score(y_test, y_pred, average=average_method)
                    ),
                    4,
                ),
                "recall": round(
                    float(recall_score(y_test, y_pred, average=average_method)),
                    4,
                ),
                "f1_score": round(
                    float(f1_score(y_test, y_pred, average=average_method)),
                    4,
                ),
            },
            "best_hyperparameters": search.best_params_,
        }
        mlflow.log_metrics(metrics_scorecard["evaluation_metrics"])

        # Lưu model, label encoder classes và metrics scorecard vào thư mục output
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        classes_path = os.path.join(OUTPUT_DIR, f"label_classes_{MODEL_VERSION}.json")
        model_path = os.path.join(OUTPUT_DIR, f"xgb_nids_model_{MODEL_VERSION}.pkl")
        metrics_path = os.path.join(OUTPUT_DIR, f"metrics_{MODEL_VERSION}.json")

        with open(classes_path, "w", encoding="utf-8") as file_handle:
            json.dump(label_encoder.classes_.tolist(), file_handle)

        joblib.dump(best_xgb, model_path)

        with open(metrics_path, "w", encoding="utf-8") as file_handle:
            json.dump(metrics_scorecard, file_handle, indent=4)

        # Log artifacts vào MLflow và đăng ký model vào Model Registry
        mlflow.log_artifacts(OUTPUT_DIR, artifact_path="deployment_exports")
        mlflow.xgboost.log_model(best_xgb, artifact_path="model")
        artifact_uri = mlflow.get_artifact_uri()
        artifact_paths = [model_path, classes_path, metrics_path]
        register_model_to_mlflow(run_id, artifact_uri)

        print(f"Training completed successfully for {MODEL_VERSION}.")

if __name__ == "__main__":
    main()
