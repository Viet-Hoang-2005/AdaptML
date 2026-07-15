from django.db import transaction
from infrastructure.storage import S3Storage
from infrastructure.storage.paths import version_prefix
from rest_framework.exceptions import ValidationError

from apps.catalog.models import ModelBuildMetadata
from apps.observability.services.outbox import enqueue_event
from apps.registry.models import ModelArtifact, ModelVersion, RegistryEvent

BUILD_INPUT_ARTIFACT_KINDS = {
    "source_artifact": "source",
    "label_mapping": "label_mapping",
    "metrics": "metrics",
    "params": "params",
    "model_insights": "model_insights",
    "feature_importance": "feature_importance",
    "input_schema": "input_schema",
}


def register_version(*, project, actor, validated_data):
    source_artifact = validated_data.pop("source_artifact", None)
    source_job = validated_data.get("source_job")
    if source_job and source_job.project_id != project.id:
        raise ValidationError({"source_job": "The training job belongs to another project."})
    requirements = source_job.requirements_text if source_job else project.requirements_text
    with transaction.atomic():
        version = ModelVersion.objects.create(project=project, requirements_snapshot=requirements, **validated_data)
        if source_job:
            for output in source_job.outputs.all():
                ModelArtifact.objects.create(
                    version=version,
                    kind="training_output"
                    if output.kind == "model"
                    else "mlflow"
                    if output.kind == "metric"
                    else "training_output",
                    name=output.relative_path,
                    uri=output.s3_uri,
                    checksum=output.checksum,
                    size_bytes=output.size_bytes,
                    content_type=output.content_type,
                    metadata=output.metadata,
                )
        elif source_artifact:
            storage = S3Storage()
            key = (
                f"{version_prefix(project.owner.tenant_id, project.public_id, version.public_id)}"
                f"/source/{source_artifact.name}"
            )
            stored = storage.put(
                key,
                source_artifact,
                source_artifact.content_type or "application/octet-stream",
            )
            ModelArtifact.objects.create(
                version=version,
                kind="source",
                name=source_artifact.name,
                uri=stored.uri,
                checksum=stored.checksum,
                size_bytes=stored.size_bytes,
                content_type=stored.content_type,
            )
        RegistryEvent.objects.create(version=version, actor=actor, event_type="registered", to_state=version.stage)
    return version


def version_for_manual_build(*, project, actor, storage=None):
    """Return the immutable registry version for the project's current metadata revision."""

    storage = storage or S3Storage()
    with transaction.atomic():
        project = type(project).objects.select_for_update().get(pk=project.pk)
        try:
            metadata = project.build_metadata
        except ModelBuildMetadata.DoesNotExist as exc:
            raise ValidationError({"metadata": "Save build metadata before starting a build."}) from exc

        existing = ModelVersion.objects.filter(
            project=project,
            source_config_revision=metadata.revision,
        ).first()
        if existing:
            return existing

        inputs = list(project.build_input_assets.all())
        if not any(asset.kind == "source_artifact" for asset in inputs):
            raise ValidationError({"source_artifact": "A primary model artifact is required."})

        version_number = project.next_version_number
        while ModelVersion.objects.filter(project=project, version=str(version_number)).exists():
            version_number += 1
        version = ModelVersion.objects.create(
            project=project,
            version=str(version_number),
            description=project.description,
            requirements_snapshot=project.requirements_text,
            flavor=metadata.flavor,
            source_config_revision=metadata.revision,
        )
        for asset in inputs:
            destination_key = (
                f"{version_prefix(project.owner.tenant_id, project.public_id, version.public_id)}"
                f"/inputs/{asset.kind}/{asset.name}"
            )
            stored = storage.copy(asset.s3_uri, destination_key)
            ModelArtifact.objects.create(
                version=version,
                kind=BUILD_INPUT_ARTIFACT_KINDS[asset.kind],
                name=asset.name,
                uri=stored.uri,
                checksum=stored.checksum,
                size_bytes=stored.size_bytes,
                content_type=stored.content_type,
                metadata={"artifact_format": metadata.artifact_format}
                if asset.kind == "source_artifact"
                else {},
            )
        project.next_version_number = version_number + 1
        project.save(update_fields=["next_version_number", "updated_at"])
        RegistryEvent.objects.create(
            version=version,
            actor=actor,
            event_type="registered",
            to_state=version.stage,
            metadata={"source_config_revision": metadata.revision, "source": "manual_metadata"},
        )
    return version


def set_alias(*, project, actor, name, version):
    from apps.registry.models import RegistryAlias

    if version.project_id != project.id:
        raise ValidationError({"version": "The version belongs to another project."})
    alias, _ = RegistryAlias.objects.update_or_create(project=project, name=name, defaults={"version": version})
    RegistryEvent.objects.create(version=version, actor=actor, event_type="alias_updated", to_state=name)
    enqueue_event(
        topic="registry.events",
        aggregate_type="model_project",
        aggregate_id=project.public_id,
        event_type="model.promoted",
        payload={
            "project_id": str(project.public_id),
            "version_id": str(version.public_id),
            "alias": name,
        },
    )
    return alias
