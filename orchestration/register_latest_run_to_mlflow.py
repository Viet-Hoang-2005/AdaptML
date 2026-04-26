"""
Register a model artifact from an existing MLflow run into Model Registry.

Current role in the repo:
  - Phase 2 fallback/manual bridge for Kaggle -> MLflow.
  - Use this only when the training run already exists but the model has not
    been registered to the Registry yet.

Required env:
  - MLFLOW_TRACKING_URI
  - RUN_ID
  - MODEL_VERSION

Optional env:
  - MLFLOW_TRACKING_USERNAME
  - MLFLOW_TRACKING_PASSWORD
  - MLFLOW_MODEL_NAME (default: NIDS-XGBoost)
  - AWS_BUCKET_NAME (default: mlops-nids-artifacts)
  - MODEL_ARTIFACT_PATH (default: model)
"""

import os
import time

import mlflow
from mlflow.tracking import MlflowClient


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _set_optional_auth_env(name: str) -> None:
    value = os.environ.get(name, "").strip()
    if value:
        os.environ[name] = value


def _wait_until_ready(
    client: MlflowClient,
    model_name: str,
    version: str,
    timeout_seconds: int = 120,
) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        mv = client.get_model_version(model_name, version)
        status = str(mv.status)
        if status == "READY":
            return
        if status != "PENDING_REGISTRATION":
            raise RuntimeError(
                f"Registration failed for {model_name}/{version} with status {status}"
            )
        time.sleep(2)
    raise TimeoutError(
        f"Timed out waiting for model version {model_name}/{version} to become READY"
    )


def _print_artifacts_for_debug(
    client: MlflowClient,
    run_id: str,
    artifact_path: str = "",
) -> None:
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
            _print_artifacts_for_debug(client, run_id, item.path)


def main() -> None:
    tracking_uri = _require_env("MLFLOW_TRACKING_URI")
    run_id = _require_env("RUN_ID")
    business_model_version = _require_env("MODEL_VERSION")

    model_name = os.environ.get("MLFLOW_MODEL_NAME", "NIDS-XGBoost").strip() or "NIDS-XGBoost"
    bucket_name = os.environ.get("AWS_BUCKET_NAME", "mlops-nids-artifacts").strip() or "mlops-nids-artifacts"
    model_artifact_path = os.environ.get("MODEL_ARTIFACT_PATH", "model").strip() or "model"

    _set_optional_auth_env("MLFLOW_TRACKING_USERNAME")
    _set_optional_auth_env("MLFLOW_TRACKING_PASSWORD")

    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_registry_uri(tracking_uri)
    client = MlflowClient()

    try:
        run = client.get_run(run_id)
    except Exception as exc:
        raise RuntimeError(f"MLflow run '{run_id}' was not found or is inaccessible: {exc}") from exc

    print(f"Found run: {run.info.run_id}")
    print(f"Run artifact URI: {run.info.artifact_uri}")

    model_uri = f"runs:/{run_id}/{model_artifact_path}"
    candidate_s3_prefix = f"s3://{bucket_name}/models/{business_model_version}/"

    try:
        registration = mlflow.register_model(model_uri=model_uri, name=model_name)
    except Exception as exc:
        print(f"Failed to register model from '{model_uri}': {exc}")
        print("Available artifact paths for debugging:")
        _print_artifacts_for_debug(client, run_id)
        raise

    registry_version = str(registration.version)
    _wait_until_ready(client, model_name, registry_version)
    client.set_registered_model_alias(model_name, "Staging", registry_version)

    tags = {
        "model_version": business_model_version,
        "approval_status": "pending",
        "candidate_s3_prefix": candidate_s3_prefix,
        "registered_by": "register_latest_run_to_mlflow",
    }
    for key, value in tags.items():
        client.set_model_version_tag(model_name, registry_version, key, value)

    print("=" * 60)
    print("MLflow model registration completed.")
    print(f"registered_model_name: {model_name}")
    print(f"registry_version: {registry_version}")
    print(f"run_id: {run_id}")
    print(f"model_uri: {model_uri}")
    print("alias: Staging")
    print("tags:")
    for key, value in tags.items():
        print(f"  {key}={value}")
    print("=" * 60)


if __name__ == "__main__":
    main()
