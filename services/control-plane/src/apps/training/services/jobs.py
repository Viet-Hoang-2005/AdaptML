from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from django.conf import settings
from django.db import transaction
from infrastructure.storage import S3Storage

from apps.training.models import TrainingJob, TrainingJobEvent
from apps.training.services.storage_scope import expected_training_uris, validate_training_uri
from apps.training.tasks import cancel_training_job, execute_training_job


def create_job(*, project, validated_data):
    source_zip = validated_data.pop("source_zip", None)
    training_data = validated_data.pop("training_data", None)
    if not validated_data.get("requirements_text"):
        validated_data["requirements_text"] = project.requirements_text
    validated_data["backend"] = settings.TRAINING_BACKEND
    public_id = validated_data.pop("public_id", None)
    draft = (
        TrainingJob(public_id=public_id, project=project, **validated_data)
        if public_id
        else TrainingJob(project=project, **validated_data)
    )
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    scoped_uris = expected_training_uris(draft, bucket)
    draft.code_snapshot_uri = scoped_uris["code"]
    draft.data_snapshot_uri = scoped_uris["data"]
    draft.output_uri = scoped_uris["output"]
    draft.mlflow_artifact_uri = scoped_uris["mlflow"]
    draft.save()
    storage = S3Storage()
    if source_zip:
        storage.put(storage.parse_uri(draft.code_snapshot_uri)[1], source_zip, "application/zip")
    else:
        _snapshot_code(project, draft, storage)
    if training_data:
        storage.put(
            storage.parse_uri(draft.data_snapshot_uri)[1],
            training_data,
            training_data.content_type or "text/csv",
        )
    else:
        _snapshot_data(project, draft, storage)
    TrainingJobEvent.objects.create(job=draft, event_type="created", message="Training job created.")
    return draft


def _snapshot_code(project, job, storage):
    assets = list(project.workspace_assets.filter(kind="code"))
    if not assets:
        return
    bundle = BytesIO()
    with ZipFile(bundle, "w", ZIP_DEFLATED) as archive:
        for asset in assets:
            bucket, key = storage.parse_uri(asset.s3_uri)
            body = storage.client.get_object(Bucket=bucket, Key=key)["Body"].read()
            archive.writestr(asset.relative_path, body)
    storage.put(storage.parse_uri(job.code_snapshot_uri)[1], bundle.getvalue(), "application/zip")


def _snapshot_data(project, job, storage):
    asset = project.workspace_assets.filter(kind="data").order_by("-updated_at").first()
    if not asset:
        return
    bucket, key = storage.parse_uri(asset.s3_uri)
    body = storage.client.get_object(Bucket=bucket, Key=key)["Body"].read()
    storage.put(storage.parse_uri(job.data_snapshot_uri)[1], body, asset.content_type or "text/csv")


def submit_job(job):
    if job.status not in {"pending", "failed"}:
        return job
    job.status = "queued"
    job.save(update_fields=["status", "updated_at"])
    transaction.on_commit(lambda: _enqueue(job))
    return job


def _enqueue(job):
    result = execute_training_job.delay(str(job.public_id))
    TrainingJob.objects.filter(pk=job.pk).update(celery_task_id=result.id)


def cancel_job(job):
    transaction.on_commit(lambda: cancel_training_job.delay(str(job.public_id)))
    return job


def output_download_url(job):
    storage = S3Storage()
    validate_training_uri(job, storage.bucket, "output", job.output_uri)
    return storage.presigned_get(job.output_uri, settings.TRAINING_PRESIGNED_URL_TTL_SECONDS)
