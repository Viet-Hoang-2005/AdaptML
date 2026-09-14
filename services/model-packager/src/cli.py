import json
import logging
import os
import yaml
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile
import docker
import redis
import requests
import mlflow.pyfunc

from src.logging_utils import RuntimeLog, bind_context, configure, get_logger, log_event, reset_context, sanitize

from pathlib import Path
from src.core import build_preview_tree, load_model, make_zip, parse_requirements, save_mlflow_model

logger = get_logger("model-packager")
runtime_log = RuntimeLog(logger)

SUPPORTED_MODEL_EXTENSIONS = {".pkl", ".joblib", ".xgb"}
PREFERRED_MODEL_FILENAMES = ("model.pkl", "model.joblib", "model.xgb")

class RedisLogHandler(logging.Handler):
    def __init__(self, redis_url: str, build_id: str):
        super().__init__()
        self.redis_client = redis.from_url(redis_url)
        self.log_key = f"build_logs:{build_id}"
        self.redis_client.delete(self.log_key)

    def write(self, message: str) -> bool:
        try:
            self.redis_client.rpush(self.log_key, sanitize(message))
            self.redis_client.expire(self.log_key, 3600)
            return True
        except Exception:
            # RuntimeLog emits a sanitized container fallback on delivery failure.
            return False

    def emit(self, record):
        try:
            self.write(self.format(record))
        except Exception:
            # Never use handleError: it dumps the unsanitized record to stderr.
            pass

def download_presigned_file(download_url: str, destination: Path) -> None:
    if not download_url:
        raise ValueError("Missing presigned download URL.")

    runtime_log.detail(f"Downloading artifact to {destination.name}...")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(download_url, stream=True, timeout=(10, 600)) as response:
        response.raise_for_status()
        with destination.open("wb") as destination_file:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    destination_file.write(chunk)
    runtime_log.detail("Download completed.")


def upload_presigned_file(upload_url: str, source: Path) -> None:
    if not upload_url:
        raise ValueError("Missing presigned upload URL.")

    runtime_log.detail(f"Uploading {source.name}...")
    with source.open("rb") as source_file:
        response = requests.put(upload_url, data=source_file, timeout=(10, 600))
    response.raise_for_status()
    runtime_log.detail("Upload completed.")

def safe_extract_tar(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    destination_root = destination.resolve()
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            resolved = (destination / member.name).resolve()
            if not resolved.is_relative_to(destination_root):
                raise ValueError("Training artifact contains an unsafe path.")
            if member.islnk() or member.issym():
                raise ValueError("Training artifact contains links, which are not supported.")
        archive.extractall(destination)

def safe_extract_zip(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    destination_root = destination.resolve()
    with zipfile.ZipFile(archive_path, "r") as archive:
        for member in archive.infolist():
            resolved = (destination / member.filename).resolve()
            if not resolved.is_relative_to(destination_root):
                raise ValueError("Model package contains an unsafe path.")
        archive.extractall(destination)

def find_supported_model_file(root: Path) -> Path:
    files = [item for item in root.rglob("*") if item.is_file() and item.suffix.lower() in SUPPORTED_MODEL_EXTENSIONS]
    if not files:
        raise ValueError("Training artifact is not deployable because no .pkl, .joblib, or .xgb file was found.")

    by_name = {item.name: item for item in sorted(files)}
    for preferred in PREFERRED_MODEL_FILENAMES:
        if preferred in by_name:
            if len(files) > 1:
                runtime_log.event(logging.WARNING, "multiple_model_files", f"Warning: multiple model files found; using {preferred}.")
            return by_name[preferred]

    selected = sorted(files, key=lambda item: item.as_posix())[0]
    if len(files) > 1:
        runtime_log.event(logging.WARNING, "multiple_model_files", f"Warning: multiple model files found; using {selected.relative_to(root).as_posix()}.")
    return selected

def find_label_mapping_file(root: Path) -> Path | None:
    candidates = []
    for item in root.rglob("*"):
        if not item.is_file() or item.suffix.lower() not in {".json", ".pkl"}:
            continue
        lowered = item.name.lower()
        if "mapping" in lowered or "label" in lowered or "dictionary" in lowered:
            candidates.append(item)
    return sorted(candidates, key=lambda item: item.as_posix())[0] if candidates else None

def webhook_headers() -> dict[str, str]:
    secret = os.environ.get("CONTROL_PLANE_WEBHOOK_SECRET", "").strip()
    return {"X-Control-Plane-Secret": secret} if secret else {}

def post_webhook(webhook_url: str, payload: dict) -> None:
    if not webhook_url:
        return
    response = requests.post(webhook_url, json=payload, headers=webhook_headers(), timeout=10)
    if response.status_code >= 400:
        raise RuntimeError(f"Build webhook failed with HTTP {response.status_code}")


def configured_image_reference(build_id: str = "") -> str:
    build_id = os.environ.get("BUILD_ID", "").strip().lower() or build_id.lower()
    project_id = os.environ.get("PROJECT_ID", "").strip().lower() or build_id
    repository = os.environ.get("IMAGE_REPOSITORY", "").strip().rstrip("/")
    tag = os.environ.get("IMAGE_TAG", "").strip() or f"build-{build_id}"
    if not repository:
        repository = f"image-{project_id}"
        harbor_url = os.environ.get("HARBOR_REGISTRY_URL", "").strip().rstrip("/")
        harbor_project = os.environ.get("HARBOR_USER_PROJECT", "user-images").strip().strip("/")
        if harbor_url:
            repository = f"{harbor_url}/{harbor_project}/{repository}"
    return f"{repository}:{tag}"


def built_image_metadata() -> dict[str, str]:
    image_uri = configured_image_reference()
    try:
        image = docker.from_env().images.get(image_uri)
        repo_digests = image.attrs.get("RepoDigests") or []
        digest = repo_digests[0].split("@", 1)[1] if repo_digests else image.attrs.get("Id", "")
    except Exception:
        digest = ""
    return {"image_uri": image_uri, "image_digest": digest}

def build_custom_image(workspace: Path, build_id: str, tenant_id: str, requirements_text: str) -> None:
    docker_client = docker.from_env()
    harbor_url = os.environ.get("HARBOR_REGISTRY_URL", "").strip().rstrip("/")
    harbor_user = os.environ.get("HARBOR_USERNAME", "").strip()
    harbor_pass = os.environ.get("HARBOR_PASSWORD", "").strip()

    # Login to Harbor first so the FROM base image can be pulled
    if harbor_url and harbor_user and harbor_pass:
        runtime_log.detail(f"Logging into Harbor registry at {harbor_url}...")
        docker_client.login(username=harbor_user, password=harbor_pass, registry=harbor_url)

    # Use fully-qualified base image so Docker can pull it from Harbor
    base_image = f"{harbor_url}/mlops-paas/machine-learning-serving:latest" if harbor_url else "mlops-paas-machine-learning-serving:latest"
    dockerfile_content = f"""FROM {base_image}
USER root
COPY requirements.txt /tmp/custom_requirements.txt
RUN grep -i -v -E '^(fastapi|uvicorn|starlette|pydantic|bentoml|httpx)([[:space:]=<>~!]*)?$' /tmp/custom_requirements.txt > /tmp/safe_requirements.txt || touch /tmp/safe_requirements.txt
RUN pip install --no-cache-dir -r /tmp/safe_requirements.txt || echo 'Some requirements failed to install, continuing...'
COPY model /app/model_artifact
"""
    (workspace / "Dockerfile").write_text(dockerfile_content, encoding="utf-8")
    (workspace / "requirements.txt").write_text((requirements_text.strip() + "\n") if requirements_text.strip() else "\n", encoding="utf-8")

    image_tag = configured_image_reference(build_id)

    runtime_log.detail(f"Building Docker image {image_tag} from workspace {workspace}...")
    for line in docker_client.api.build(path=str(workspace), tag=image_tag, rm=True, decode=True):
        if "stream" in line:
            runtime_log.detail(line["stream"].strip())
        elif "errorDetail" in line:
            raise RuntimeError(line["errorDetail"].get("message", "Unknown Docker build error"))
    runtime_log.detail(f"Docker image {image_tag} built successfully!")

    if harbor_url and harbor_user and harbor_pass and image_tag.startswith(f"{harbor_url}/"):
        runtime_log.detail(f"Pushing image {image_tag} to Harbor...")
        for line in docker_client.images.push(image_tag, stream=True, decode=True):
            if "status" in line:
                runtime_log.detail(line.get("status", ""))
            elif "errorDetail" in line:
                raise RuntimeError(line["errorDetail"].get("message", "Failed to push image to Harbor"))
        runtime_log.detail("Image successfully pushed to Harbor!")

def build_bento_image(workspace: Path, build_id: str, tenant_id: str, requirements_text: str) -> None:
    docker_client = docker.from_env()
    harbor_url = os.environ.get("HARBOR_REGISTRY_URL", "").strip().rstrip("/")
    harbor_user = os.environ.get("HARBOR_USERNAME", "").strip()
    harbor_pass = os.environ.get("HARBOR_PASSWORD", "").strip()

    if harbor_url and harbor_user and harbor_pass:
        runtime_log.detail(f"Logging into Harbor registry at {harbor_url}...")
        docker_client.login(username=harbor_user, password=harbor_pass, registry=harbor_url)

    base_image = f"{harbor_url}/mlops-paas/deep-learning-serving:latest" if harbor_url else "mlops-paas-deep-learning-serving:latest"
    dockerfile_content = f"""FROM {base_image}
USER root
COPY requirements.txt /tmp/custom_requirements.txt
RUN grep -i -v -E '^(fastapi|uvicorn|starlette|pydantic|bentoml|httpx)([[:space:]=<>~!]*)?$' /tmp/custom_requirements.txt > /tmp/safe_requirements.txt || touch /tmp/safe_requirements.txt
RUN pip install --no-cache-dir -r /tmp/safe_requirements.txt || echo 'Some requirements failed to install, continuing...'
COPY model /app/model_artifact
"""
    (workspace / "Dockerfile").write_text(dockerfile_content, encoding="utf-8")
    (workspace / "requirements.txt").write_text((requirements_text.strip() + "\n") if requirements_text.strip() else "\n", encoding="utf-8")

    image_tag = configured_image_reference(build_id)

    runtime_log.detail(f"Building BentoML Docker image {image_tag} from workspace {workspace}...")
    for line in docker_client.api.build(path=str(workspace), tag=image_tag, rm=True, decode=True):
        if "stream" in line:
            runtime_log.detail(line["stream"].strip())
        elif "errorDetail" in line:
            raise RuntimeError(line["errorDetail"].get("message", "Unknown Docker build error"))
    runtime_log.detail(f"BentoML Docker image {image_tag} built successfully!")

    if harbor_url and harbor_user and harbor_pass and image_tag.startswith(f"{harbor_url}/"):
        runtime_log.detail(f"Pushing BentoML image {image_tag} to Harbor...")
        for line in docker_client.images.push(image_tag, stream=True, decode=True):
            if "status" in line:
                runtime_log.detail(line.get("status", ""))
            elif "errorDetail" in line:
                raise RuntimeError(line["errorDetail"].get("message", "Failed to push image to Harbor"))
        runtime_log.detail("BentoML image successfully pushed to Harbor!")


def parse_conda_pip_requirements(conda_file: Path) -> list[str]:
    with conda_file.open("r", encoding="utf-8") as handle:
        conda_env = yaml.safe_load(handle) or {}

    pip_requirements = []
    for dep in conda_env.get("dependencies", []):
        if isinstance(dep, dict) and "pip" in dep:
            pip_requirements.extend(dep["pip"])
    return pip_requirements


def read_training_summaries(extracted_dir: Path) -> tuple[dict[str, dict], Path | None]:
    mlops_dir = next((path for path in sorted(extracted_dir.rglob("_mlops")) if path.is_dir()), None)
    summaries = {"metrics_summary": {}, "params_summary": {}, "insights_summary": {}}
    if mlops_dir is None:
        return summaries, None
    for filename, key in (
        ("metrics.json", "metrics_summary"),
        ("params.json", "params_summary"),
        ("model_insights.json", "insights_summary"),
    ):
        path = mlops_dir / filename
        if not path.exists():
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            runtime_log.event(logging.WARNING, "training_metadata_invalid", f"Ignoring invalid training metadata file: {filename}")
            continue
        if isinstance(value, dict):
            summaries[key] = value
    return summaries, mlops_dir

def run_build_task(build_id: str, webhook_url: str) -> None:
    flavor = os.environ.get("FLAVOR", "").lower()
    requirements_text = os.environ.get("REQUIREMENTS_TEXT", "")
    source_download_url = os.environ.get("SOURCE_DOWNLOAD_URL", "")
    source_artifact_name = os.environ.get("SOURCE_ARTIFACT_NAME", "")
    source_type = os.environ.get("SOURCE_TYPE", "manual_upload")
    output_upload_url = os.environ.get("OUTPUT_UPLOAD_URL", "")
    label_mapping_download_url = os.environ.get("LABEL_MAPPING_DOWNLOAD_URL", "")
    label_mapping_filename = os.environ.get("LABEL_MAPPING_FILENAME", "")
    tenant_id = os.environ.get("TENANT_ID", "unknown")

    if source_type == "training_job":
        if not all([flavor, source_download_url, output_upload_url]):
            raise ValueError("Missing presigned URLs for training artifact build.")
    elif not all([flavor, source_download_url, source_artifact_name, output_upload_url]):
        raise ValueError("Missing required environment variables for build.")

    workspace_dir = os.environ.get("BUILD_WORKSPACE_DIR")
    if workspace_dir:
        workspace = Path(workspace_dir)
        workspace.mkdir(parents=True, exist_ok=True)
        runtime_log.detail(f"Using shared workspace directory: {workspace}")
    else:
        workspace = Path(tempfile.mkdtemp(prefix=f"build-{build_id}-"))
    try:
        artifact_name = ""
        extracted_label_mapping_path = None
        training_summaries = {"metrics_summary": {}, "params_summary": {}, "insights_summary": {}}
        extracted_mlops_dir = None

        if source_type == "training_job":
            training_archive_path = workspace / "training-model.tar.gz"
            extracted_dir = workspace / "training-artifact"
            download_presigned_file(source_download_url, training_archive_path)
            runtime_log.detail("Extracting training artifact safely...")
            safe_extract_tar(training_archive_path, extracted_dir)
            artifact_path = find_supported_model_file(extracted_dir)
            artifact_name = artifact_path.name
            training_summaries, extracted_mlops_dir = read_training_summaries(extracted_dir)

            if not requirements_text.strip():
                requirements_file = next(iter(sorted(extracted_dir.rglob("requirements.txt"))), None)
                if requirements_file:
                    requirements_text = requirements_file.read_text(encoding="utf-8").strip()
                    runtime_log.detail("Using requirements.txt from training artifact.")

            extracted_label_mapping_path = find_label_mapping_file(extracted_dir)
            if extracted_label_mapping_path:
                runtime_log.detail(f"Using label mapping from training artifact: {extracted_label_mapping_path.name}")
        else:
            artifact_name = Path(source_artifact_name).name
            artifact_path = workspace / artifact_name
            download_presigned_file(source_download_url, artifact_path)

        runtime_log.detail(f"Loading {flavor} model...")
        model = load_model(artifact_path, flavor)
        package_name = "model"
        package_dir = workspace / package_name
        requirements = parse_requirements(requirements_text)

        runtime_log.detail("Saving MLflow model format...")
        save_mlflow_model(model, flavor, package_dir, requirements)

        if requirements_text.strip():
            (package_dir / "requirements.txt").write_text(requirements_text.strip() + "\n", encoding="utf-8")

        if label_mapping_download_url:
            mapping_path = package_dir / Path(label_mapping_filename or "label-mapping.json").name
            download_presigned_file(label_mapping_download_url, mapping_path)
        elif extracted_label_mapping_path:
            shutil.copy2(extracted_label_mapping_path, package_dir / extracted_label_mapping_path.name)
        if extracted_mlops_dir:
            shutil.copytree(extracted_mlops_dir, package_dir / "_mlops", dirs_exist_ok=True)

        preview_tree = build_preview_tree(package_dir)
        manifest = {
            "flavor": flavor,
            "source_type": source_type,
            "source_artifact": artifact_name,
            "package_root": package_name,
            "requirements_count": len(requirements or []),
        }

        zip_path = workspace / "model-package.zip"
        runtime_log.detail("Compressing package to zip...")
        make_zip(package_dir, zip_path)

        upload_presigned_file(output_upload_url, zip_path)

        if os.environ.get("BUILD_ENGINE", "").lower() == "kaniko":
            runtime_log.detail("Kaniko build engine detected. Preparing build context without Docker daemon...")
            harbor_url = os.environ.get("HARBOR_REGISTRY_URL", "").strip().rstrip("/")
            if flavor in ["pytorch", "tensorflow", "keras"]:
                runtime_log.detail("Detected Deep Learning flavor. Generating BentoML Dockerfile...")
                base_image = f"{harbor_url}/mlops-paas/deep-learning-serving:latest" if harbor_url else "mlops-paas-deep-learning-serving:latest"
                dockerfile_content = f"""FROM {base_image}
USER root
COPY requirements.txt /tmp/custom_requirements.txt
RUN grep -i -v -E '^(fastapi|uvicorn|starlette|pydantic|bentoml|httpx)([[:space:]=<>~!]*)?$' /tmp/custom_requirements.txt > /tmp/safe_requirements.txt || touch /tmp/safe_requirements.txt
RUN pip install --no-cache-dir -r /tmp/safe_requirements.txt || echo 'Some requirements failed to install, continuing...'
COPY model /app/model_artifact
"""
            else:
                runtime_log.detail("Generating custom lightweight Dockerfile...")
                base_image = f"{harbor_url}/mlops-paas/machine-learning-serving:latest" if harbor_url else "mlops-paas-machine-learning-serving:latest"
                dockerfile_content = f"""FROM {base_image}
USER root
COPY requirements.txt /tmp/custom_requirements.txt
RUN grep -i -v -E '^(fastapi|uvicorn|starlette|pydantic|bentoml|httpx)([[:space:]=<>~!]*)?$' /tmp/custom_requirements.txt > /tmp/safe_requirements.txt || touch /tmp/safe_requirements.txt
RUN pip install --no-cache-dir -r /tmp/safe_requirements.txt || echo 'Some requirements failed to install, continuing...'
COPY model /app/model_artifact
"""
            (workspace / "Dockerfile").write_text(dockerfile_content, encoding="utf-8")
            (workspace / "requirements.txt").write_text((requirements_text.strip() + "\n") if requirements_text.strip() else "\n", encoding="utf-8")
            
            payload = {
                "build_id": build_id,
                "status": "success",
                "package_manifest": manifest,
                "package_preview_tree": preview_tree,
                "task_type": "BUILD",
                **training_summaries,
            }
            (workspace / "webhook_payload.json").write_text(json.dumps(payload), encoding="utf-8")
            runtime_log.protocol("Build context prepared successfully for Kaniko! BUILD_PREPARE_SUCCESS")
            return
        elif flavor in ["pytorch", "tensorflow", "keras"]:
            runtime_log.detail("Detected Deep Learning flavor. Building BentoML container image...")
            build_bento_image(workspace, build_id, tenant_id, requirements_text)
        else:
            runtime_log.detail("Building custom lightweight Docker image...")
            build_custom_image(workspace, build_id, tenant_id, requirements_text)
        runtime_log.detail("Build completed successfully!")

        post_webhook(
            webhook_url,
            {
                "build_id": build_id,
                "status": "success",
                "package_manifest": manifest,
                "package_preview_tree": preview_tree,
                "task_type": "BUILD",
                **training_summaries,
                **built_image_metadata(),
            },
        )
        runtime_log.protocol("BUILD_EOF_SUCCESS")
    finally:
        if not os.environ.get("BUILD_WORKSPACE_DIR"):
            shutil.rmtree(workspace, ignore_errors=True)

def run_test_zip_task(build_id: str, webhook_url: str) -> None:
    source_download_url = os.environ.get("SOURCE_DOWNLOAD_URL", "")
    source_artifact_name = os.environ.get("SOURCE_ARTIFACT_NAME", "")
    flavor = os.environ.get("FLAVOR", "").lower()
    tenant_id = os.environ.get("TENANT_ID", "unknown")
    if not all([source_download_url, source_artifact_name]):
        raise ValueError("Missing presigned download URL for test.")

    workspace_dir = os.environ.get("BUILD_WORKSPACE_DIR")
    if workspace_dir:
        workspace = Path(workspace_dir)
        workspace.mkdir(parents=True, exist_ok=True)
        runtime_log.detail(f"Using shared workspace directory: {workspace}")
    else:
        workspace = Path(tempfile.mkdtemp(prefix=f"test-{build_id}-"))
    try:
        artifact_name = Path(source_artifact_name).name
        zip_path = workspace / artifact_name

        download_presigned_file(source_download_url, zip_path)

        extract_dir = workspace / "extracted"
        runtime_log.detail("Extracting ZIP archive safely...")
        safe_extract_zip(zip_path, extract_dir)

        mlmodel_paths = list(extract_dir.rglob("MLmodel"))
        if not mlmodel_paths:
            raise ValueError("No MLmodel file found in the ZIP archive.")

        package_dir = mlmodel_paths[0].parent
        runtime_log.detail(f"Found MLmodel at {package_dir.relative_to(extract_dir)}")
        shutil.copytree(package_dir, workspace / "model", dirs_exist_ok=True)

        requirements_text = ""
        req_file = package_dir / "requirements.txt"
        conda_file = package_dir / "conda.yaml"
        if req_file.exists():
            requirements_text = req_file.read_text(encoding="utf-8").strip()
            runtime_log.detail("Found requirements.txt.")
        elif conda_file.exists():
            pip_requirements = parse_conda_pip_requirements(conda_file)
            if pip_requirements:
                requirements_text = "\n".join(pip_requirements)
                runtime_log.detail("Extracted pip requirements from conda.yaml.")
        else:
            runtime_log.detail("No requirements.txt or conda.yaml found. Proceeding with default environment.")

        if requirements_text.strip():
            runtime_log.detail("Installing package requirements for validation...")
            temp_req = workspace / "validation-requirements.txt"
            temp_req.write_text(requirements_text + "\n", encoding="utf-8")
            try:
                result = subprocess.run(
                    [sys.executable, "-m", "pip", "install", "-r", str(temp_req)],
                    check=True, capture_output=True, text=True,
                )
            except subprocess.CalledProcessError as exc:
                for output in (exc.stdout, exc.stderr):
                    for line in (output or "").splitlines():
                        runtime_log.detail(line)
                raise
            for output in (result.stdout, result.stderr):
                for line in (output or "").splitlines():
                    runtime_log.detail(line)

        runtime_log.detail("Validating model load via mlflow.pyfunc...")

        mlflow.pyfunc.load_model(str(package_dir))
        runtime_log.detail("Model loaded successfully!")

        preview_tree = build_preview_tree(extract_dir)
        manifest = {
            "flavor": flavor,
            "source_type": "manual_upload",
            "source_artifact": artifact_name,
            "package_root": package_dir.name,
        }

        runtime_log.detail("Building custom Docker image...")
        if os.environ.get("BUILD_ENGINE", "").lower() == "kaniko":
            runtime_log.detail("Kaniko build engine detected. Preparing build context for TEST_ZIP...")
            harbor_url = os.environ.get("HARBOR_REGISTRY_URL", "").strip().rstrip("/")
            is_deep_learning = flavor in ["pytorch", "tensorflow", "keras"]
            base_image = (
                f"{harbor_url}/mlops-paas/deep-learning-serving:latest"
                if harbor_url and is_deep_learning
                else "mlops-paas-deep-learning-serving:latest"
                if is_deep_learning
                else f"{harbor_url}/mlops-paas/machine-learning-serving:latest"
                if harbor_url
                else "mlops-paas-machine-learning-serving:latest"
            )
            dockerfile_content = f"""FROM {base_image}
USER root
COPY requirements.txt /tmp/custom_requirements.txt
RUN grep -i -v -E '^(fastapi|uvicorn|starlette|pydantic|bentoml|httpx)([[:space:]=<>~!]*)?$' /tmp/custom_requirements.txt > /tmp/safe_requirements.txt || touch /tmp/safe_requirements.txt
RUN pip install --no-cache-dir -r /tmp/safe_requirements.txt || echo 'Some requirements failed to install, continuing...'
COPY model /app/model_artifact
"""
            (workspace / "Dockerfile").write_text(dockerfile_content, encoding="utf-8")
            (workspace / "requirements.txt").write_text((requirements_text.strip() + "\n") if requirements_text.strip() else "\n", encoding="utf-8")
            payload = {
                "build_id": build_id,
                "status": "success",
                "package_manifest": manifest,
                "package_preview_tree": preview_tree,
                "task_type": "TEST_ZIP",
            }
            (workspace / "webhook_payload.json").write_text(json.dumps(payload), encoding="utf-8")
            runtime_log.protocol("TEST_ZIP context prepared successfully for Kaniko! BUILD_PREPARE_SUCCESS")
            return
        else:
            if flavor in ["pytorch", "tensorflow", "keras"]:
                build_bento_image(workspace, build_id, tenant_id, requirements_text)
            else:
                build_custom_image(workspace, build_id, tenant_id, requirements_text)
        runtime_log.detail("Test and build completed successfully!")

        post_webhook(
            webhook_url,
            {
                "build_id": build_id,
                "status": "success",
                "package_manifest": manifest,
                "package_preview_tree": preview_tree,
                "task_type": "TEST_ZIP",
                **built_image_metadata(),
            },
        )
        runtime_log.protocol("BUILD_EOF_SUCCESS")
    finally:
        if not os.environ.get("BUILD_WORKSPACE_DIR"):
            shutil.rmtree(workspace, ignore_errors=True)

def run_notify_task(workspace_dir: str, webhook_url: str) -> None:
    workspace = Path(workspace_dir)
    payload_file = workspace / "webhook_payload.json"
    if not payload_file.exists():
        raise FileNotFoundError(f"Webhook payload not found at {payload_file}")
    payload = json.loads(payload_file.read_text(encoding="utf-8"))
    image_uri = os.environ.get("IMAGE_URI", "").strip()
    digest_file = workspace / "image-digest"
    if image_uri:
        payload["image_uri"] = image_uri
    if digest_file.exists():
        payload["image_digest"] = digest_file.read_text(encoding="utf-8").strip()
    runtime_log.detail(f"Sending post-build notification for build {payload.get('build_id')}...")
    post_webhook(webhook_url, payload)
    runtime_log.protocol("NOTIFY_EOF_SUCCESS")

def setup_logger(build_id: str):
    global runtime_log
    configure("model-packager")
    writer = None
    redis_url = os.environ.get("REDIS_URL", "redis://redis:6379/1")
    if redis_url and build_id:
        try:
            writer = RedisLogHandler(redis_url, build_id).write
        except Exception as exc:
            log_event(logger, logging.WARNING, "runtime_log_unavailable",
                      "Could not connect to Redis for build log streaming", reason=sanitize(str(exc)))
    runtime_log = RuntimeLog(logger, writer=writer)
    return logger

def main():
    started = time.monotonic()
    build_id = os.environ.get("BUILD_ID")
    setup_logger(build_id or "")
    if not build_id:
        runtime_log.event(logging.ERROR, "build_execution_failed", "Missing BUILD_ID",
                          duration_ms=round((time.monotonic() - started) * 1000, 3))
        sys.exit(1)

    webhook_url = os.environ.get("CONTROL_PLANE_WEBHOOK_URL")

    task_type = os.environ.get("TASK_TYPE", "BUILD")
    tokens = bind_context(build_id=build_id, project_id=os.environ.get("PROJECT_ID"),
                          tenant_id=os.environ.get("TENANT_ID"), operation=task_type)
    try:
        runtime_log.event(logging.INFO, "build_execution_started", f"Starting {task_type} process", duration_ms=0)

        if task_type == "NOTIFY_BUILD":
            workspace_dir = os.environ.get("BUILD_WORKSPACE_DIR", "/workspace")
            run_notify_task(workspace_dir, webhook_url)
        elif task_type == "TEST_ZIP":
            run_test_zip_task(build_id, webhook_url)
        else:
            run_build_task(build_id, webhook_url)
        if task_type == "NOTIFY_BUILD":
            runtime_log.event(logging.INFO, "build.notification.completed", "Build notification execution completed",
                              duration_ms=round((time.monotonic() - started) * 1000, 3))
        elif os.environ.get("BUILD_ENGINE", "").lower() == "kaniko":
            runtime_log.event(logging.INFO, "build.preparation.completed", "Build context preparation completed",
                              duration_ms=round((time.monotonic() - started) * 1000, 3))
        else:
            runtime_log.event(logging.INFO, "build_execution_succeeded", "Build runner execution completed",
                              duration_ms=round((time.monotonic() - started) * 1000, 3))
    except Exception as exc:
        runtime_log.event(logging.ERROR, "build_execution_failed", "Build runner execution failed",
                          reason=sanitize(str(exc)), exc_info=True,
                          duration_ms=round((time.monotonic() - started) * 1000, 3))
        try:
            post_webhook(
                webhook_url,
                {
                    "build_id": build_id,
                    "status": "error",
                    "error_message": sanitize(str(exc)),
                },
            )
        except Exception as webhook_exc:
            runtime_log.event(logging.ERROR, "build_failure_callback_failed",
                              "Failed to notify Control Plane failure webhook", reason=sanitize(str(webhook_exc)))

        runtime_log.protocol("BUILD_EOF_ERROR")
        sys.exit(1)
    finally:
        reset_context(tokens)

if __name__ == "__main__":
    main()
