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


# ── Optional MLflow integration (Phase 10E.1) ───────────────────────────────
# If mlflow is installed and MLFLOW_TRACKING_URI is set, this script will:
#   1. Log parameters and metrics to the configured MLflow Tracking Server.
#   2. Print MLFLOW_RUN_ID and MLFLOW_EXPERIMENT_ID so the Control Plane can
#      capture them for Model Evolution lineage linking.
#
# If mlflow is NOT installed or MLFLOW_TRACKING_URI is not set, training
# continues normally using METRIC_JSON stdout logging only.
#
# Container/internal URI (used in docker-compose local training):
#   MLFLOW_TRACKING_URI=http://mlflow:5000
#
# Do NOT use http://localhost:5001 inside training containers.
# ─────────────────────────────────────────────────────────────────────────────
try:
    import mlflow
    _MLFLOW_URI = os.environ.get("MLFLOW_TRACKING_URI", "").strip()
    _MLFLOW_AVAILABLE = bool(_MLFLOW_URI)
    if _MLFLOW_AVAILABLE:
        mlflow.set_tracking_uri(_MLFLOW_URI)
        _exp_name = os.environ.get("MLFLOW_EXPERIMENT_NAME", "mlops-paas-training")
        mlflow.set_experiment(_exp_name)
except ImportError:
    _MLFLOW_AVAILABLE = False


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

    # ── Optional: log to MLflow if available ─────────────────────────────────
    _mlflow_run = None
    if _MLFLOW_AVAILABLE:
        try:
            _mlflow_run = mlflow.start_run(run_name=f"train-{model_version}")
            mlflow.log_param("n_estimators", 10)
            mlflow.log_param("model_version", model_version)
            mlflow.log_param("target", target)
            mlflow.log_metric("accuracy", accuracy)
            mlflow.log_metric("feature_count", float(feature_count))
            _run_id = mlflow.active_run().info.run_id
            _exp_id = mlflow.active_run().info.experiment_id
            # Emit structured markers for Control Plane lineage capture.
            print(f"MLFLOW_RUN_ID:{_run_id}")
            print(f"MLFLOW_EXPERIMENT_ID:{_exp_id}")
            print(f"MLFLOW_MODEL_URI:runs:/{_run_id}/sklearn-model")
        except Exception as _e:
            print(f"[mlflow] Logging skipped: {_e}")
    # ─────────────────────────────────────────────────────────────────────────

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

    # End MLflow run if one was started.
    if _mlflow_run is not None:
        try:
            mlflow.end_run()
        except Exception:
            pass


if __name__ == "__main__":
    main()
