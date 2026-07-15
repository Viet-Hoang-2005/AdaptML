import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.catalog.models import ModelProject
from apps.deployment.models import Build, Deployment
from apps.registry.models import ModelVersion


@pytest.mark.django_db
def test_project_api_uses_uuid_and_tenant_scope():
    owner = get_user_model().objects.create_user("owner@example.com", "password123")
    stranger = get_user_model().objects.create_user("stranger@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="NIDS")
    client = APIClient()
    client.force_authenticate(stranger)

    assert client.get(f"/api/models/{project.public_id}/").status_code == 404

    client.force_authenticate(owner)
    response = client.get(f"/api/models/{project.public_id}/")
    assert response.status_code == 200
    assert uuid.UUID(response.data["id"]) == project.public_id


@pytest.mark.django_db
def test_duplicate_project_name_returns_conflict_with_clear_message():
    owner = get_user_model().objects.create_user("duplicate-owner@example.com", "password123")
    ModelProject.objects.create(owner=owner, name="NIDS")
    client = APIClient()
    client.force_authenticate(owner)

    response = client.post("/api/models/", {"name": "NIDS", "access_mode": "public"}, format="json")

    assert response.status_code == 409
    assert response.data == {
        "error": {
            "code": "conflict",
            "detail": "A model project named NIDS already exists.",
        }
    }


@pytest.mark.django_db
def test_project_list_returns_metadata_image_ready_and_deployed_lifecycle_statuses():
    owner = get_user_model().objects.create_user("lifecycle-owner@example.com", "password123")
    metadata_project = ModelProject.objects.create(owner=owner, name="Metadata only")
    image_project = ModelProject.objects.create(owner=owner, name="Image ready")
    deployed_project = ModelProject.objects.create(owner=owner, name="Deployed")

    image_version = ModelVersion.objects.create(project=image_project, version="1")
    Build.objects.create(version=image_version, status="ready")

    deployed_version = ModelVersion.objects.create(project=deployed_project, version="1")
    deployed_build = Build.objects.create(version=deployed_version, status="ready")
    Deployment.objects.create(version=deployed_version, build=deployed_build, status="healthy")

    client = APIClient()
    client.force_authenticate(owner)
    response = client.get("/api/models/")

    assert response.status_code == 200
    statuses = {project["name"]: project["lifecycle_status"] for project in response.data["results"]}
    assert statuses == {
        metadata_project.name: "metadata",
        image_project.name: "image_ready",
        deployed_project.name: "deployed",
    }
