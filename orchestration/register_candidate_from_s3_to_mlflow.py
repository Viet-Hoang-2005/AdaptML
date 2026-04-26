"""
LEGACY BRIDGE SCRIPT.

Script nay phu hop voi flow cu khi candidate artifacts duoc upload len
`s3://.../models/{MODEL_VERSION}/` roi mot job rieng moi import candidate vao
MLflow `Staging`.

Flow hien tai uu tien:
  Kaggle train.py tu log model/artifacts vao MLflow run va tu register Registry.
"""

import json
import os
import tempfile
import time
import warnings

import boto3
import joblib
import mlflow
import pandas as pd
from mlflow.models import infer_signature
from mlflow.pyfunc import PythonModel
from mlflow.tracking import MlflowClient

warnings.simplefilter(action="ignore", category=FutureWarning)
warnings.warn(
    "Legacy S3 -> MLflow bridge. Keep only for backfill/manual recovery flows.",
    DeprecationWarning,
    stacklevel=2,
)


class XGBoostNIDSWrapper(PythonModel):
    """Wrap joblib-loaded XGBoost model for MLflow registry usage."""

    def __init__(self, model, label_classes):
        self.model = model
        self.label_classes = label_classes

    def predict(self, context, model_input):
        if isinstance(model_input, pd.DataFrame):
            return self.model.predict(model_input.values)
        return self.model.predict(model_input)


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def _download_candidate_artifacts(bucket: str, model_version: str, temp_dir: str):
    s3 = boto3.client("s3")
    prefix = f"models/{model_version}"

    model_path = os.path.join(temp_dir, f"xgb_nids_model_{model_version}.pkl")
    labels_path = os.path.join(temp_dir, f"label_classes_{model_version}.json")
    metrics_path = os.path.join(temp_dir, f"metrics_{model_version}.json")

    s3.download_file(bucket, f"{prefix}/xgb_nids_model_{model_version}.pkl", model_path)
    s3.download_file(bucket, f"{prefix}/label_classes_{model_version}.json", labels_path)
    s3.download_file(bucket, f"{prefix}/metrics_{model_version}.json", metrics_path)

    return model_path, labels_path, metrics_path


def _build_signature(model):
    feature_names = []
    try:
        feature_names = list(model.get_booster().feature_names or [])
    except Exception:
        feature_names = []

    if not feature_names:
        n_features = int(getattr(model, "n_features_in_", 52))
        feature_names = [f"F{i}" for i in range(n_features)]

    input_example = pd.DataFrame([[0.0] * len(feature_names)], columns=feature_names)
    predictions = pd.Series([0], name="predicted_label")
    return input_example, infer_signature(input_example, predictions)


def _wait_until_ready(client: MlflowClient, model_name: str, version: str, timeout: int = 120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        mv = client.get_model_version(model_name, version)
        status = str(mv.status)
        if status == "READY":
            return mv
        if status != "PENDING_REGISTRATION":
            raise RuntimeError(f"Model version {model_name}/{version} registration failed with status {status}")
        time.sleep(2)
    raise TimeoutError(f"Timed out waiting for MLflow model version {model_name}/{version} to become READY")


def main():
    model_version = _require_env("MODEL_VERSION")
    bucket_name = _require_env("AWS_BUCKET_NAME")
    tracking_uri = _require_env("MLFLOW_TRACKING_URI")
    registry_uri = os.environ.get("MLFLOW_REGISTRY_URI", tracking_uri).strip() or tracking_uri
    model_name = os.environ.get("MLFLOW_MODEL_NAME", "NIDS-XGBoost")
    experiment_name = os.environ.get("MLFLOW_EXPERIMENT_NAME", "MLOps_NIDS_Candidates")

    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_registry_uri(registry_uri)
    mlflow.set_experiment(experiment_name)
    client = MlflowClient()

    with tempfile.TemporaryDirectory(prefix=f"candidate-{model_version}-") as temp_dir:
        print(f"Downloading candidate artifacts for {model_version} from s3://{bucket_name}/models/{model_version}/")
        model_path, labels_path, metrics_path = _download_candidate_artifacts(bucket_name, model_version, temp_dir)

        model = joblib.load(model_path)
        with open(labels_path, "r", encoding="utf-8") as f:
            label_classes = json.load(f)
        with open(metrics_path, "r", encoding="utf-8") as f:
            metrics_data = json.load(f)

        input_example, signature = _build_signature(model)
        evaluation_metrics = metrics_data.get("evaluation_metrics", {})
        hyperparameters = metrics_data.get("best_hyperparameters", {})

        run_name = f"candidate_{model_version}"
        source_prefix = f"s3://{bucket_name}/models/{model_version}/"
        wrapped = XGBoostNIDSWrapper(model=model, label_classes=label_classes)

        with mlflow.start_run(run_name=run_name) as run:
            run_id = run.info.run_id
            print(f"Started MLflow run: {run_id}")

            params = {
                "model_version": model_version,
                "num_classes": metrics_data.get("num_classes", len(label_classes)),
                "objective": metrics_data.get("objective", "unknown"),
            }
            params.update({k: str(v) for k, v in hyperparameters.items()})
            mlflow.log_params(params)

            metrics_to_log = {k: float(v) for k, v in evaluation_metrics.items()}
            if metrics_to_log:
                mlflow.log_metrics(metrics_to_log)

            mlflow.set_tags(
                {
                    "candidate_source": "s3",
                    "candidate_s3_prefix": source_prefix,
                    "approval_status": "pending",
                    "registry_target_stage": "Staging",
                }
            )

            mlflow.log_artifact(model_path, artifact_path="candidate_export")
            mlflow.log_artifact(labels_path, artifact_path="candidate_export")
            mlflow.log_artifact(metrics_path, artifact_path="candidate_export")
            mlflow.pyfunc.log_model(
                artifact_path="candidate_model",
                python_model=wrapped,
                signature=signature,
                input_example=input_example,
            )

            model_uri = f"runs:/{run_id}/candidate_model"
            registered = mlflow.register_model(model_uri=model_uri, name=model_name)
            registry_version = str(registered.version)
            print(f"Registered candidate to MLflow: {model_name}/{registry_version}")

        _wait_until_ready(client, model_name, registry_version)
        client.transition_model_version_stage(name=model_name, version=registry_version, stage="Staging")
        client.set_model_version_tag(name=model_name, version=registry_version, key="model_version", value=model_version)
        client.set_model_version_tag(name=model_name, version=registry_version, key="approval_status", value="pending")
        client.set_model_version_tag(name=model_name, version=registry_version, key="candidate_s3_prefix", value=source_prefix)

        print("=" * 60)
        print("Candidate registration completed.")
        print(f"  Business version : {model_version}")
        print(f"  Registry version : {registry_version}")
        print(f"  Registry name    : {model_name}")
        print("  Stage            : Staging")
        print("=" * 60)


if __name__ == "__main__":
    main()
