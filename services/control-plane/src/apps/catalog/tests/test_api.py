import uuid

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.catalog.models import ModelProject


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
