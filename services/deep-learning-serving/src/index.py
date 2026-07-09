import logging
import os
import bentoml
import mlflow.pyfunc
import pandas as pd
from fastapi import Body, FastAPI
from typing import Any, Dict
from src.loading import download_model_artifact, resolve_mlflow_model_dir

logger = logging.getLogger("bentoml.paas_service")
http_app = FastAPI(title="Deep Learning Serving Engine (BentoML)")

@bentoml.asgi_app(http_app, path="/")
@bentoml.service(
    resources={"cpu": "2"},
    traffic={"timeout": 60},
)
class DeepLearningModelService:
    def __init__(self):
        model_id_str = os.environ.get("MODEL_ID")
        model_uri = os.environ.get("MODEL_URI")
        model_dir = "/app/model_artifact"
        
        try:
            if model_uri:
                model_id = int(model_id_str) if model_id_str and model_id_str != "unknown" and model_id_str.isdigit() else 0
                source_dir = download_model_artifact(model_id, model_uri)
                model_dir = str(resolve_mlflow_model_dir(source_dir))
            elif not os.path.exists(model_dir):
                model_dir = "."
            
            logger.info(f"Loading Deep Learning model from {model_dir}...")
            self.model = mlflow.pyfunc.load_model(model_dir)
            logger.info("Model loaded successfully via mlflow.pyfunc!")
        except Exception as exc:
            logger.error(f"Error loading DL model from {model_dir or model_uri}: {exc}")
            self.model = None

    def _predict(self, input_data: Dict[str, Any], model_id_str: str | None = None) -> Dict[str, Any]:
        if self.model is None:
            return {"success": False, "error": "Model failed to load at startup"}

        features = input_data.get("features", input_data)
        
        if isinstance(features, dict):
            df = pd.DataFrame([features])
        elif isinstance(features, list):
            df = pd.DataFrame(features)
        else:
            df = features

        preds = self.model.predict(df)
        if hasattr(preds, "tolist"):
            prediction_result = preds.tolist()
        else:
            prediction_result = list(preds)

        return {
            "success": True,
            "prediction": prediction_result,
            "model_loaded": True,
            "engine": "deep-learning-serving",
        }

    def _health(self, model_id_str: str | None = None) -> Dict[str, Any]:
        return {
            "status": "healthy",
            "model_loaded": self.model is not None,
            "runtime": "deep-learning-serving-adaptive-batching",
            "model_id": os.environ.get("MODEL_ID") or model_id_str or "unknown",
            "engine": "deep-learning-serving",
        }

    @http_app.post("/predict")
    def predict_http(self, input_data: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
        return self._predict(input_data)

    @http_app.get("/health")
    def health_http(self) -> Dict[str, Any]:
        return self._health()

    @bentoml.api(route="/predict")
    def predict(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        return self._predict(input_data)

    @bentoml.api(route="/health")
    def health(self) -> Dict[str, Any]:
        return self._health()
