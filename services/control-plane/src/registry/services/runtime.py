import requests
from django.conf import settings

from integrations.hashid_utils import encode_model_id

def get_model_server_public_url():
    return getattr(settings, "MODEL_SERVER_PUBLIC_URL", "http://localhost:5000").rstrip("/")


def get_model_packager_url():
    return getattr(settings, "MODEL_PACKAGER_URL", "http://model-packager:7000").rstrip("/")


def get_model_server_internal_url():
    return getattr(settings, "MODEL_SERVER_INTERNAL_URL", "").rstrip("/")


def resolve_smoke_test_url(endpoint_url):
    internal_base = get_model_server_internal_url()
    public_base = get_model_server_public_url()
    if internal_base and endpoint_url.startswith(public_base):
        return endpoint_url.replace(public_base, internal_base, 1)
    return endpoint_url


def endpoint_issue_payload(exc, *, endpoint_url="", internal_url="", action="health check"):
    detail = str(exc)
    if isinstance(exc, requests.exceptions.Timeout):
        return {
            "success": False,
            "status": "timeout",
            "reason_code": "ENDPOINT_TIMEOUT",
            "message": f"The model endpoint did not respond before the {action} timeout.",
            "endpoint_url": endpoint_url,
            "internal_url": internal_url,
            "technical_detail": detail,
        }
    if "NameResolutionError" in detail or "Failed to resolve" in detail or "Temporary failure in name resolution" in detail:
        return {
            "success": False,
            "status": "not_running",
            "reason_code": "ENDPOINT_CONTAINER_NOT_FOUND",
            "message": (
                "The model endpoint container is not running in the local Docker network. "
                "Run deploy again or start the local model server runtime."
            ),
            "endpoint_url": endpoint_url,
            "internal_url": internal_url,
            "technical_detail": detail,
        }
    return {
        "success": False,
        "status": "not_reachable",
        "reason_code": "ENDPOINT_NOT_REACHABLE",
        "message": "The model endpoint is not reachable from the control-plane container.",
        "endpoint_url": endpoint_url,
        "internal_url": internal_url,
        "technical_detail": detail,
    }


def endpoint_payload_message(payload, fallback):
    if isinstance(payload, dict):
        return payload.get("message") or payload.get("error") or fallback
    return fallback


def model_api_auth_headers(model_api):
    api_key = getattr(getattr(model_api, "tenant", None), "api_key", "") if model_api else ""
    return {"X-API-Key": api_key} if api_key else {}


def build_alias_endpoint_url(family_id: int, alias_name: str) -> str:
    return f"/api/registry/families/{family_id}/aliases/{alias_name}/predict/"


def build_endpoint_url(model_api):
    version = (model_api.version or "v1").strip().strip("/") or "v1"
    hashid_str = encode_model_id(model_api.id)
    return f"{get_model_server_public_url()}/{model_api.tenant.tenant_id}/models/{hashid_str}/{version}/predict"


def model_artifact_uri(model_api):
    if not model_api.artifact:
        return ""

    bucket_name = getattr(settings, "AWS_STORAGE_BUCKET_NAME", "") or getattr(settings, "AWS_BUCKET_NAME", "")
    if bucket_name and model_api.artifact.name:
        return f"s3://{bucket_name}/{model_api.artifact.name}"

    return model_api.artifact.url


