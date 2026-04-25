import os
import sys
import tempfile


def _ensure_dependency(module_name: str, package_name: str | None = None) -> None:
    package_name = package_name or module_name
    try:
        __import__(module_name)
    except ImportError:
        import subprocess

        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--quiet", package_name]
        )


_ensure_dependency("mlflow")

import mlflow


DEFAULT_TRACKING_URI = "https://mlflow.mlops-nids-nt114.id.vn"
EXPERIMENT_NAME = "kaggle-mlflow-smoke-test"


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


def main() -> None:
    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", DEFAULT_TRACKING_URI).strip() or DEFAULT_TRACKING_URI
    username = _get_required_secret("MLFLOW_TRACKING_USERNAME")
    password = _get_required_secret("MLFLOW_TRACKING_PASSWORD")

    os.environ["MLFLOW_TRACKING_USERNAME"] = username
    os.environ["MLFLOW_TRACKING_PASSWORD"] = password

    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment(EXPERIMENT_NAME)

    with tempfile.TemporaryDirectory(prefix="mlflow-smoke-") as temp_dir:
        artifact_path = os.path.join(temp_dir, "hello_mlflow.txt")
        with open(artifact_path, "w", encoding="utf-8") as file_handle:
            file_handle.write("hello from kaggle smoke test\n")

        with mlflow.start_run(run_name="kaggle_connectivity_smoke_test") as run:
            mlflow.log_param("source", "kaggle")
            mlflow.log_metric("connectivity", 1.0)
            mlflow.set_tag("test_type", "mlflow_connectivity")

            try:
                mlflow.log_artifact(artifact_path)
            except Exception as exc:
                print(f"Failed to log artifact '{artifact_path}': {exc}")
                raise

            print(f"MLflow smoke test succeeded.")
            print(f"Tracking URI : {tracking_uri}")
            print(f"Experiment   : {EXPERIMENT_NAME}")
            print(f"Run ID       : {run.info.run_id}")
            print(f"Artifact URI : {mlflow.get_artifact_uri()}")


if __name__ == "__main__":
    main()
