import logging
import os
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import boto3
from django.conf import settings
from rest_framework.exceptions import ValidationError

logger = logging.getLogger("paas.training.storage")


def _s3_client():
    kwargs = {}
    if getattr(settings, "AWS_S3_ENDPOINT_URL", None):
        kwargs["endpoint_url"] = settings.AWS_S3_ENDPOINT_URL
    return boto3.client("s3", **kwargs)


def _s3_uri(bucket: str, key: str) -> str:
    return f"s3://{bucket}/{key.lstrip('/')}"


def _normalize_s3_uri(bucket: str, uri_or_key: str) -> str:
    value = (uri_or_key or "").strip()
    if not value or value.startswith("s3://"):
        return value
    return _s3_uri(bucket, value)


def _split_s3_uri(uri: str) -> tuple[str, str]:
    if not uri or not uri.startswith("s3://"):
        raise ValueError(f"Invalid S3 URI: {uri}")
    parsed = urlparse(uri)
    return parsed.netloc, parsed.path.lstrip("/")


def _first_object_key(s3, bucket: str, prefix: str) -> str:
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if not key.endswith("/"):
                return key
    raise ValidationError({"error": f"No files found under S3 prefix: s3://{bucket}/{prefix}"})


def _safe_extract_zip(zip_path: Path, target_dir: Path) -> None:
    with zipfile.ZipFile(zip_path, "r") as zf:
        for member in zf.infolist():
            resolved = (target_dir / member.filename).resolve()
            if not str(resolved).startswith(str(target_dir.resolve())):
                raise ValidationError({"error": f"Path traversal attempt in zip archive: {member.filename}"})
            zf.extract(member, target_dir)


def upload_training_inputs_to_s3(training_job) -> tuple[str, str, str]:
    """Tải source code zip và dataset lên S3 bucket phục vụ training."""
    import tempfile
    from io import BytesIO
    from integrations.hashid_utils import encode_model_id

    bucket = settings.AWS_STORAGE_BUCKET_NAME
    if not bucket:
        raise ValidationError({"error": "AWS_STORAGE_BUCKET_NAME is not configured."})

    if getattr(training_job, "model_api", None):
        tenant_id = training_job.tenant.tenant_id
        model_hash_id = encode_model_id(training_job.model_api.id)
        safe_version = training_job.model_api.version.replace(' ', '') if training_job.model_api.version else 'v1'
        prefix = f"users/{tenant_id}/models/{model_hash_id}/{safe_version}/training/jobs/{training_job.id}"
        code_target_key = f"users/{tenant_id}/models/{model_hash_id}/{safe_version}/code/source.zip"
    else:
        prefix = f"tenants/{training_job.tenant.tenant_id}/jobs/{training_job.id}"
        code_target_key = f"{prefix}/source/source.zip"

    s3 = _s3_client()

    source_uri = _normalize_s3_uri(bucket, training_job.s3_source_uri)
    data_uri = _normalize_s3_uri(bucket, training_job.s3_training_data_uri)
    source_zip = getattr(training_job, "source_zip", None)
    training_data = getattr(training_job, "training_data", None)

    if not source_uri and source_zip:
        source_zip.seek(0)
        s3.upload_fileobj(source_zip, bucket, code_target_key)
        source_uri = _s3_uri(bucket, code_target_key)
        training_job.s3_source_uri = source_uri
    elif source_uri and source_uri.startswith("s3://"):
        src_bucket, src_key = _split_s3_uri(source_uri)
        target_key = code_target_key
        if src_key.endswith("/"):
            mem_zip = BytesIO()
            with zipfile.ZipFile(mem_zip, "w", zipfile.ZIP_DEFLATED) as zf:
                paginator = s3.get_paginator("list_objects_v2")
                for page in paginator.paginate(Bucket=src_bucket, Prefix=src_key):
                    for obj in page.get("Contents", []):
                        k = obj["Key"]
                        if k.endswith("/") or k == target_key:
                            continue
                        rel_name = k[len(src_key):].lstrip("/")
                        body = s3.get_object(Bucket=src_bucket, Key=k)["Body"].read()
                        zf.writestr(rel_name, body)
            mem_zip.seek(0)
            s3.upload_fileobj(mem_zip, bucket, target_key)
        else:
            if src_key != target_key:
                s3.copy_object(CopySource={"Bucket": src_bucket, "Key": src_key}, Bucket=bucket, Key=target_key)
        source_uri = _s3_uri(bucket, target_key)
        training_job.s3_source_uri = source_uri

    if not data_uri and training_data:
        key = f"{prefix}/data/train.csv"
        training_data.seek(0)
        s3.upload_fileobj(training_data, bucket, key)
        data_uri = _s3_uri(bucket, key)
        training_job.s3_training_data_uri = data_uri
    elif data_uri and data_uri.startswith("s3://"):
        src_bucket, src_key = _split_s3_uri(data_uri)
        if getattr(training_job, "model_api", None):
            if src_key.endswith("/"):
                target_key = _first_object_key(s3, src_bucket, src_key)
            else:
                target_key = src_key
        else:
            target_key = f"{prefix}/data/train.csv"
            if src_key.endswith("/"):
                src_key = _first_object_key(s3, src_bucket, src_key)
            if src_key != target_key:
                s3.copy_object(CopySource={"Bucket": src_bucket, "Key": src_key}, Bucket=bucket, Key=target_key)
        data_uri = _s3_uri(bucket, target_key)
        training_job.s3_training_data_uri = data_uri

    if not source_uri or not data_uri:
        raise ValidationError({"error": "Training job must provide both source code and training dataset."})

    training_job.save(update_fields=["s3_source_uri", "s3_training_data_uri"])
    return source_uri, data_uri, prefix


def generate_presigned_download_url(s3_uri: str, expiry_seconds: int = 7200) -> str:
    if not s3_uri or not s3_uri.startswith("s3://"):
        return s3_uri
    bucket, key = _split_s3_uri(s3_uri)
    return _s3_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expiry_seconds,
    )


def generate_presigned_upload_url(s3_uri: str, expiry_seconds: int = 7200) -> str:
    if not s3_uri or not s3_uri.startswith("s3://"):
        return s3_uri
    bucket, key = _split_s3_uri(s3_uri)
    return _s3_client().generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expiry_seconds,
    )
