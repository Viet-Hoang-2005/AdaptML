"""
register_models_to_mlflow.py
============================
Dang ky model XGBoost da train san (v1, v2) vao MLflow Model Registry.
Tham khao: MLflow official docs (mlflow.org/docs)

Ngat quy trinh:
  1. Mo va doc file metrics_v*.json
  2. Bat dau mlflow.start_run(run_name=...) — INSIDE block
  3. goi mlflow.log_params() — INSIDE block, TRUOC model
  4. goi mlflow.log_metrics() — INSIDE block, TRUOC model
  5. goi mlflow.pyfunc.log_model(registered_model_name=...) — INSIDE block
     => model duoc register vao Model Registry TU DONG, lien ket voi run hien tai
  6. mlflow.register_model() goi ben ngoai WITH block se MAT lien ket run

Fix: Dung sqlite:// cho CA tracking va registry (MLflow 3.x luu params vao SQLAlchemy)
"""

import os
import sys
import json
import warnings
import shutil
import platform
warnings.simplefilter(action='ignore', category=FutureWarning)

import joblib
import pandas as pd
import mlflow
from mlflow.tracking import MlflowClient
from mlflow.models import infer_signature
from mlflow.pyfunc import PythonModel

# ── Cau hinh duong dan ──────────────────────────────────────────────────────
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ARTIFACT_DIR = os.path.abspath(os.path.join(PROJECT_ROOT, "mlflow_artifacts"))
os.makedirs(ARTIFACT_DIR, exist_ok=True)

# Dung sqlite:// CHO CA tracking va registry tren moi OS
# MLflow 3.x: sqlite:// URI luu params/metrics vao DB chuan, khong can FileStore YAML
_db_abs = os.path.abspath(os.path.join(ARTIFACT_DIR, "mlflow.db")).replace("\\", "/")
# sqlite:/// cần 3 dấu / : sqlite:///D:/path/to/db
if platform.system() == "Windows" and _db_abs[1] == ":":
    _drive, _rest = _db_abs[0], _db_abs[2:]
    _db_uri = f"sqlite:///{_drive}:{_rest}"
else:
    _db_uri = f"sqlite:///{_db_abs}"

MLFLOW_TRACKING_URI = os.environ.get("MLFLOW_TRACKING_URI", _db_uri)
MLFLOW_REGISTRY_URI = os.environ.get("MLFLOW_REGISTRY_URI", _db_uri)

MODEL_REGISTRY_NAME = "NIDS-XGBoost"

VERSIONS = [
    {
        "version":  "v1",
        "stage":    "Staging",
        "run_name": "Champion_Model_v1",
        "model_pkl":    os.path.join(PROJECT_ROOT, "models", "v1", "xgb_nids_model_v1.pkl"),
        "labels_json":  os.path.join(PROJECT_ROOT, "models", "v1", "label_classes_v1.json"),
        "metrics_json": os.path.join(PROJECT_ROOT, "models", "v1", "metrics_v1.json"),
        "description":  "Binary classifier: BENIGN vs DDoS. Legacy champion.",
    },
    {
        "version":  "v2",
        "stage":    "Production",
        "run_name": "Challenger_Model_v2",
        "model_pkl":    os.path.join(PROJECT_ROOT, "models", "v2", "xgb_nids_model_v2.pkl"),
        "labels_json":  os.path.join(PROJECT_ROOT, "models", "v2", "label_classes_v2.json"),
        "metrics_json": os.path.join(PROJECT_ROOT, "models", "v2", "metrics_v2.json"),
        "description":  "Multi-class: BENIGN, DDoS, PortScan. Challenger production.",
    },
]


# ── Pyfunc Wrapper ─────────────────────────────────────────────────────────────
class XGBoostNIDSWrapper(PythonModel):
    """Wrap joblib XGBoost model thanh pyfunc flavor cho MLflow."""

    def __init__(self, model, label_classes):
        self.model = model
        self.label_classes = label_classes

    def predict(self, context, model_input):
        if isinstance(model_input, pd.DataFrame):
            preds = self.model.predict(model_input.values)
        else:
            preds = self.model.predict(model_input)
        return preds


# ── Ham chinh ─────────────────────────────────────────────────────────────────
def main():
    mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
    mlflow.set_registry_uri(MLFLOW_REGISTRY_URI)
    mlflow.set_experiment("NIDS-Model-Registry")

    print(f"\n{'='*60}")
    print(f"  MLflow Tracking URI : {MLFLOW_TRACKING_URI}")
    print(f"  MLflow Registry URI : {MLFLOW_REGISTRY_URI}")
    print(f"  Model Registry Name : {MODEL_REGISTRY_NAME}")
    print(f"{'='*60}\n")

    client = MlflowClient()

    for cfg in VERSIONS:
        ver      = cfg["version"]
        stage    = cfg["stage"]
        run_name = cfg["run_name"]
        print(f"\n{'='*60}")
        print(f"  [{ver}] {run_name}  stage={stage}")
        print(f"{'='*60}")

        # ── 1. Mo va doc file metrics_v*.json ────────────────────
        for path, label in [
            (cfg["model_pkl"],    "model .pkl"),
            (cfg["labels_json"],  "labels .json"),
            (cfg["metrics_json"], "metrics .json"),
        ]:
            if not os.path.exists(path):
                print(f"  [ERROR] File not found: {path}")
                sys.exit(1)

        xgb_model = joblib.load(cfg["model_pkl"])
        with open(cfg["labels_json"]) as f:
            label_classes = json.load(f)
        with open(cfg["metrics_json"]) as f:
            metrics_data = json.load(f)

        print(f"  Labels  : {label_classes}")
        print(f"  Metrics : {metrics_data['evaluation_metrics']}")

        # ── 2. Bat dau MLflow Run voi run_name ro rang ────────────
        with mlflow.start_run(run_name=run_name) as run:
            run_id = run.info.run_id
            print(f"  Run ID   : {run_id}")
            print(f"  Run Name : {run_name}")

            # ── 3. Log PARAMS (trong run, TRUOC model) ──────────
            params = dict(metrics_data.get("best_hyperparameters", {}))
            params["model_version"] = ver
            params["num_classes"]   = metrics_data["num_classes"]
            params["objective"]     = metrics_data["objective"]
            mlflow.log_params(params)
            print(f"  Params logged: {list(params.keys())}")

            # ── 4. Log METRICS (trong run, TRUOC model) ──────────
            ev = metrics_data["evaluation_metrics"]
            mlflow.log_metrics({
                "accuracy":  ev["accuracy"],
                "precision": ev["precision"],
                "recall":    ev["recall"],
                "f1_score":  ev["f1_score"],
            })
            print(f"  Metrics logged: accuracy={ev['accuracy']}, f1_score={ev['f1_score']}")

            # ── 5. Tags ─────────────────────────────────────────
            mlflow.set_tag("description",       cfg["description"])
            mlflow.set_tag("stage",           stage)
            mlflow.set_tag("registered_model", MODEL_REGISTRY_NAME)

            # ── 6. Signature + input example (52 CIC-IDS2017 features) ──
            n_features    = 52
            input_example = pd.DataFrame(
                [[0.0] * n_features],
                columns=[f"F{i}" for i in range(n_features)],
            )
            signature = infer_signature(
                input_example,
                pd.Series([0], name="predicted_label"),
            )

            # ── 7. Save model (trong run) ────────────────────────
            wrapped   = XGBoostNIDSWrapper(model=xgb_model, label_classes=label_classes)
            model_dir = os.path.join(ARTIFACT_DIR, f"{ver}_xgb_nids")
            if os.path.exists(model_dir):
                shutil.rmtree(model_dir)
            mlflow.pyfunc.save_model(
                path=model_dir,
                python_model=wrapped,
                signature=signature,
                input_example=input_example,
            )
            print(f"  Model saved: {model_dir}/")

            # ── 8. Log artifact VAO RUN (trong run) ──────────────
            mlflow.log_artifact(model_dir)
            artifact_uri = mlflow.get_artifact_uri()
            print(f"  Artifact URI: {artifact_uri}")

            # ── 9. Dang ky MODEL REGISTRY (trong run) ─────────────
            #    Di goi TRONG WITH block => MLflow lien ket model voi run hien tai
            model_uri = f"runs:/{run_id}/{ver}_xgb_nids"
            mv = mlflow.register_model(model_uri=model_uri, name=MODEL_REGISTRY_NAME)
            print(f"  Registered : {MODEL_REGISTRY_NAME}/v{mv.version}  run_id={run_id}")

        # Run da end() tai day

        # ── 10. Dat stage (sau khi run ket thuc) ──────────────────
        try:
            client.transition_model_version_stage(
                name=MODEL_REGISTRY_NAME,
                version=mv.version,
                stage=stage,
            )
            print(f"  Stage set : '{stage}'")
        except Exception as e:
            print(f"  [WARN] Stage error: {e}")

        print(f"  [OK] {ver} registered successfully!\n")

    # ── Tom tat ─────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  [OK] HOAN TAT -- Tat ca model da dang ky vao Model Registry")
    print(f"  Registered Model Name : {MODEL_REGISTRY_NAME}")
    print(f"  MLflow Dashboard     : http://localhost:5001")
    print(f"{'='*60}\n")

    print("Model versions trong Registry:")
    try:
        rm = client.get_registered_model(MODEL_REGISTRY_NAME)
        for v in rm.latest_versions:
            version = v.version        if hasattr(v, 'version')        else "?"
            stage   = v.current_stage if hasattr(v, 'current_stage') else "?"
            status  = str(v.status)    if hasattr(v, 'status')       else "?"
            print(f"  * {MODEL_REGISTRY_NAME}/v{version}  status={status}  stage={stage}")
    except Exception as e:
        print(f"  [WARN] {e}")


if __name__ == "__main__":
    main()
