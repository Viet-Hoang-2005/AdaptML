import json
import logging
import os
import uuid
from datetime import datetime
from typing import Any, Dict

import bentoml
import mlflow.pyfunc
from confluent_kafka import Producer
from fastapi import Body, FastAPI

logger = logging.getLogger("bentoml.paas_service")
http_app = FastAPI(title="Bento Model Server Runtime")

# Cấu hình Redpanda / Kafka Producer cho Production Logging Layer (Evidently AI Data Drift)
REDPANDA_BROKERS = os.environ.get("REDPANDA_BROKERS", "redpanda:9092")
KAFKA_TOPIC = os.environ.get("KAFKA_TOPIC", "mlops_paas_production_data")

try:
    kafka_producer = Producer({
        "bootstrap.servers": REDPANDA_BROKERS,
        "client.id": "bento-model-server-dl",
        "linger.ms": 5,
    })
    logger.info(f"Redpanda Connected: {REDPANDA_BROKERS} - Topic: {KAFKA_TOPIC}")
except Exception as exc:
    logger.warning(f"Failed to setup Redpanda producer: {exc}")
    kafka_producer = None


def send_log_to_redpanda(tenant_id: str, model_id: str, features_dict: dict, prediction_result: Any):
    if kafka_producer is None:
        return
    try:
        payload = {
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "model_id": str(model_id),
            "timestamp": datetime.utcnow().isoformat(),
            "features": features_dict,
            "prediction": prediction_result,
        }
        kafka_producer.produce(
            topic=KAFKA_TOPIC,
            key=payload["id"].encode("utf-8"),
            value=json.dumps(payload).encode("utf-8"),
        )
        kafka_producer.poll(0)
    except Exception as exc:
        logger.error(f"Error sending log to Redpanda: {exc}")


@bentoml.asgi_app(http_app, path="/")
@bentoml.service(
    resources={"cpu": "2"},
    traffic={"timeout": 60},
)
class DeepLearningModelService:
    def __init__(self):
        # Tải model nhị phân đã được giải nén sẵn trong thư mục /app/model_artifact
        model_dir = "/app/model_artifact"
        if not os.path.exists(model_dir):
            model_dir = "."
        logger.info(f"Loading Deep Learning model from {model_dir}...")
        try:
            self.model = mlflow.pyfunc.load_model(model_dir)
            logger.info("Model loaded successfully via mlflow.pyfunc!")
        except Exception as exc:
            logger.error(f"Error loading model from {model_dir}: {exc}")
            self.model = None

    def _predict(self, input_data: Dict[str, Any], model_id_str: str | None = None) -> Dict[str, Any]:
        if self.model is None:
            return {"success": False, "error": "Model failed to load at startup"}

        features = input_data.get("features", input_data)
        
        # Xử lý input DataFrame cho suy luận
        import pandas as pd
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

        # Ghi log bất đồng bộ sang Redpanda/Kafka cho tầng Evidently Drift Monitoring
        tenant_id = os.environ.get("TENANT_ID", "unknown")
        model_id = os.environ.get("MODEL_ID") or model_id_str or "unknown"
        send_log_to_redpanda(tenant_id, model_id, features if isinstance(features, dict) else {"data": features}, prediction_result)

        return {
            "success": True,
            "prediction": prediction_result,
            "model_loaded": True,
        }

    def _health(self, model_id_str: str | None = None) -> Dict[str, Any]:
        return {
            "status": "healthy",
            "model_loaded": self.model is not None,
            "runtime": "bento-model-server-adaptive-batching",
            "model_id": os.environ.get("MODEL_ID") or model_id_str or "unknown",
        }

    @http_app.post("/models/{model_id_str}/predict")
    def predict_http(self, model_id_str: str, input_data: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
        """FastAPI-compatible endpoint used by shared Argo deploy routing."""
        return self._predict(input_data, model_id_str=model_id_str)

    @http_app.get("/models/{model_id_str}/health")
    def health_http(self, model_id_str: str) -> Dict[str, Any]:
        """FastAPI-compatible health endpoint used by Control Plane checks."""
        return self._health(model_id_str=model_id_str)

    @bentoml.api(route="/predict")
    def predict(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Legacy BentoML prediction endpoint."""
        return self._predict(input_data)

    @bentoml.api(route="/health")
    def health(self) -> Dict[str, Any]:
        """Legacy BentoML health endpoint."""
        return self._health()
