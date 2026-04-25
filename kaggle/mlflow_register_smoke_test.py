import os
import sys


def _ensure_dependency(module_name: str, package_name: str | None = None) -> None:
    package_name = package_name or module_name
    try:
        __import__(module_name)
    except ImportError:
        import subprocess

        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--quiet", package_name]
        )


for module_name, package_name in (
    ("mlflow", "mlflow"),
    ("sklearn", "scikit-learn"),
):
    _ensure_dependency(module_name, package_name)


import mlflow
import mlflow.sklearn
from mlflow.tracking import MlflowClient
from sklearn.datasets import load_iris
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import train_test_split


DEFAULT_TRACKING_URI = "https://mlflow.mlops-nids-nt114.id.vn"
EXPERIMENT_NAME = "kaggle-mlflow-register-smoke-test"
REGISTERED_MODEL_NAME = "NIDS-Smoke-Test-Model"


def _load_secret_from_kaggle(secret_name: str) -> str | None:
    try:
        from kaggle_secrets import UserSecretsClient

        client = UserSecretsClient()
        return client.get_secret(secret_name)
    except Exception:
        return None


def _get_required_secret(secret_name: str) -> str:
    value = _load_secret_from_kaggle(secret_name) or os.environ.get(secret_name, "").strip()
    if not value:
        raise RuntimeError(
            f"Missing required credential: {secret_name}. "
            "Add it to Kaggle Secrets or provide it as an environment variable."
        )
    return value


def _maybe_set_secret(secret_name: str) -> None:
    value = _load_secret_from_kaggle(secret_name) or os.environ.get(secret_name, "").strip()
    if value:
        os.environ[secret_name] = value


def _wait_until_ready(client: MlflowClient, model_name: str, version: str, timeout_seconds: int = 120):
    import time

    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        mv = client.get_model_version(model_name, version)
        if str(mv.status) == "READY":
            return mv
        time.sleep(2)
    raise TimeoutError(f"Timed out waiting for model version {model_name}/{version} to become READY")


def _set_stage_alias_or_tag(client: MlflowClient, model_name: str, version: str) -> str:
    try:
        client.set_registered_model_alias(model_name, "Staging", version)
        return "alias:Staging"
    except Exception:
        client.set_model_version_tag(model_name, version, "stage", "Staging")
        return "tag:stage=Staging"


def main() -> None:
    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", DEFAULT_TRACKING_URI).strip() or DEFAULT_TRACKING_URI
    username = _get_required_secret("MLFLOW_TRACKING_USERNAME")
    password = _get_required_secret("MLFLOW_TRACKING_PASSWORD")

    os.environ["MLFLOW_TRACKING_USERNAME"] = username
    os.environ["MLFLOW_TRACKING_PASSWORD"] = password

    for aws_var in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_DEFAULT_REGION"):
        _maybe_set_secret(aws_var)

    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_registry_uri(tracking_uri)
    mlflow.set_experiment(EXPERIMENT_NAME)
    client = MlflowClient()

    dataset = load_iris()
    X_train, X_test, y_train, y_test = train_test_split(
        dataset.data,
        dataset.target,
        test_size=0.2,
        random_state=42,
        stratify=dataset.target,
    )

    model = RandomForestClassifier(n_estimators=20, random_state=42)
    model.fit(X_train, y_train)
    predictions = model.predict(X_test)

    accuracy = accuracy_score(y_test, predictions)
    f1_macro = f1_score(y_test, predictions, average="macro")

    with mlflow.start_run(run_name="kaggle_register_smoke_test") as run:
        mlflow.log_param("source", "kaggle")
        mlflow.log_param("model_type", "RandomForestClassifier")
        mlflow.log_param("dataset", "iris")
        mlflow.log_metric("accuracy", float(accuracy))
        mlflow.log_metric("f1_macro", float(f1_macro))
        mlflow.set_tag("test_type", "mlflow_register_connectivity")
        mlflow.set_tag("registry_target", REGISTERED_MODEL_NAME)

        model_info = mlflow.sklearn.log_model(
            sk_model=model,
            name="smoke_model",
        )

        registration = mlflow.register_model(
            model_uri=model_info.model_uri,
            name=REGISTERED_MODEL_NAME,
        )

        version = str(registration.version)
        _wait_until_ready(client, REGISTERED_MODEL_NAME, version)
        staging_marker = _set_stage_alias_or_tag(client, REGISTERED_MODEL_NAME, version)

        print("MLflow register smoke test succeeded.")
        print(f"Tracking URI           : {tracking_uri}")
        print(f"Run ID                 : {run.info.run_id}")
        print(f"Artifact URI           : {mlflow.get_artifact_uri()}")
        print(f"Registered Model Name  : {REGISTERED_MODEL_NAME}")
        print(f"Model Version          : {version}")
        print(f"Staging Marker         : {staging_marker}")


if __name__ == "__main__":
    main()
