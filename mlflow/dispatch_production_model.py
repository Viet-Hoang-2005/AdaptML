# dispatch_production_model.py: Script bắn webhook đến GitHub khi model Production được chọn trong MLflow Model Registry
import json
import os
import urllib.request

import mlflow
from mlflow.tracking import MlflowClient

# Hàm lấy model Production mới nhất
def get_latest_production_model(client: MlflowClient, model_name: str):
    versions = client.get_latest_versions(model_name, stages=["Production"])
    if not versions:
        raise RuntimeError(f"No Production model found for registry '{model_name}'")
    return versions[0]

# Hàm lấy model Production theo alias
def get_target_production_model(
    client: MlflowClient,
    model_name: str,
    production_alias: str,
):
    if production_alias:
        try:
            return client.get_model_version_by_alias(model_name, production_alias)
        except Exception:
            pass
    return get_latest_production_model(client, model_name)

# Main function để dispatch webhook khi model Production được chọn
def main():
    tracking_uri = os.environ.get("MLFLOW_TRACKING_URI")
    registry_uri = os.environ.get("MLFLOW_REGISTRY_URI") or tracking_uri
    model_name = os.environ.get("MLFLOW_MODEL_NAME", "NIDS-XGBoost")
    production_alias = os.environ.get("PRODUCTION_ALIAS", "")

    github_repo = os.environ.get("GITHUB_REPO")
    github_token = os.environ.get("GITHUB_TOKEN")
    event_type = os.environ.get("GITHUB_DEPLOY_EVENT", "mlflow_production_selected")

    if not github_repo or not github_token:
        raise ValueError("Error: Missing environment variables GITHUB_REPO or GITHUB_TOKEN!")

    # Thiết lập MLflow client
    if tracking_uri:
        mlflow.set_tracking_uri(tracking_uri)
    if registry_uri:
        mlflow.set_registry_uri(registry_uri)
    client = MlflowClient()

    # Lấy model Production theo alias hoặc mới nhất
    production_mv = get_target_production_model(client, model_name, production_alias)
    
    # Kiểm tra xem model này đã được dispatch trước đó chưa
    if production_mv.tags.get("deployment_status") == "dispatched":
        print(f"Model {model_name} (Version: {production_mv.version}) has already been deployed. Skipping.")
        return

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
        print("Dispatched GitHub deployment event from MLflow Production model.")
        print(f"  Registry model  : {model_name}")
        print(f"  Registry ver    : {production_mv.version}")
        print(f"  Business ver    : {model_version}")
        print(f"  Event type      : {event_type}")
        print(f"  GitHub response : {response.status}")

        # Đánh dấu model đã được deploy để lần chạy CronJob tiếp theo không gọi lại nữa
        client.set_model_version_tag(model_name, production_mv.version, "deployment_status", "dispatched")
        print("Tagged 'deployment_status=dispatched' on MLflow.")

if __name__ == "__main__":
    main()
