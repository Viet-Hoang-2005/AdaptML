import glob
import json
import os
import pickle
import shutil
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


# ── MLflow tracking is best-effort (non-fatal) ───────────────────────────────
# If MLFLOW_TRACKING_URI is set and the server is reachable, this script will:
#   1. Log parameters and metrics to the configured MLflow Tracking Server.
#   2. Print MLFLOW_RUN_ID and related markers so the Control Plane can
#      capture them for Model Evolution lineage linking.
#
# If MLFLOW_TRACKING_URI is not set, or the server is unreachable, or any
# MLflow call fails, training continues normally and a MLFLOW_WARNING is
# printed. The model artifact is always saved and uploaded.
#
# Container/internal URI (used in docker-compose local training):
#   MLFLOW_TRACKING_URI=http://mlflow:5000
#
# AWS Batch: pass MLFLOW_TRACKING_URI via AWS_BATCH_MLFLOW_TRACKING_URI in .env
# Do NOT use http://localhost:5001 inside training containers.
#
# Optional env vars:
#   MLFLOW_TRACKING_REQUIRED=false   (default) — MLflow failure is a warning only
#   MLFLOW_TRACKING_REQUIRED=true    — MLflow failure will raise and fail the job
#   MLFLOW_HTTP_REQUEST_TIMEOUT=10   — seconds before MLflow HTTP calls time out
# ─────────────────────────────────────────────────────────────────────────────


def try_log_to_mlflow(model, metrics: dict, params: dict) -> dict | None:
    """
    Attempt to log training run to MLflow.

    Returns a dict with mlflow metadata keys if successful, or None if MLflow
    is unavailable or logging fails. Never raises — all errors are caught and
    printed as MLFLOW_WARNING markers.

    Set MLFLOW_TRACKING_REQUIRED=true to make MLflow failure fatal.
    """
    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", "").strip()
    experiment_name = os.environ.get("MLFLOW_EXPERIMENT_NAME", "mlops-paas-training").strip()
    tracking_required = os.environ.get("MLFLOW_TRACKING_REQUIRED", "false").strip().lower() == "true"

    if not tracking_uri:
        print(
            "MLFLOW_WARNING:MLFLOW_TRACKING_URI is not set; skipping MLflow logging",
            flush=True,
        )
        return None

    # Apply optional request timeout so MLflow doesn't hang the entire job.
    timeout_str = os.environ.get("MLFLOW_HTTP_REQUEST_TIMEOUT", "").strip()
    if timeout_str:
        try:
            os.environ.setdefault("MLFLOW_HTTP_REQUEST_MAX_RETRIES", "1")
            os.environ.setdefault("MLFLOW_HTTP_REQUEST_BACKOFF_FACTOR", "0")
        except Exception:
            pass

    try:
        import mlflow
        import mlflow.sklearn

        mlflow.set_tracking_uri(tracking_uri)
        mlflow.set_experiment(experiment_name)

        with mlflow.start_run() as run:
            for key, value in params.items():
                mlflow.log_param(key, value)
            for key, value in metrics.items():
                mlflow.log_metric(key, value)

            mlflow.sklearn.log_model(model, "sklearn-model")

            run_id = run.info.run_id
            experiment_id = run.info.experiment_id
            artifact_uri = mlflow.get_artifact_uri()

            # Emit structured markers for Control Plane lineage capture.
            print(f"MLFLOW_RUN_ID:{run_id}", flush=True)
            print(f"MLFLOW_EXPERIMENT_ID:{experiment_id}", flush=True)
            print(f"MLFLOW_MODEL_URI:runs:/{run_id}/sklearn-model", flush=True)
            print(f"MLFLOW_ARTIFACT_URI:{artifact_uri}", flush=True)

            return {
                "mlflow_run_id": run_id,
                "mlflow_experiment_id": experiment_id,
                "mlflow_model_uri": f"runs:/{run_id}/sklearn-model",
                "mlflow_artifact_uri": artifact_uri,
            }

    except Exception as exc:
        warning_msg = f"MLFLOW_WARNING:MLflow logging skipped due to error: {exc}"
        print(warning_msg, flush=True)

        if tracking_required:
            # Re-raise only when explicitly configured as mandatory.
            raise RuntimeError(warning_msg) from exc

        return None


def main():
    train_dir = os.environ["SM_CHANNEL_TRAIN"]
    model_dir = os.environ["SM_MODEL_DIR"]
    model_version = os.environ.get("MODEL_VERSION", "v1")

    csv_files = sorted(glob.glob(os.path.join(train_dir, "*.csv")))
    if not csv_files:
        raise FileNotFoundError("No CSV file found in SM_CHANNEL_TRAIN")

    df = pd.read_csv(csv_files[0])
    target = "label" if "label" in df.columns else df.columns[-1]
    X = df.drop(columns=[target])
    y = df[target]

    model = Pipeline(
        steps=[
            ("scaler", StandardScaler()),
            ("classifier", RandomForestClassifier(n_estimators=10, random_state=42)),
        ]
    )
    model.fit(X, y)

    # Evaluate
    accuracy = float(model.score(X, y))
    feature_count = len(X.columns)

    # ── Emit METRIC_JSON for Native Registry metrics (always works) ──────────
    print("METRIC_JSON:", json.dumps({
        "step": 1,
        "accuracy": round(accuracy, 4),
        "feature_count": feature_count,
    }))

    # ── Save model artifacts (always happens, independent of MLflow) ─────────
    os.makedirs(model_dir, exist_ok=True)
    with open(os.path.join(model_dir, "model.pkl"), "wb") as handle:
        pickle.dump(model, handle)

    labels = sorted(y.unique().tolist())
    label_mapping = {str(index): label for index, label in enumerate(labels)}
    with open(os.path.join(model_dir, "label_mapping.json"), "w", encoding="utf-8") as handle:
        json.dump(label_mapping, handle, indent=2)

    metadata = {
        "framework": "sklearn",
        "target": target,
        "features": X.columns.tolist(),
        "model_file": "model.pkl",
    }
    with open(os.path.join(model_dir, "model_metadata.json"), "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, indent=2)

    requirements_path = Path(__file__).with_name("requirements.txt")
    if requirements_path.exists():
        shutil.copy2(requirements_path, os.path.join(model_dir, "requirements.txt"))

    # ── Optional: log to MLflow (best-effort, non-fatal) ─────────────────────
    # This runs AFTER artifact saving to ensure artifacts are never blocked by
    # MLflow availability issues.
    try_log_to_mlflow(
        model=model,
        metrics={
            "accuracy": accuracy,
            "feature_count": float(feature_count),
        },
        params={
            "n_estimators": 10,
            "model_version": model_version,
            "target": target,
        },
    )


if __name__ == "__main__":
    main()
