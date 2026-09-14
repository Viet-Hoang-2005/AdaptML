import os
import bentoml
import mlflow.pyfunc
import pandas as pd
from typing import Any, Dict
from src.logging_utils import configure, current_context, get_logger, log_event
from src.logging_utils import RequestLoggingMiddleware
from src.loading import download_model_artifact, resolve_mlflow_model_dir

logger = get_logger(__name__)


def _keep_bentoml_operational_log(record):
    # BentoML 1.4 also emits one exception log per failed API request. The
    # local middleware owns these failures, including their retry summaries.
    return not (
        record.msg == "Exception on %s [%s]"
        and current_context().get("request_id")
    )


def load_runtime_model(model_version_id: str, model_uri: str | None):
    model_dir = "/app/model_artifact"
    if model_uri:
        source_dir = download_model_artifact(model_version_id, model_uri)
        model_dir = str(resolve_mlflow_model_dir(source_dir))
    elif not os.path.exists(model_dir):
        model_dir = "."
    log_event(logger, "INFO", "model_load_started", "Loading deep learning model")
    return mlflow.pyfunc.load_model(model_dir)

@bentoml.service(
    resources={"cpu": "2"},
    traffic={"timeout": 60},
    logging={"access": {"enabled": False}},
)
class DeepLearningModelService:
    def __init__(self):
        # BentoML configures logging again when each worker starts.
        configure("deep-learning-serving")
        get_logger("bentoml._internal.server.http_app").addFilter(_keep_bentoml_operational_log)
        model_version_id_str = os.environ.get("MODEL_VERSION_ID")
        model_uri = os.environ.get("MODEL_URI")
        model_version_id = (
            model_version_id_str if model_version_id_str and model_version_id_str != "unknown" else "unknown"
        )
        try:
            self.model = load_runtime_model(model_version_id, model_uri)
            log_event(logger, "INFO", "model_loaded", "Deep learning model loaded")
        except Exception as exc:
            log_event(logger, "ERROR", "model_load_failed", "Deep learning model load failed", error_type=type(exc).__name__)
            self.model = None

    @bentoml.api(route="/predict", batchable=False)
    def predict(self, payload: Any) -> Dict[str, Any]:
        if self.model is None:
            raise RuntimeError("Model failed to load at startup")

        features = payload.get("features", payload) if isinstance(payload, dict) else payload
        model_version_id = (
            payload.get("model_version_id")
            if isinstance(payload, dict)
            else os.environ.get("MODEL_VERSION_ID", "unknown")
        )

        if isinstance(features, dict):
            if all(isinstance(v, (list, tuple, pd.Series)) for v in features.values()):
                df = pd.DataFrame(features)
            else:
                df = pd.DataFrame([features])
        elif isinstance(features, list):
            df = pd.DataFrame(features)
        elif isinstance(features, pd.DataFrame):
            df = features
        else:
            df = pd.DataFrame(features)

        preds = self.model.predict(df)
        if hasattr(preds, "tolist"):
            result = preds.tolist()
        else:
            result = list(preds)
        prediction = result[0] if isinstance(result, list) and len(result) == 1 else result
        return {
            "success": True,
            "prediction": prediction,
            "confidence": None,
            "project_id": os.environ.get("PROJECT_ID", "unknown"),
            "model_version_id": str(model_version_id),
            "engine": "deep-learning-serving",
        }

    @bentoml.api(route="/health", batchable=False)
    def health(self) -> Dict[str, Any]:
        return {
            "status": "healthy",
            "model_loaded": self.model is not None,
            "runtime": "deep-learning-serving-bentoml",
            "project_id": os.environ.get("PROJECT_ID", "unknown"),
            "model_version_id": os.environ.get("MODEL_VERSION_ID", "unknown"),
            "engine": "deep-learning-serving",
        }


DeepLearningModelService.add_asgi_middleware(
    RequestLoggingMiddleware, service="deep-learning-serving"
)
