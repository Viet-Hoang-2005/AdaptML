import pytest
from django.contrib.auth import get_user_model

from apps.catalog.models import ModelProject
from apps.deployment.models import Build, BuildInputAsset
from apps.deployment.tasks import cleanup_failed_build_artifacts


class FakeStorage:
    def __init__(self):
        self.prefixes = []

    def delete_prefix(self, prefix):
        self.prefixes.append(prefix)


class FakeCleaner:
    def __init__(self):
        self.deleted = []

    def delete(self, build):
        self.deleted.append(build.image_uri)


@pytest.mark.django_db
def test_failed_build_cleanup_removes_binary_and_keeps_audit_metadata(monkeypatch):
    owner = get_user_model().objects.create_user("cleanup-failed@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="cleanup project")
    build = Build.objects.create(project=project, flavor="sklearn", status="failed", image_uri=f"build-{project.public_id}:latest")
    asset = BuildInputAsset.objects.create(build=build, kind="source_artifact", name="model.pkl", checksum="checksum", s3_uri="s3://bucket/input/model.pkl")
    storage = FakeStorage()
    cleaner = FakeCleaner()
    monkeypatch.setattr("apps.deployment.tasks.S3Storage", lambda: storage)
    monkeypatch.setattr("apps.deployment.tasks.BuildImageCleaner", lambda: cleaner)
    assert cleanup_failed_build_artifacts.run(str(build.public_id), True) == "purged"
    asset.refresh_from_db()
    assert asset.name == "model.pkl"
    assert asset.checksum == "checksum"
    assert asset.s3_uri == ""
    assert asset.purged_at is not None
    assert cleaner.deleted == [build.image_uri]


@pytest.mark.django_db
def test_ready_build_is_retained(monkeypatch):
    owner = get_user_model().objects.create_user("cleanup-ready@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="retained project")
    build = Build.objects.create(project=project, flavor="sklearn", status="ready")
    monkeypatch.setattr("apps.deployment.tasks.S3Storage", lambda: FakeStorage())
    assert cleanup_failed_build_artifacts.run(str(build.public_id), True) == "retained"
