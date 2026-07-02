import logging
import re
from typing import Any, Dict
from django.core.cache import cache

logger = logging.getLogger("paas.training.metrics")


def get_training_metrics_payload(training_job) -> Dict[str, Any]:
    lines = []
    try:
        client = cache.client.get_client()
        logs = client.lrange(f"training_logs:{training_job.id}", -200, -1)
        lines = [log.decode('utf-8') if isinstance(log, bytes) else str(log) for log in logs]
    except Exception:
        pass

    if not lines and training_job.training_logs:
        lines = training_job.training_logs.split("\n")[-200:]

    metrics = []
    for line in lines:
        # Check for standard metric patterns like loss=0.123 accuracy=0.95
        matches = re.findall(r'(\b[a-zA-Z_]+)\s*[:=]\s*([0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)', line)
        if matches:
            metrics.append(line)

    return {
        "status": training_job.status,
        "metrics": metrics,
    }


def create_model_artifact_presigned_url(training_job, expiration: int = 3600) -> str:
    import boto3
    from urllib.parse import urlparse
    uri = training_job.model_artifact_uri or training_job.output_s3_uri
    if not uri or not uri.startswith("s3://"):
        return ""
    parsed = urlparse(uri)
    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    s3 = boto3.client("s3")
    try:
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expiration,
        )
    except Exception as exc:
        logger.error(f"Failed to generate presigned URL for {uri}: {exc}")
        return ""
