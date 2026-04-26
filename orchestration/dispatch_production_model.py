"""
Phase 3 bridge script.

Muc dich:
  Doc model dang o Production trong MLflow Registry va dispatch mot event sang
  GitHub Actions de deploy API.

Env quan trong:
  - MLFLOW_TRACKING_URI
  - MLFLOW_REGISTRY_URI (optional, default = tracking URI)
  - MLFLOW_MODEL_NAME
  - GITHUB_REPOSITORY hoac GITHUB_REPO
  - GITHUB_TOKEN
  - GITHUB_EVENT_TYPE hoac GITHUB_DEPLOY_EVENT (optional)
  - PRODUCTION_ALIAS (optional)

Luu y:
  Script se uu tien alias neu `PRODUCTION_ALIAS` duoc cung cap. Neu khong co,
  no se fallback ve stage `Production` de giu backward compatibility.
"""

import json
import os
import urllib.request

import mlflow
from mlflow.tracking import MlflowClient


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"Missing required environment variable: {name}")
    return value


def _get_latest_production_model(client: MlflowClient, model_name: str):
    versions = client.get_latest_versions(model_name, stages=["Production"])
    if not versions:
        raise RuntimeError(f"No Production model found for registry '{model_name}'")
    return versions[0]


def _get_target_production_model(
    client: MlflowClient,
    model_name: str,
    production_alias: str,
):
    if production_alias:
        try:
            return client.get_model_version_by_alias(model_name, production_alias)
        except Exception:
            pass
    return _get_latest_production_model(client, model_name)


def main():
    tracking_uri = _require_env("MLFLOW_TRACKING_URI")
    registry_uri = os.environ.get("MLFLOW_REGISTRY_URI", tracking_uri).strip() or tracking_uri
    model_name = os.environ.get("MLFLOW_MODEL_NAME", "NIDS-XGBoost")
    github_repo = (
        os.environ.get("GITHUB_REPOSITORY", "").strip()
        or os.environ.get("GITHUB_REPO", "").strip()
    )
    if not github_repo:
        raise ValueError("Missing required environment variable: GITHUB_REPOSITORY or GITHUB_REPO")
    github_token = _require_env("GITHUB_TOKEN")
    event_type = (
        os.environ.get("GITHUB_EVENT_TYPE", "").strip()
        or os.environ.get("GITHUB_DEPLOY_EVENT", "").strip()
        or "mlflow_production_selected"
    )
    production_alias = os.environ.get("PRODUCTION_ALIAS", "").strip()

    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_registry_uri(registry_uri)
    client = MlflowClient()

    production_mv = _get_target_production_model(client, model_name, production_alias)
    run = client.get_run(production_mv.run_id)
    params = run.data.params
    metrics = run.data.metrics

    model_version = params.get("model_version") or production_mv.tags.get("model_version")
    if not model_version:
        raise RuntimeError(
            "The MLflow Production model does not contain the business model_version param/tag required for deployment."
        )

    experiment_id = run.info.experiment_id

    payload = {
        "event_type": event_type,
        "client_payload": {
            "registry_model_name": model_name,
            "registry_version": str(production_mv.version),
            "model_version": model_version,
            "run_id": production_mv.run_id,
            "experiment_id": experiment_id,
            "current_stage": production_mv.current_stage,
            "f1_score": metrics.get("f1_score"),
        },
    }

    url = f"https://api.github.com/repos/{github_repo}/dispatches"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {github_token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            "User-Agent": "MLflow-Production-Dispatcher",
        },
        method="POST",
    )

    with urllib.request.urlopen(req) as response:
        print("=" * 60)
        print("Dispatched GitHub deployment event from MLflow Production model.")
        print(f"  Registry model  : {model_name}")
        print(f"  Registry ver    : {production_mv.version}")
        print(f"  Business ver    : {model_version}")
        print(f"  Event type      : {event_type}")
        print(f"  GitHub response : {response.status}")
        print("=" * 60)


if __name__ == "__main__":
    main()
