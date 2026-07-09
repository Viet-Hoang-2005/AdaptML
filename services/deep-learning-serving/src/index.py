import logging
import os
import bentoml
import mlflow.pyfunc
import pandas as pd
from typing import Any, Dict, List
from src.loading import download_model_artifact, resolve_mlflow_model_dir

logger = logging.getLogger("bentoml.paas_service")

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

    @bentoml.api(route="/predict", batchable=True, batch_dim=0, max_batch_size=64, max_latency_ms=10)
    def predict(self, features: Any) -> List[Any]:
        if self.model is None:
            raise RuntimeError("Model failed to load at startup")

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
            return preds.tolist()
        return list(preds)

    @bentoml.api(route="/health", batchable=False)
    def health(self) -> Dict[str, Any]:
        return {
            "status": "healthy",
            "model_loaded": self.model is not None,
            "runtime": "deep-learning-serving-native-adaptive-batching",
            "model_id": os.environ.get("MODEL_ID", "unknown"),
            "engine": "deep-learning-serving",
        }
