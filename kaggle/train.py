import importlib
import json
import os
import subprocess
import sys
import warnings
from datetime import datetime
from time import sleep


def ensure_dependency(package_name: str) -> None:
    try:
        importlib.import_module(package_name)
    except ImportError:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--quiet", package_name]
        )


for dependency in ("mlflow", "boto3"):
    ensure_dependency(dependency)


import boto3
import joblib
import mlflow
import mlflow.xgboost
import pandas as pd
from kaggle_secrets import UserSecretsClient
from mlflow.tracking import MlflowClient
from scipy.stats import randint, uniform
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold, train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.utils.class_weight import compute_sample_weight
from xgboost import XGBClassifier


warnings.simplefilter(action="ignore", category=FutureWarning)


def load_secret(secret_name: str, *, required: bool = False) -> str | None:
    try:
        return USER_SECRETS.get_secret(secret_name)
    except Exception as exc:
        if required:
            raise RuntimeError(f"Missing required Kaggle secret: {secret_name}") from exc
        print(f"Optional secret {secret_name} not found: {exc}")
        return None


USER_SECRETS = UserSecretsClient()

os.environ["AWS_ACCESS_KEY_ID"] = load_secret("AWS_ACCESS_KEY_ID", required=True)
os.environ["AWS_SECRET_ACCESS_KEY"] = load_secret(
    "AWS_SECRET_ACCESS_KEY", required=True
)
os.environ["AWS_DEFAULT_REGION"] = load_secret("AWS_DEFAULT_REGION", required=True)

mlflow_username = load_secret("MLFLOW_TRACKING_USERNAME") or load_secret(
    "MLFLOW_USERNAME"
)
mlflow_password = load_secret("MLFLOW_TRACKING_PASSWORD") or load_secret(
    "MLFLOW_PASSWORD"
)
if mlflow_username:
    os.environ["MLFLOW_TRACKING_USERNAME"] = mlflow_username
if mlflow_password:
    os.environ["MLFLOW_TRACKING_PASSWORD"] = mlflow_password

MODEL_VERSION = os.environ.get("MODEL_VERSION", "v1")
TARGET_CSV = os.environ.get("TARGET_CSV", "train_2_classes.csv")
AWS_BUCKET_NAME = os.environ.get("AWS_BUCKET_NAME", "mlops-nids-artifacts")
S3_TRAINING_DATA_PREFIX = os.environ.get("S3_TRAINING_DATA_PREFIX", "training-data/")
MLFLOW_TRACKING_URI = os.environ.get(
    "MLFLOW_TRACKING_URI", "file:///kaggle/working/mlruns"
)
MLFLOW_MODEL_NAME = os.environ.get("MLFLOW_MODEL_NAME", "NIDS-XGBoost")
OUTPUT_DIR = "/kaggle/working/models"

mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
mlflow.set_registry_uri(MLFLOW_TRACKING_URI)
mlflow.set_experiment("MLOps_NIDS_Training")


def download_training_data(target_csv: str) -> str:
    s3_download_path = os.path.join("/kaggle/working", target_csv)

    print("Attempting to download training data from S3...")
    try:
        s3_client = boto3.client("s3")
        s3_client.download_file(
            AWS_BUCKET_NAME,
            f"{S3_TRAINING_DATA_PREFIX}{target_csv}",
            s3_download_path,
        )
        print(f"Downloaded dataset from S3: {s3_download_path}")
        return s3_download_path
    except Exception as exc:
        print(f"Failed to download from S3: {exc}")

    print(f"Searching for {target_csv} inside /kaggle/input/...")
    for dirname, _, filenames in os.walk("/kaggle/input"):
        for filename in filenames:
            if filename == target_csv:
                local_csv_path = os.path.join(dirname, filename)
                print(f"Found local dataset: {local_csv_path}")
                return local_csv_path

    raise FileNotFoundError(
        f"Could not find {target_csv} in S3 or under /kaggle/input/."
    )


def upload_artifacts_to_s3(local_paths: list[str]) -> None:
    s3_client = boto3.client("s3")
    s3_prefix = f"models/{MODEL_VERSION}/"

    try:
        for local_path in local_paths:
            s3_key = f"{s3_prefix}{os.path.basename(local_path)}"
            s3_client.upload_file(local_path, AWS_BUCKET_NAME, s3_key)
            print(f"Uploaded {local_path} to s3://{AWS_BUCKET_NAME}/{s3_key}")
    except Exception as exc:
        print(f"S3 artifact upload failed: {exc}")
        raise


def register_model_to_mlflow(run_id: str) -> None:
    model_uri = f"runs:/{run_id}/model"
    client = MlflowClient()

    try:
        registration = mlflow.register_model(
            model_uri=model_uri,
            name=MLFLOW_MODEL_NAME,
        )
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

        client.transition_model_version_stage(
            name=MLFLOW_MODEL_NAME,
            version=registration.version,
            stage="Staging",
            archive_existing_versions=False,
        )
        client.set_model_version_tag(
            name=MLFLOW_MODEL_NAME,
            version=registration.version,
            key="model_version",
            value=MODEL_VERSION,
        )
        client.set_model_version_tag(
            name=MLFLOW_MODEL_NAME,
            version=registration.version,
            key="approval_status",
            value="pending",
        )
        print(
            "Registered model to MLflow Registry: "
            f"{MLFLOW_MODEL_NAME} v{registration.version} -> Staging"
        )
    except Exception as exc:
        print(f"MLflow registration failed: {exc}")
        raise


def main() -> None:
    local_csv_path = download_training_data(TARGET_CSV)
    df = pd.read_csv(local_csv_path)
    X = df.drop(columns=["Label"])
    y_raw = df["Label"]

    label_encoder = LabelEncoder()
    y = label_encoder.fit_transform(y_raw)
    num_classes = len(label_encoder.classes_)

    X_temp, X_test, y_temp, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_temp, y_temp, test_size=0.2, random_state=42, stratify=y_temp
    )

    xgb_params = {
        "tree_method": "hist",
        "verbosity": 0,
        "random_state": 42,
    }

    train_sample_weight = None
    if num_classes == 2:
        xgb_params["objective"] = "binary:logistic"
        xgb_params["eval_metric"] = "logloss"
        neg_count = int((y_train == 0).sum())
        pos_count = int((y_train == 1).sum())
        xgb_params["scale_pos_weight"] = neg_count / max(pos_count, 1)
    else:
        xgb_params["objective"] = "multi:softprob"
        xgb_params["eval_metric"] = "mlogloss"
        xgb_params["num_class"] = num_classes
        train_sample_weight = compute_sample_weight(
            class_weight="balanced",
            y=y_train,
        )

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

    fit_params = {}
    if train_sample_weight is not None:
        fit_params["sample_weight"] = train_sample_weight

    with mlflow.start_run(run_name=f"Train_Run_{MODEL_VERSION}") as run:
        mlflow.log_param("model_version", MODEL_VERSION)
        mlflow.log_param("target_csv", TARGET_CSV)
        mlflow.log_param("num_classes", num_classes)
        mlflow.log_param("mlflow_model_name", MLFLOW_MODEL_NAME)
        mlflow.log_param("aws_bucket_name", AWS_BUCKET_NAME)
        mlflow.log_param("objective", xgb_params["objective"])

        print("Running hyperparameter search...")
        search.fit(X_train, y_train, **fit_params)
        mlflow.log_params(search.best_params_)

        best_xgb_params = xgb_params.copy()
        best_xgb_params.update(search.best_params_)
        best_xgb_params["early_stopping_rounds"] = 10

        best_xgb = XGBClassifier(**best_xgb_params)
        best_xgb.fit(
            X_train,
            y_train,
            eval_set=[(X_val, y_val)],
            sample_weight=train_sample_weight,
            verbose=False,
        )

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

        os.makedirs(OUTPUT_DIR, exist_ok=True)
        classes_path = os.path.join(OUTPUT_DIR, f"label_classes_{MODEL_VERSION}.json")
        model_path = os.path.join(OUTPUT_DIR, f"xgb_nids_model_{MODEL_VERSION}.pkl")
        metrics_path = os.path.join(OUTPUT_DIR, f"metrics_{MODEL_VERSION}.json")

        with open(classes_path, "w", encoding="utf-8") as file_handle:
            json.dump(label_encoder.classes_.tolist(), file_handle)

        joblib.dump(best_xgb, model_path)

        with open(metrics_path, "w", encoding="utf-8") as file_handle:
            json.dump(metrics_scorecard, file_handle, indent=4)

        mlflow.log_artifacts(OUTPUT_DIR, artifact_path="deployment_exports")
        mlflow.xgboost.log_model(best_xgb, artifact_path="model")

        artifact_paths = [model_path, classes_path, metrics_path]
        upload_artifacts_to_s3(artifact_paths)
        register_model_to_mlflow(run.info.run_id)

        print(f"Training completed successfully for {MODEL_VERSION}.")


if __name__ == "__main__":
    main()
