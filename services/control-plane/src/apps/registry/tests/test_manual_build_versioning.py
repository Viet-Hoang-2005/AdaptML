import pytest
from django.contrib.auth import get_user_model
from infrastructure.storage.s3 import StoredObject

from apps.catalog.models import ModelBuildInputAsset, ModelBuildMetadata, ModelProject
from apps.registry.services.versions import version_for_manual_build


class FakeCopyStorage:
    def copy(self, source_uri, destination_key):
        return StoredObject(
            destination_key,
            f"s3://test-bucket/{destination_key}",
            "checksum",
            12,
            "application/octet-stream",
        )


@pytest.mark.django_db
def test_manual_build_snapshots_revision_and_auto_increments_version():
    user = get_user_model().objects.create_user("version-owner@example.com", "password123")
    project = ModelProject.objects.create(owner=user, name="NIDS", requirements_text="numpy==1.26.4")
    metadata = ModelBuildMetadata.objects.create(project=project, flavor="sklearn", revision=1)
    ModelBuildInputAsset.objects.create(
        project=project,
        kind="source_artifact",
        name="model.pkl",
        s3_uri="s3://test-bucket/build-input.pkl",
    )
    storage = FakeCopyStorage()

    first = version_for_manual_build(project=project, actor=user, storage=storage)
    retry = version_for_manual_build(project=project, actor=user, storage=storage)
    metadata.revision = 2
    metadata.save(update_fields=["revision", "updated_at"])
    project.requirements_text = "numpy==2.0.0"
    project.save(update_fields=["requirements_text", "updated_at"])
    second = version_for_manual_build(project=project, actor=user, storage=storage)

    assert first.version == "1"
    assert retry.public_id == first.public_id
    assert first.source_config_revision == 1
    assert first.artifacts.get(kind="source").uri.endswith("/inputs/source_artifact/model.pkl")
    assert first.artifacts.get(kind="source").metadata["artifact_format"] == "raw"
    assert second.version == "2"
    assert second.source_config_revision == 2
    assert second.requirements_snapshot == "numpy==2.0.0"
