from pathlib import Path
from uuid import uuid4

from django.db import IntegrityError, transaction
from infrastructure.storage import S3Storage
from infrastructure.storage.paths import build_input_prefix
from rest_framework.exceptions import ValidationError

from apps.catalog.artifact_types import validate_source_artifact
from apps.catalog.models import ModelBuildInputAsset, ModelBuildMetadata, ModelProject
from apps.catalog.services.workspace import save_workspace_file

BUILD_INPUT_FILE_FIELDS = {
    "source_artifact": "source_artifact",
    "label_mapping_file": "label_mapping",
    "metrics_file": "metrics",
    "params_file": "params",
    "model_insights_file": "model_insights",
    "feature_importance_file": "feature_importance",
    "input_schema_file": "input_schema",
}

DEEP_LEARNING_FLAVORS = {"pytorch", "tensorflow"}


def _store_build_input(*, project, kind, uploaded_file, storage):
    if uploaded_file is None:
        return None, False
    filename = Path(uploaded_file.name).name
    key = f"{build_input_prefix(project.owner.tenant_id, project.public_id, kind)}{uuid4()}-{filename}"
    stored = storage.put(key, uploaded_file, uploaded_file.content_type or "application/octet-stream")
    old = ModelBuildInputAsset.objects.filter(project=project, kind=kind).first()
    asset, _ = ModelBuildInputAsset.objects.update_or_create(
        project=project,
        kind=kind,
        defaults={
            "name": filename,
            "s3_uri": stored.uri,
            "checksum": stored.checksum,
            "size_bytes": stored.size_bytes,
            "content_type": stored.content_type,
        },
    )
    if old and old.s3_uri != stored.uri:
        try:
            storage.delete(old.s3_uri)
        except Exception:  # pragma: no cover - a stale object is cleaned separately
            pass
    return asset, True


def save_build_metadata(*, actor, validated_data, project=None, storage=None):
    """Create or update the mutable manual-upload metadata owned by a project."""

    storage = storage or S3Storage()
    data = dict(validated_data)
    files = {field: data.pop(field, None) for field in BUILD_INPUT_FILE_FIELDS}
    source_code_file = data.pop("source_code_file", None)
    reference_data_file = data.pop("reference_data_file", None)
    flavor = data.pop("flavor")
    artifact_format = data.pop("artifact_format", None)
    model_type = "dl" if flavor in DEEP_LEARNING_FLAVORS else "ml"

    if project is None:
        artifact_format = artifact_format or "raw"
        data["model_type"] = model_type
        try:
            with transaction.atomic():
                project = ModelProject.objects.create(owner=actor, **data)
                draft = ModelBuildMetadata.objects.create(
                    project=project,
                    flavor=flavor,
                    artifact_format=artifact_format,
                )
        except IntegrityError as exc:
            if "project_owner_name_unique" in str(exc):
                raise ValidationError({"name": f"A model project named {data['name']} already exists."}) from exc
            raise
        changed = True
        draft_created = True
    else:
        draft, draft_created = ModelBuildMetadata.objects.get_or_create(
            project=project,
            defaults={"flavor": flavor, "artifact_format": artifact_format},
        )
        changed = False
        artifact_format = artifact_format or draft.artifact_format
        for field, value in data.items():
            if getattr(project, field) != value:
                setattr(project, field, value)
                changed = True
        if draft.flavor != flavor:
            draft.flavor = flavor
            changed = True
        if project.model_type != model_type:
            project.model_type = model_type
            changed = True
        if draft.artifact_format != artifact_format:
            current_source = ModelBuildInputAsset.objects.filter(project=project, kind="source_artifact").first()
            if current_source:
                validate_source_artifact(
                    filename=current_source.name,
                    flavor=flavor,
                    artifact_format=artifact_format,
                )
            draft.artifact_format = artifact_format
            changed = True

    for field, kind in BUILD_INPUT_FILE_FIELDS.items():
        _, asset_changed = _store_build_input(
            project=project,
            kind=kind,
            uploaded_file=files[field],
            storage=storage,
        )
        changed = changed or asset_changed

    if artifact_format == "mlflow_zip":
        for asset in ModelBuildInputAsset.objects.filter(project=project).exclude(kind="source_artifact"):
            try:
                storage.delete(asset.s3_uri)
            except Exception:  # pragma: no cover - stale objects are cleaned separately
                pass
            asset.delete()
            changed = True

    if source_code_file is not None:
        save_workspace_file(
            project=project,
            kind="code",
            relative_path=Path(source_code_file.name).name,
            uploaded_file=source_code_file,
            storage=storage,
        )
        changed = True
    if reference_data_file is not None:
        save_workspace_file(
            project=project,
            kind="data",
            relative_path=Path(reference_data_file.name).name,
            uploaded_file=reference_data_file,
            storage=storage,
        )
        changed = True

    if not ModelBuildInputAsset.objects.filter(project=project, kind="source_artifact").exists():
        raise ValidationError({"source_artifact": "A primary model artifact is required."})

    if changed:
        with transaction.atomic():
            project.save(
                update_fields=[
                    "name",
                    "description",
                    "access_mode",
                    "model_type",
                    "requirements_text",
                    "updated_at",
                ]
            )
            if not draft_created:
                draft.revision += 1
            draft.save(update_fields=["flavor", "artifact_format", "revision", "updated_at"])
    return project
