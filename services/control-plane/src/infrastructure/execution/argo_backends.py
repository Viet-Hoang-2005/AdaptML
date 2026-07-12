from apps.deployment.models import Endpoint
from django.conf import settings

from infrastructure.argo import ArgoWebhookClient
from infrastructure.http import HttpClient
from infrastructure.storage import S3Storage
from infrastructure.storage.paths import drift_run_prefix, version_prefix


class _ArgoBackend:
    setting_name = ""

    def __init__(self, client=None, storage=None):
        self.client = client or ArgoWebhookClient()
        self.storage = storage or S3Storage()

    def trigger(self, payload):
        response = self.client.trigger(getattr(settings, self.setting_name), payload)
        return {"dispatched": True, "response": response}


class ArgoBuildBackend(_ArgoBackend):
    setting_name = "ARGO_BUILD_WEBHOOK_URL"

    def run(self, build):
        version = build.version
        project = version.project
        source = version.artifacts.filter(kind__in=("source", "training_output")).first()
        if not source:
            raise RuntimeError("The model version has no buildable source artifact.")
        package_uri = (
            f"s3://{self.storage.bucket}/"
            f"{version_prefix(project.owner.tenant_id, project.public_id, version.public_id)}"
            "/artifacts/model-package.zip"
        )
        build.package_uri = package_uri
        build.save(update_fields=["package_uri", "updated_at"])
        return self.trigger(
            {
                "build_id": str(build.public_id),
                "version_id": str(version.public_id),
                "tenant_id": project.owner.tenant_id,
                "flavor": version.flavor,
                "requirements_text": version.requirements_snapshot,
                "source_artifact_name": source.name,
                "source_download_url": self.storage.presigned_get(source.uri, 14400),
                "output_upload_url": self.storage.presigned_put(package_uri, 14400),
                "control_plane_webhook_url": (
                    f"{settings.CONTROL_PLANE_INTERNAL_URL}/internal/webhooks/builds/{build.public_id}/"
                ),
            }
        )

    def cancel(self, build):
        return None


class ArgoTrainingBackend(_ArgoBackend):
    setting_name = "ARGO_TRAINING_WEBHOOK_URL"

    def run(self, job):
        runtime_name = f"training-{str(job.public_id).lower()}"
        job.external_job_id = runtime_name
        job.save(update_fields=["external_job_id", "updated_at"])
        return self.trigger(
            {
                "job_id": str(job.public_id),
                "project_id": str(job.project.public_id),
                "tenant_id": job.project.owner.tenant_id,
                "job_name": runtime_name,
                "namespace": "default",
                "vcpu": job.vcpu,
                "memory": job.memory_mb,
                "accelerator_type": job.accelerator_type,
                "accelerator_count": job.accelerator_count,
                "s3_source_uri": self.storage.presigned_get(job.code_snapshot_uri, 14400),
                "s3_training_data_uri": self.storage.presigned_get(job.data_snapshot_uri, 14400),
                "s3_output_uri": self.storage.presigned_put(job.output_uri, 14400),
                "entry_point": job.entry_point,
                "model_version": "",
                "requirements_text": job.requirements_text,
                "mlflow_tracking_uri": settings.MLFLOW_TRACKING_URI,
                "mlflow_experiment_name": f"project-{job.project.public_id}-job-{job.public_id}",
                "mlflow_artifact_root": job.mlflow_artifact_uri,
                "control_plane_webhook_url": (
                    f"{settings.CONTROL_PLANE_INTERNAL_URL}/internal/webhooks/training-jobs/{job.public_id}/"
                ),
            }
        )

    def cancel(self, job):
        if settings.ARGO_CANCEL_TRAINING_WEBHOOK_URL:
            return self.client.trigger(
                settings.ARGO_CANCEL_TRAINING_WEBHOOK_URL,
                {"job_name": job.external_job_id or f"training-{str(job.public_id).lower()}", "namespace": "default"},
            )
        return None


class ArgoDeploymentBackend(_ArgoBackend):
    setting_name = "ARGO_DEPLOY_WEBHOOK_URL"

    def __init__(self, client=None, storage=None, http=None):
        super().__init__(client=client, storage=storage)
        self.http = http or HttpClient(timeout=(3.05, 10))

    def deploy(self, deployment):
        version = deployment.version
        project = version.project
        container_name = f"endpoint-{str(deployment.public_id).lower()}"
        target_port = 3000 if project.model_type == "dl" else 5001
        self.trigger(
            {
                "deployment_id": str(deployment.public_id),
                "tenant_id": project.owner.tenant_id,
                "project_id": str(project.public_id),
                "version_id": str(version.public_id),
                "model_id": str(version.public_id),
                "version": version.version,
                "image_uri": deployment.build.image_uri,
                "image_name": deployment.build.image_uri,
                "container_name": container_name,
                "model_type": project.model_type,
                "target_port": str(target_port),
                "model_uri": next(
                    (
                        artifact.uri
                        for artifact in version.artifacts.all()
                        if artifact.kind in {"source", "training_output"}
                    ),
                    "",
                ),
            }
        )
        public_url = (
            f"{settings.MODEL_SERVER_PUBLIC_URL}/{project.owner.tenant_id}/models/"
            f"{project.public_id}/{version.public_id}"
        )
        return Endpoint.objects.update_or_create(
            deployment=deployment,
            defaults={
                "public_url": public_url,
                "internal_url": f"http://{container_name}-svc:{target_port}",
                "runtime_name": container_name,
                "runtime_namespace": "default",
                "health_status": "unknown",
            },
        )[0]

    def stop(self, deployment):
        endpoint = getattr(deployment, "endpoint", None)
        if endpoint and settings.ARGO_DELETE_WEBHOOK_URL:
            return self.client.trigger(settings.ARGO_DELETE_WEBHOOK_URL, {"container_name": endpoint.runtime_name})
        return None

    def health(self, deployment):
        endpoint = getattr(deployment, "endpoint", None)
        if not endpoint or not endpoint.internal_url:
            return False, {"status": "missing"}
        try:
            response = self.http.request("GET", f"{endpoint.internal_url}/health")
            payload = response.json()
            return bool(payload.get("model_loaded", True)), payload
        except Exception as exc:
            return False, {"status": "unhealthy", "detail": str(exc)}

    def logs(self, deployment):
        endpoint = getattr(deployment, "endpoint", None)
        return str(endpoint.metadata.get("logs", "")) if endpoint else ""


class ArgoDriftBackend(_ArgoBackend):
    setting_name = "ARGO_DRIFT_WEBHOOK_URL"

    def run(self, drift_run):
        monitor = drift_run.monitor
        project = monitor.version.project
        prefix = drift_run_prefix(
            project.owner.tenant_id,
            project.public_id,
            monitor.public_id,
            drift_run.public_id,
        )
        uris = {
            name: f"s3://{self.storage.bucket}/{prefix}{name}"
            for name in ("report.html", "report.json", "summary.json")
        }
        return self.trigger(
            {
                "job_id": str(drift_run.public_id),
                "monitor_id": str(monitor.public_id),
                "tenant_id": project.owner.tenant_id,
                "model_id": str(monitor.version.public_id),
                "model_name": project.name,
                "model_uri": "",
                "reference_data_url": self.storage.presigned_get(monitor.reference_asset.s3_uri, 7200),
                "html_s3_uri": uris["report.html"],
                "report_json_s3_uri": uris["report.json"],
                "summary_json_s3_uri": uris["summary.json"],
                "html_public_url": "",
                "html_upload_url": self.storage.presigned_put(uris["report.html"], 7200, "text/html"),
                "report_json_upload_url": self.storage.presigned_put(uris["report.json"], 7200, "application/json"),
                "summary_json_upload_url": self.storage.presigned_put(uris["summary.json"], 7200, "application/json"),
                "control_plane_webhook_url": (
                    f"{settings.CONTROL_PLANE_INTERNAL_URL}/internal/webhooks/drift-runs/{drift_run.public_id}/"
                ),
            }
        )
