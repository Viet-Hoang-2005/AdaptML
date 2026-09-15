"""Pure batch transformations for persisted inference events."""

import pandas as pd
from src.models import KafkaRecord


INFERENCE_EVENT_COLUMNS = (
    "id", "prediction_id", "tenant_id", "project_id", "model_version_id",
    "model_version", "endpoint_url", "request_id", "timestamp", "prediction",
    "confidence", "latency_ms", "status_code", "created_at",
)

PRODUCTION_DATA_COLUMNS = (
    "id", "inference_event_id", "tenant_id", "project_id", "model_version_id",
    "observed_at", "features", "prediction", "ground_truth", "label_status",
    "labeled_at", "data_quality_status", "training_eligibility",
    "exclusion_reason", "drift_run_id", "created_at",
)


def is_production_sample(payload: dict) -> bool:
    """Return whether an inference event can enter the CT candidate dataset."""
    event_id = payload.get("id") or payload.get("prediction_id")
    status_code = payload.get("status_code", 200)
    try:
        successful = 200 <= int(status_code) < 300
    except (TypeError, ValueError):
        successful = False
    return bool(event_id and isinstance(payload.get("features"), dict) and successful)


def build_batch_dataframe(records: list[KafkaRecord]) -> pd.DataFrame:
    """Build the minimal inference-telemetry rows; never persist raw input here."""
    frame = pd.DataFrame([record.payload for record in records])
    for column in ("timestamp", "created_at"):
        if column in frame.columns:
            frame[column] = pd.to_datetime(frame[column], utc=True, errors="coerce")
    return frame.reindex(columns=INFERENCE_EVENT_COLUMNS)


def build_production_data_dataframe(records: list[KafkaRecord]) -> pd.DataFrame:
    """Build unlabeled, non-eligible CT candidates from successful inference events."""
    rows = []
    for record in records:
        payload = record.payload
        if not is_production_sample(payload):
            continue
        event_id = str(payload.get("id") or payload["prediction_id"])
        rows.append(
            {
                "id": event_id,
                "inference_event_id": event_id,
                "tenant_id": payload.get("tenant_id"),
                "project_id": payload.get("project_id"),
                "model_version_id": payload.get("model_version_id"),
                "observed_at": payload.get("timestamp"),
                "features": payload.get("features"),
                "prediction": payload.get("prediction"),
                "ground_truth": None,
                "label_status": "unlabeled",
                "labeled_at": None,
                "data_quality_status": "unchecked",
                "training_eligibility": False,
                "exclusion_reason": None,
                "drift_run_id": None,
                "created_at": payload.get("created_at"),
            }
        )
    frame = pd.DataFrame(rows, columns=PRODUCTION_DATA_COLUMNS)
    for column in ("observed_at", "labeled_at", "created_at"):
        if column in frame.columns:
            frame[column] = pd.to_datetime(frame[column], utc=True, errors="coerce")
    return frame


def build_automatic_drift_signals(
    records: list[KafkaRecord],
) -> list[dict[str, str]]:
    if not records:
        return []
    first, last = records[0], records[-1]
    model_version_ids = {
        str(record.payload["model_version_id"])
        for record in records
        if is_production_sample(record.payload) and record.payload.get("model_version_id")
    }
    batch_key = f"{first.topic}:{first.partition}:{first.offset}:{last.offset}"
    return [
        {
            "model_version_id": model_version_id,
            "idempotency_key": f"automatic-drift:{batch_key}:{model_version_id}",
        }
        for model_version_id in sorted(model_version_ids)
    ]
