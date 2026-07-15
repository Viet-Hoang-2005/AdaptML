import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from infrastructure.storage.s3 import StoredObject
from rest_framework.test import APIClient

from apps.catalog.models import ModelBuildInputAsset, ModelBuildMetadata, ModelProject


class FakeStorage:
    def __init__(self):
        self.deleted = []

    def put(self, key, body, content_type):
        payload = body.read()
        return StoredObject(key, f"s3://test-bucket/{key}", "checksum", len(payload), content_type)

    def delete(self, uri):
        self.deleted.append(uri)


@pytest.mark.django_db
def test_manual_draft_persists_metadata_assets_and_is_tenant_scoped(monkeypatch):
    storage = FakeStorage()
    monkeypatch.setattr("apps.catalog.services.build_metadata.S3Storage", lambda: storage)
    owner = get_user_model().objects.create_user("draft-owner@example.com", "password123")
    other = get_user_model().objects.create_user("draft-other@example.com", "password123")
    client = APIClient()
    client.force_authenticate(owner)

    response = client.post(
        "/api/models/drafts/",
        {
            "name": "NIDS",
            "description": "Network detector",
            "access_mode": "private",
            "flavor": "sklearn",
            "requirements_text": "scikit-learn==1.7.2",
            "source_artifact": SimpleUploadedFile("model.pkl", b"model", "application/octet-stream"),
        },
        format="multipart",
    )

    assert response.status_code == 201
    project = ModelProject.objects.get(name="NIDS")
    assert response.data["revision"] == 1
    assert project.build_metadata.flavor == "sklearn"
    assert project.model_type == "ml"
    assert project.build_input_assets.get(kind="source_artifact").name == "model.pkl"

    client.force_authenticate(other)
    assert client.get(f"/api/models/{project.public_id}/build-metadata/").status_code == 404


@pytest.mark.django_db
def test_updating_manual_draft_increments_revision_only_for_changes(monkeypatch):
    storage = FakeStorage()
    monkeypatch.setattr("apps.catalog.services.build_metadata.S3Storage", lambda: storage)
    owner = get_user_model().objects.create_user("draft-update@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="NIDS")
    ModelBuildMetadata.objects.create(project=project, flavor="sklearn")
    ModelBuildInputAsset.objects.create(
        project=project,
        kind="source_artifact",
        name="model.pkl",
        s3_uri="s3://test-bucket/model.pkl",
    )
    client = APIClient()
    client.force_authenticate(owner)
    payload = {
        "name": "NIDS",
        "description": "",
        "access_mode": "public",
        "flavor": "sklearn",
        "requirements_text": "",
    }

    unchanged = client.put(f"/api/models/{project.public_id}/build-metadata/", payload, format="multipart")
    changed = client.put(
        f"/api/models/{project.public_id}/build-metadata/",
        {**payload, "requirements_text": "numpy==1.26.4"},
        format="multipart",
    )

    assert unchanged.status_code == 200
    assert unchanged.data["revision"] == 1
    assert changed.status_code == 200
    assert changed.data["revision"] == 2


@pytest.mark.django_db
def test_manual_draft_rejects_raw_artifact_with_an_incompatible_flavor(monkeypatch):
    storage = FakeStorage()
    monkeypatch.setattr("apps.catalog.services.build_metadata.S3Storage", lambda: storage)
    owner = get_user_model().objects.create_user("draft-format@example.com", "password123")
    client = APIClient()
    client.force_authenticate(owner)

    response = client.post(
        "/api/models/drafts/",
        {
            "name": "Invalid artifact",
            "flavor": "sklearn",
            "artifact_format": "raw",
            "source_artifact": SimpleUploadedFile("model.pt", b"model", "application/octet-stream"),
        },
        format="multipart",
    )

    assert response.status_code == 400
    assert "source_artifact" in response.data["error"]["detail"]


@pytest.mark.django_db
def test_manual_draft_accepts_an_mlflow_package_zip(monkeypatch):
    storage = FakeStorage()
    monkeypatch.setattr("apps.catalog.services.build_metadata.S3Storage", lambda: storage)
    owner = get_user_model().objects.create_user("draft-package@example.com", "password123")
    client = APIClient()
    client.force_authenticate(owner)

    response = client.post(
        "/api/models/drafts/",
        {
            "name": "Packaged model",
            "flavor": "tensorflow",
            "artifact_format": "mlflow_zip",
            "source_artifact": SimpleUploadedFile("model-package.zip", b"zip", "application/zip"),
        },
        format="multipart",
    )

    assert response.status_code == 201
    assert response.data["artifact_format"] == "mlflow_zip"
    assert ModelProject.objects.get(public_id=response.data["id"]).model_type == "dl"


@pytest.mark.django_db
def test_switching_to_package_zip_removes_separate_metadata_assets(monkeypatch):
    storage = FakeStorage()
    monkeypatch.setattr("apps.catalog.services.build_metadata.S3Storage", lambda: storage)
    owner = get_user_model().objects.create_user("draft-switch@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="Switch artifact")
    ModelBuildMetadata.objects.create(project=project, flavor="sklearn")
    ModelBuildInputAsset.objects.create(
        project=project,
        kind="source_artifact",
        name="model.zip",
        s3_uri="s3://test-bucket/model.zip",
    )
    ModelBuildInputAsset.objects.create(
        project=project,
        kind="metrics",
        name="metrics.json",
        s3_uri="s3://test-bucket/metrics.json",
    )
    client = APIClient()
    client.force_authenticate(owner)

    response = client.put(
        f"/api/models/{project.public_id}/build-metadata/",
        {
            "name": project.name,
            "flavor": "sklearn",
            "artifact_format": "mlflow_zip",
        },
        format="multipart",
    )

    assert response.status_code == 200
    assert not ModelBuildInputAsset.objects.filter(project=project, kind="metrics").exists()
    assert storage.deleted == ["s3://test-bucket/metrics.json"]
