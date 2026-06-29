import io
import boto3
import shutil
import tempfile
import zipfile

from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings
from rest_framework.exceptions import ValidationError
from authentication.models import TrainingJob
from integrations.hashid_utils import encode_model_id
from sagemaker.session import Session  # type: ignore
from sagemaker.sklearn.estimator import SKLearn  # type: ignore
from training.tracking_ingestion_service import ingest_training_job_tracking

@dataclass(frozen=True)
class SageMakerTrainingConfig:
    role_arn: str
    bucket_name: str
    region_name: str
    instance_type: str
    max_run: int
    max_wait: int
    output_prefix: str
    sklearn_framework_version: str
    py_version: str
    use_spot: bool


def get_sagemaker_training_config() -> SageMakerTrainingConfig:
    if not settings.AWS_SAGEMAKER_ROLE_ARN:
        raise ValidationError(
            {
                "error": (
                    "AWS_SAGEMAKER_ROLE_ARN is required to start a SageMaker "
                    "training job. Set it in .env to the SageMaker execution role ARN."
                )
            }
        )

    return SageMakerTrainingConfig(
        role_arn=settings.AWS_SAGEMAKER_ROLE_ARN,
        bucket_name=settings.AWS_STORAGE_BUCKET_NAME,
        region_name=settings.AWS_S3_REGION_NAME,
        instance_type=settings.SAGEMAKER_INSTANCE_TYPE,
        max_run=settings.SAGEMAKER_MAX_RUN,
        max_wait=settings.SAGEMAKER_MAX_WAIT,
        output_prefix=settings.SAGEMAKER_OUTPUT_PREFIX,
        sklearn_framework_version=settings.SAGEMAKER_SKLEARN_FRAMEWORK_VERSION,
        py_version=settings.SAGEMAKER_PY_VERSION,
        use_spot=settings.SAGEMAKER_USE_SPOT,
    )


def _s3_client(config: SageMakerTrainingConfig | None = None):
    region_name = config.region_name if config else settings.AWS_S3_REGION_NAME
    return boto3.client("s3", region_name=region_name)


def _sagemaker_client(config: SageMakerTrainingConfig):
    return boto3.client("sagemaker", region_name=config.region_name)


def _tenant_job_prefix(training_job: TrainingJob, config: SageMakerTrainingConfig) -> str:
    prefix = config.output_prefix.strip("/")
    return f"{prefix}/{training_job.tenant.tenant_id}/training-jobs/{training_job.id}"


def _s3_uri(bucket: str, key: str) -> str:
    return f"s3://{bucket}/{key}"


def _split_s3_uri(uri: str) -> tuple[str, str]:
    parsed = urlparse(uri)
    if parsed.scheme != "s3" or not parsed.netloc:
        raise ValidationError({"error": "S3 URI must use s3://bucket/key format."})
    return parsed.netloc, parsed.path.lstrip("/")


def _is_prefix_like_s3_uri(uri: str, marker: str) -> bool:
    parsed = urlparse(uri)
    if parsed.scheme != "s3":
        return False
    key = parsed.path.lstrip("/")
    normalized_marker = marker.strip("/") + "/"
    return uri.endswith("/") or key.endswith(normalized_marker)


def get_training_job_prefix(training_job: TrainingJob) -> str:
    model_hash_id = encode_model_id(training_job.model_api_id) if training_job.model_api_id else "temp-id"
    safe_version = training_job.model_version.replace(' ', '') if training_job.model_version else 'v1'
    return f"users/{training_job.tenant.tenant_id}/models/{model_hash_id}/{safe_version}/training/{training_job.id}"


def upload_training_inputs_to_s3(training_job: TrainingJob) -> tuple[str, str, str]:
    bucket_name = settings.AWS_STORAGE_BUCKET_NAME
    prefix = get_training_job_prefix(training_job)
    data_key = f"{prefix}/data/train.csv"

    training_job.status = "uploading"
    training_job.save(update_fields=["status", "updated_at"])

    existing_s3_prefix = training_job.s3_source_uri or ""
    source_key = f"{prefix}/source/source.zip"
    if existing_s3_prefix and not existing_s3_prefix.startswith("s3://"):
        source_uri = _zip_s3_prefix_to_s3(bucket_name, existing_s3_prefix.rstrip("/") + "/", source_key)
    elif existing_s3_prefix.startswith("s3://") and _is_prefix_like_s3_uri(existing_s3_prefix, "code"):
        source_bucket, source_prefix = _split_s3_uri(existing_s3_prefix)
        source_uri = _zip_s3_prefix_to_s3(source_bucket, source_prefix.rstrip("/") + "/", source_key, target_bucket=bucket_name)
    elif existing_s3_prefix.startswith("s3://"):
        source_uri = existing_s3_prefix
    else:
        raise ValidationError({"error": "No valid S3 source URI provided."})

    existing_data_prefix = training_job.s3_training_data_uri or ""
    data_key = f"{prefix}/data/train.csv"
    if existing_data_prefix and not existing_data_prefix.startswith("s3://"):
        data_uri = _copy_s3_prefix_csv_to_s3(bucket_name, existing_data_prefix.rstrip("/") + "/", data_key)
    elif existing_data_prefix.startswith("s3://") and _is_prefix_like_s3_uri(existing_data_prefix, "references"):
        source_bucket, source_prefix = _split_s3_uri(existing_data_prefix)
        data_uri = _copy_s3_prefix_csv_to_s3(source_bucket, source_prefix.rstrip("/") + "/", data_key, target_bucket=bucket_name)
    elif existing_data_prefix.startswith("s3://"):
        data_uri = existing_data_prefix
    else:
        raise ValidationError({"error": "No valid S3 training data URI provided."})

    training_job.s3_source_uri = source_uri
    training_job.s3_training_data_uri = data_uri
    training_job.save(update_fields=["s3_source_uri", "s3_training_data_uri", "updated_at"])
    return source_uri, data_uri, prefix


def _zip_s3_prefix_to_s3(bucket: str, source_prefix: str, target_key: str, target_bucket: str | None = None) -> str:
    target_bucket = target_bucket or bucket
    s3_client = _s3_client()
    paginator = s3_client.get_paginator('list_objects_v2')
    found_files = False
    with tempfile.TemporaryFile() as tmp_zip:
        with zipfile.ZipFile(tmp_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
            for page in paginator.paginate(Bucket=bucket, Prefix=source_prefix):
                for obj in page.get('Contents', []):
                    key = obj['Key']
                    if key.endswith('/'):
                        continue
                    file_obj = io.BytesIO()
                    s3_client.download_fileobj(bucket, key, file_obj)
                    rel_path = key[len(source_prefix):].lstrip('/')
                    if not rel_path:
                        continue
                    zf.writestr(rel_path, file_obj.getvalue())
                    found_files = True
        if not found_files:
            raise ValidationError({"error": "No source files found in the S3 code prefix."})
        tmp_zip.seek(0)
        s3_client.upload_fileobj(tmp_zip, target_bucket, target_key)
    return _s3_uri(target_bucket, target_key)


def _copy_s3_prefix_csv_to_s3(bucket: str, source_prefix: str, target_key: str, target_bucket: str | None = None) -> str:
    target_bucket = target_bucket or bucket
    s3_client = _s3_client()
    paginator = s3_client.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=bucket, Prefix=source_prefix):
        for obj in page.get('Contents', []):
            if obj['Key'].lower().endswith('.csv'):
                s3_client.copy_object(
                    CopySource={'Bucket': bucket, 'Key': obj['Key']},
                    Bucket=target_bucket,
                    Key=target_key
                )
                return _s3_uri(target_bucket, target_key)
    raise ValidationError({"error": "No .csv file found in the S3 reference prefix."})


def _copy_django_file_to_s3(field_file, bucket: str, key: str, config: SageMakerTrainingConfig | None = None) -> str:
    field_file.open("rb")
    try:
        _s3_client(config).upload_fileobj(field_file.file, bucket, key)
    finally:
        field_file.close()
    return _s3_uri(bucket, key)


def _safe_extract_zip(zip_path: Path, destination: Path) -> None:
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            member_path = destination / member.filename
            if not str(member_path.resolve()).startswith(str(destination.resolve())):
                raise ValidationError({"error": "Source zip contains an unsafe path."})
        archive.extractall(destination)


def _write_field_file_to_path(field_file, target_path: Path) -> None:
    field_file.open("rb")
    try:
        with target_path.open("wb") as output:
            shutil.copyfileobj(field_file.file, output)
    finally:
        field_file.close()


def _model_artifact_uri(training_job: TrainingJob, output_s3_uri: str) -> str:
    return f"{output_s3_uri.rstrip('/')}/{training_job.sagemaker_job_name}/output/model.tar.gz"


def start_sagemaker_training_job(training_job: TrainingJob) -> tuple[str, str]:
    config = get_sagemaker_training_config()
    _, data_uri, prefix = upload_training_inputs_to_s3(training_job)

    workspace = Path(tempfile.mkdtemp(prefix=f"training-job-{training_job.id}-"))
    try:
        source_zip_path = workspace / "source.zip"
        source_dir = workspace / "source"
        source_dir.mkdir(parents=True, exist_ok=True)
        source_bucket, source_key = _split_s3_uri(training_job.s3_source_uri)
        _s3_client(config).download_file(source_bucket, source_key, str(source_zip_path))
        _safe_extract_zip(source_zip_path, source_dir)

        if training_job.model_api and training_job.model_api.requirements_text:
            (source_dir / "requirements.txt").write_text(training_job.model_api.requirements_text, encoding="utf-8")

        entry_point = training_job.entry_point.strip()
        entry_point_path = source_dir / entry_point
        if not entry_point_path.exists() or not entry_point_path.is_file():
            raise ValidationError(
                {
                    "error": (
                        "Source zip must contain the configured entry point. "
                        f"Could not find '{entry_point}'."
                    )
                }
            )

        output_s3_uri = _s3_uri(config.bucket_name, f"{prefix}/output/")
        boto_session = boto3.Session(region_name=config.region_name)
        sagemaker_session = Session(boto_session=boto_session)
        estimator = SKLearn(
            entry_point=entry_point,
            source_dir=str(source_dir),
            role=config.role_arn,
            instance_count=1,
            instance_type=config.instance_type,
            framework_version=config.sklearn_framework_version,
            py_version=config.py_version,
            sagemaker_session=sagemaker_session,
            output_path=output_s3_uri,
            environment={
                "MODEL_VERSION": training_job.model_version,
                "MLFLOW_MODEL_NAME": training_job.name,
                "AWS_BUCKET_NAME": config.bucket_name,
            },
            base_job_name=f"mlops-paas-{training_job.tenant.tenant_id.lower()}-{training_job.id}",
            use_spot_instances=config.use_spot,
            max_run=training_job.max_runtime_seconds or config.max_run,
            max_wait=max(config.max_wait, training_job.max_runtime_seconds or config.max_run),
        )
        estimator.fit({"train": data_uri}, wait=False)
        sagemaker_job_name = estimator.latest_training_job.name

        training_job.sagemaker_job_name = sagemaker_job_name
        training_job.output_s3_uri = output_s3_uri
        training_job.status = "running"
        training_job.error_message = ""
        training_job.stop_reason = ""
        training_job.mark_started(save=False)
        training_job.save(
            update_fields=[
                "sagemaker_job_name",
                "output_s3_uri",
                "status",
                "error_message",
                "stop_reason",
                "started_at",
                "updated_at",
            ]
        )
        return sagemaker_job_name, output_s3_uri
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def refresh_sagemaker_training_job(training_job: TrainingJob) -> TrainingJob:
    config = get_sagemaker_training_config()
    if not training_job.sagemaker_job_name:
        raise ValidationError({"error": "Training job has not been submitted to SageMaker yet."})

    response = _sagemaker_client(config).describe_training_job(
        TrainingJobName=training_job.sagemaker_job_name
    )
    sagemaker_status = response.get("TrainingJobStatus", "")

    if sagemaker_status == "Completed":
        training_job.status = "completed"
        training_job.error_message = ""
        training_job.stop_reason = ""
        training_job.model_artifact_uri = (
            response.get("ModelArtifacts", {}).get("S3ModelArtifacts")
            or _model_artifact_uri(training_job, training_job.output_s3_uri)
        )
        training_job.mark_finished(save=False)
    elif sagemaker_status in {"Failed", "Stopped"}:
        training_job.status = "failed"
        training_job.error_message = response.get("FailureReason", f"SageMaker status: {sagemaker_status}")
        training_job.stop_reason = training_job.error_message
        training_job.mark_finished(training_job.stop_reason, save=False)
    elif sagemaker_status in {"InProgress", "Stopping"}:
        training_job.status = "running"
        training_job.mark_started(save=False)
    else:
        training_job.status = "running"
        training_job.mark_started(save=False)

    training_job.save(
        update_fields=[
            "status",
            "error_message",
            "model_artifact_uri",
            "started_at",
            "completed_at",
            "runtime_seconds",
            "stop_reason",
            "updated_at",
        ]
    )
    if training_job.status == "completed" and training_job.model_artifact_uri:
        try:
            ingest_training_job_tracking(training_job)
        except Exception as exc:
            training_job.tracking_status = "failed"
            training_job.tracking_error = f"Tracking ingestion failed: {exc}"
            training_job.save(update_fields=["tracking_status", "tracking_error", "updated_at"])
    return training_job


def create_model_artifact_presigned_url(training_job: TrainingJob, expires_in: int = 3600) -> str:
    if training_job.status != "completed" or not training_job.model_artifact_uri:
        raise ValidationError({"error": "Model artifact is not available until the training job is completed."})

    parsed = urlparse(training_job.model_artifact_uri)
    if parsed.scheme != "s3" or not parsed.netloc or not parsed.path:
        raise ValidationError({"error": "Stored model_artifact_uri is not a valid S3 URI."})

    return _s3_client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": parsed.netloc,
            "Key": parsed.path.lstrip("/"),
        },
        ExpiresIn=expires_in,
    )
