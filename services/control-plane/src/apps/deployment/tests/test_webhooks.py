from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings
from infrastructure.execution.factory import deployment_backend
from rest_framework.test import APIClient

from apps.catalog.models import ModelProject
from apps.deployment.models import Build
from apps.registry.models import ModelVersion


@pytest.mark.django_db
@override_settings(CONTROL_PLANE_WEBHOOK_SECRET="test-webhook-secret")
def test_build_webhook_is_idempotent():
    user = get_user_model().objects.create_user("owner@example.com", "password123")
    project = ModelProject.objects.create(owner=user, name="project")
    version = ModelVersion.objects.create(project=project, version="1")
    build = Build.objects.create(version=version, status="building")
    client = APIClient()
    headers = {"HTTP_X_CONTROL_PLANE_SECRET": "test-webhook-secret"}
    url = f"/internal/webhooks/builds/{build.public_id}/"

    first = client.post(url, {"status": "success"}, format="json", **headers)
    second = client.post(url, {"status": "error"}, format="json", **headers)
    build.refresh_from_db()

    assert first.status_code == 200
    assert second.data["duplicate"] is True
    assert build.status == "ready"


@pytest.mark.django_db
def test_internal_webhook_rejects_integer_identifier():
    response = APIClient().post("/internal/webhooks/builds/1/", {}, format="json")
    assert response.status_code == 404


@pytest.mark.django_db
def test_build_cancel_is_tenant_scoped(django_capture_on_commit_callbacks):
    owner = get_user_model().objects.create_user("owner-cancel@example.com", "password123")
    other = get_user_model().objects.create_user("other@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="cancel project")
    version = ModelVersion.objects.create(project=project, version="1")
    build = Build.objects.create(version=version, status="building")
    with patch("apps.deployment.services.builds.cancel_build.delay") as enqueue:
        client = APIClient()
        client.force_authenticate(other)

        denied = client.post(f"/api/builds/{build.public_id}/cancel/")
        assert denied.status_code == 404

        client.force_authenticate(owner)
        with django_capture_on_commit_callbacks(execute=True):
            accepted = client.post(f"/api/builds/{build.public_id}/cancel/")

        enqueue.assert_called_once_with(str(build.public_id))
    build.refresh_from_db()

    assert accepted.status_code == 202
    assert build.status == "cancelled"


@override_settings(BUILD_BACKEND="docker", DEPLOYMENT_BACKEND="argo")
@patch("infrastructure.execution.factory.ArgoDeploymentBackend")
def test_deployment_backend_uses_its_own_setting(argo_backend):
    deployment_backend()
    argo_backend.assert_called_once_with()


@override_settings(BUILD_BACKEND="argo", DEPLOYMENT_BACKEND="docker")
@patch("infrastructure.execution.factory.DockerDeploymentBackend")
def test_deployment_backend_does_not_follow_build_backend(docker_backend):
    deployment_backend()
    docker_backend.assert_called_once_with()
