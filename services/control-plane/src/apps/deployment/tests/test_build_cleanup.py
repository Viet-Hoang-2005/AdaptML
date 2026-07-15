from datetime import timedelta
from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from infrastructure.execution.image_cleanup import BuildImageCleaner

from apps.catalog.models import ModelProject
from apps.deployment.models import Build
from apps.deployment.services import builds as build_service
from apps.registry.models import ModelVersion


class FakeImageCleaner:
    def __init__(self):
        self.deleted = []

    def delete(self, build):
        self.deleted.append(build.public_id)
        return "deleted"


@pytest.mark.django_db
def test_discard_ready_unsaved_build_marks_audit_record_and_removes_its_image():
    owner = get_user_model().objects.create_user("cleanup-owner@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="cleanup project")
    version = ModelVersion.objects.create(project=project, version="1")
    build = Build.objects.create(
        version=version,
        backend="docker",
        status="ready",
        image_uri=f"build-{version.public_id}:latest",
    )
    cleaner = FakeImageCleaner()

    result = build_service.discard_ready_unsaved_build(build.public_id, image_cleaner=cleaner)
    build.refresh_from_db()

    assert result == "deleted"
    assert cleaner.deleted == [build.public_id]
    assert build.status == "discarded"
    assert build.discarded_at is not None
    assert build.is_saved is False


@pytest.mark.django_db
def test_cleanup_keeps_saved_or_deployed_builds():
    owner = get_user_model().objects.create_user("retained-owner@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="retained project")
    version = ModelVersion.objects.create(project=project, version="1")
    build = Build.objects.create(version=version, status="ready", is_saved=True)
    cleaner = FakeImageCleaner()

    assert build_service.discard_ready_unsaved_build(build.public_id, image_cleaner=cleaner) == "retained"
    assert cleaner.deleted == []


@pytest.mark.django_db
def test_expired_unsaved_build_query_excludes_recent_and_saved_builds():
    owner = get_user_model().objects.create_user("expiry-owner@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="expiry project")
    version = ModelVersion.objects.create(project=project, version="1")
    expired = Build.objects.create(version=version, status="ready", completed_at=timezone.now() - timedelta(days=2))
    Build.objects.create(version=version, status="ready", completed_at=timezone.now(), is_saved=False)
    Build.objects.create(
        version=version,
        status="ready",
        completed_at=timezone.now() - timedelta(days=2),
        is_saved=True,
    )

    assert build_service.expired_unsaved_build_ids(timezone.now() - timedelta(days=1)) == [expired.public_id]


@pytest.mark.django_db
def test_rebuild_queues_discard_for_an_older_unsaved_project_image(
    django_capture_on_commit_callbacks, monkeypatch
):
    owner = get_user_model().objects.create_user("rebuild-owner@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="rebuild project")
    old_version = ModelVersion.objects.create(project=project, version="1")
    next_version = ModelVersion.objects.create(project=project, version="2")
    old_build = Build.objects.create(version=old_version, status="ready", image_uri="build-old:latest")
    discarded = []
    queued = []
    monkeypatch.setattr(build_service.discard_build_image, "delay", lambda build_id: discarded.append(build_id))
    monkeypatch.setattr(
        build_service.execute_build,
        "delay",
        lambda build_id: queued.append(build_id) or SimpleNamespace(id="build-task"),
    )

    with django_capture_on_commit_callbacks(execute=True):
        new_build = build_service.request_build(next_version, "docker")

    assert discarded == [str(old_build.public_id)]
    assert queued == [str(new_build.public_id)]


def test_argo_cleanup_does_not_initialize_a_docker_client():
    class Harbor:
        def delete_artifact(self, image_uri):
            return image_uri

    build = type("Build", (), {"backend": "argo", "image_uri": "registry.example/user-images/build-id:latest"})()
    assert BuildImageCleaner(harbor_client=Harbor()).delete(build) == build.image_uri
