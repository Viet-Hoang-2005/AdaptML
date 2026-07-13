import base64
import os
import time

import docker
from django.conf import settings
from django.utils import timezone

from infrastructure.docker import DockerClient
from infrastructure.http import HttpClient
from infrastructure.storage import S3Storage
from infrastructure.storage.paths import drift_run_prefix, version_prefix


def _wait_and_cleanup(container):
    result = container.wait()
    logs = container.logs(stdout=True, stderr=True).decode("utf-8", errors="replace")
    if result.get("StatusCode") == 0:
        try:
            container.remove()
        except docker.errors.NotFound:
            pass
    return result.get("StatusCode", 1), logs


class DockerBuildBackend:
    def __init__(self, docker_client=None, storage=None):
        self.docker = docker_client or DockerClient()
        self.storage = storage or S3Storage()

    def run(self, build):
        version = build.version
        project = version.project
        source = version.artifacts.filter(kind__in=("source", "training_output")).order_by("-created_at").first()
        if not source:
            raise RuntimeError("The model version has no buildable source artifact.")
        package_root = version_prefix(
            project.owner.tenant_id,
            project.public_id,
            version.public_id,
        )
        package_uri = f"s3://{self.storage.bucket}/{package_root}/artifacts/model-package.zip"
        build.package_uri = package_uri
        build.save(update_fields=["package_uri", "updated_at"])
        webhook = f"{settings.CONTROL_PLANE_INTERNAL_URL}/internal/webhooks/builds/{build.public_id}/"
        environment = {
            "TASK_TYPE": "BUILD",
            "TENANT_ID": project.owner.tenant_id,
            "MODEL_ID": str(version.public_id),
            "FLAVOR": version.flavor,
            "REQUIREMENTS_TEXT": version.requirements_snapshot,
            "SOURCE_ARTIFACT_NAME": source.name,
            "SOURCE_DOWNLOAD_URL": self.storage.presigned_get(source.uri, 14400),
            "OUTPUT_UPLOAD_URL": self.storage.presigned_put(package_uri, 14400),
            "CONTROL_PLANE_WEBHOOK_URL": webhook,
            "CONTROL_PLANE_WEBHOOK_SECRET": settings.CONTROL_PLANE_WEBHOOK_SECRET,
            "HARBOR_REGISTRY_URL": settings.HARBOR_REGISTRY_URL,
            "HARBOR_USER_PROJECT": settings.HARBOR_USER_PROJECT,
            "HARBOR_USERNAME": settings.HARBOR_USERNAME,
            "HARBOR_PASSWORD": settings.HARBOR_PASSWORD,
            "REDIS_URL": settings.REDIS_URL,
        }
        container = self.docker.run(
            image="mlops-paas-model-packager",
            name=f"build-{build.public_id}",
            environment=environment,
            network=settings.DOCKER_NETWORK_NAME,
            volumes={"/var/run/docker.sock": {"bind": "/var/run/docker.sock", "mode": "rw"}},
        )
        build.external_build_id = container.id
        build.save(update_fields=["external_build_id", "updated_at"])
        status_code, logs = _wait_and_cleanup(container)
        if status_code:
            raise RuntimeError(logs[-12000:])
        return logs

    def cancel(self, build):
        if build.external_build_id:
            try:
                self.docker.client.containers.get(build.external_build_id).kill()
            except docker.errors.NotFound:
                pass


class DockerTrainingBackend:
    def __init__(self, docker_client=None, storage=None):
        self.docker = docker_client or DockerClient()
        self.storage = storage or S3Storage()

    def run(self, job):
        project = job.project
        from apps.training.services.capabilities import issue_capability
        from apps.training.services.storage_scope import validate_training_uri

        validate_training_uri(job, self.storage.bucket, "code", job.code_snapshot_uri)
        validate_training_uri(job, self.storage.bucket, "data", job.data_snapshot_uri)
        validate_training_uri(job, self.storage.bucket, "output", job.output_uri)
        output_upload_capability = issue_capability(job, "output_upload")
        environment = {
            "S3_SOURCE_URI": self.storage.presigned_get(
                job.code_snapshot_uri, settings.TRAINING_PRESIGNED_URL_TTL_SECONDS
            ),
            "S3_TRAINING_DATA_URI": self.storage.presigned_get(
                job.data_snapshot_uri, settings.TRAINING_PRESIGNED_URL_TTL_SECONDS
            ),
            "S3_OUTPUT_UPLOAD_URL": (
                f"{settings.CONTROL_PLANE_INTERNAL_URL}/internal/training-jobs/{job.public_id}/output-upload-url/"
            ),
            "S3_OUTPUT_UPLOAD_CAPABILITY": output_upload_capability,
            "ENTRY_POINT": job.entry_point,
            "MODEL_VERSION": "",
            "TRAINING_JOB_ID": str(job.public_id),
            "TENANT_ID": project.owner.tenant_id,
            "REQUIREMENTS_TEXT": base64.b64encode(job.requirements_text.encode()).decode()
            if job.requirements_text
            else "",
        }
        container = self.docker.run(
            image="mlops-paas-training-runner:latest",
            name=f"training-{job.public_id}",
            environment=environment,
            network=settings.DOCKER_NETWORK_NAME,
        )
        job.external_job_id = container.id
        job.save(update_fields=["external_job_id", "updated_at"])
        status_code, logs = _wait_and_cleanup(container)
        if status_code:
            raise RuntimeError(logs[-12000:])
        return logs

    def cancel(self, job):
        if job.external_job_id:
            try:
                self.docker.client.containers.get(job.external_job_id).kill()
            except docker.errors.NotFound:
                pass


class DockerDeploymentBackend:
    def __init__(self, docker_client=None, http=None, log_sink=None):
        self.docker = docker_client or DockerClient()
        self.http = http or HttpClient(timeout=(3.05, 10))
        self.log_sink = log_sink

    def _log(self, message):
        if self.log_sink:
            self.log_sink(message)

    def deploy(self, deployment):
        from apps.deployment.models import Endpoint

        project = deployment.version.project
        image = (
            deployment.build.image_uri
            or f"{project.owner.tenant_id.lower()}-model-{deployment.version.public_id}:latest"
        )
        container_name = f"endpoint-{deployment.public_id}"
        internal_url = f"http://{container_name}:5001"
        public_path = f"/{project.owner.tenant_id}/models/{project.public_id}/{deployment.version.public_id}"
        public_url = f"{settings.MODEL_SERVER_PUBLIC_URL}{public_path}"
        labels = {"traefik.enable": "false"}
        self._log(f"Creating runtime container {container_name}.")
        container = self.docker.run(
            image=image,
            name=container_name,
            environment={"MODEL_ID": str(deployment.version.public_id), "MODEL_VERSION": deployment.version.version},
            labels=labels,
            network=settings.DOCKER_NETWORK_NAME,
            restart_policy={"Name": "always"},
        )
        deployment.external_deployment_id = container.id
        deployment.save(update_fields=["external_deployment_id", "updated_at"])
        endpoint, _ = Endpoint.objects.update_or_create(
            deployment=deployment,
            defaults={
                "public_url": public_url,
                "internal_url": internal_url,
                "runtime_name": container_name,
                "health_status": "unknown",
            },
        )
        self._log("Runtime container created; waiting for model worker health endpoint.")
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            healthy, _ = self.health(deployment)
            if healthy:
                self._log("Model worker health endpoint responded successfully.")
                endpoint.health_status = "healthy"
                endpoint.last_checked_at = timezone.now()
                endpoint.save(update_fields=["health_status", "last_checked_at", "updated_at"])
                return endpoint
            self._log("Model worker is not healthy yet; checking again in 5 seconds.")
            time.sleep(5)
        raise RuntimeError("Endpoint did not become healthy before timeout.")

    def stop(self, deployment):
        if deployment.external_deployment_id:
            try:
                self.docker.client.containers.get(deployment.external_deployment_id).remove(force=True)
            except docker.errors.NotFound:
                pass

    def health(self, deployment):
        endpoint = getattr(deployment, "endpoint", None)
        if not endpoint:
            return False, {"status": "missing"}
        try:
            response = self.http.request("GET", f"{endpoint.internal_url}/health")
            payload = response.json()
            return bool(payload.get("model_loaded", True)), payload
        except Exception as exc:
            return False, {"status": "unhealthy", "detail": str(exc)}

    def logs(self, deployment):
        if not deployment.external_deployment_id:
            return ""
        try:
            container = self.docker.client.containers.get(deployment.external_deployment_id)
            return container.logs(stdout=True, stderr=True, tail=2000).decode("utf-8", errors="replace")
        except docker.errors.NotFound:
            return ""


class DockerDriftBackend:
    def __init__(self, docker_client=None, storage=None):
        self.docker = docker_client or DockerClient()
        self.storage = storage or S3Storage()

    def run(self, drift_run):
        monitor = drift_run.monitor
        project = monitor.version.project
        prefix = drift_run_prefix(project.owner.tenant_id, project.public_id, monitor.public_id, drift_run.public_id)
        uris = {
            name: f"s3://{self.storage.bucket}/{prefix}{name}"
            for name in ("report.html", "report.json", "summary.json")
        }
        source = monitor.version.artifacts.filter(kind__in=("source", "training_output")).first()
        environment = {
            "JOB_ID": str(drift_run.public_id),
            "TENANT_ID": project.owner.tenant_id,
            "MODEL_ID": str(monitor.version.public_id),
            "MODEL_NAME": project.name,
            "MODEL_URI": source.uri if source else "",
            "REFERENCE_DATA_URL": self.storage.presigned_get(monitor.reference_asset.s3_uri, 7200),
            "HTML_S3_URI": uris["report.html"],
            "REPORT_JSON_S3_URI": uris["report.json"],
            "SUMMARY_JSON_S3_URI": uris["summary.json"],
            "HTML_UPLOAD_URL": self.storage.presigned_put(uris["report.html"], 7200, "text/html"),
            "REPORT_JSON_UPLOAD_URL": self.storage.presigned_put(uris["report.json"], 7200, "application/json"),
            "SUMMARY_JSON_UPLOAD_URL": self.storage.presigned_put(uris["summary.json"], 7200, "application/json"),
            "CONTROL_PLANE_WEBHOOK_URL": (
                f"{settings.CONTROL_PLANE_INTERNAL_URL}/internal/webhooks/" f"drift-runs/{drift_run.public_id}/"
            ),
            "CONTROL_PLANE_WEBHOOK_SECRET": settings.CONTROL_PLANE_WEBHOOK_SECRET,
            "DRIFT_RUN_ID": str(drift_run.public_id),
            "REDIS_URL": settings.REDIS_URL,
            "DB_HOST_RO": os.environ.get("DB_HOST_RO", "postgres"),
            "DB_USER": os.environ.get("DB_USER", "postgres"),
            "DB_PASSWORD": os.environ.get("DB_PASSWORD", ""),
            "DB_NAME": os.environ.get("DB_NAME", "mlops_paas_db"),
            "DB_PORT": os.environ.get("DB_PORT", "5432"),
        }
        container = self.docker.run(
            image="mlops-paas-evidently",
            name=f"drift-{drift_run.public_id}",
            environment=environment,
            network=settings.DOCKER_NETWORK_NAME,
        )
        drift_run.external_run_id = container.id
        drift_run.report_html_uri = uris["report.html"]
        drift_run.report_json_uri = uris["report.json"]
        drift_run.summary_uri = uris["summary.json"]
        drift_run.save(update_fields=["external_run_id", "report_html_uri", "report_json_uri", "summary_uri"])
        status_code, logs = _wait_and_cleanup(container)
        if status_code:
            raise RuntimeError(logs[-12000:])
        return logs
