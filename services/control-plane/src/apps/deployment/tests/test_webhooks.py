from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings
from infrastructure.execution import factory
from rest_framework.test import APIClient

from apps.catalog.models import ModelProject
from apps.deployment.models import Build
from apps.deployment.services import builds as build_service
from apps.deployment.services import deployments as deployment_service
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
def test_build_cancel_is_tenant_scoped(django_capture_on_commit_callbacks, monkeypatch):
    owner = get_user_model().objects.create_user("owner-cancel@example.com", "password123")
    other = get_user_model().objects.create_user("other@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="cancel project")
    version = ModelVersion.objects.create(project=project, version="1")
    build = Build.objects.create(version=version, status="building")
    enqueued = []
    monkeypatch.setattr(build_service.cancel_build, "delay", lambda build_id: enqueued.append(build_id))
    client = APIClient()
    client.force_authenticate(other)

    denied = client.post(f"/api/builds/{build.public_id}/cancel/")
    assert denied.status_code == 404

    client.force_authenticate(owner)
    with django_capture_on_commit_callbacks(execute=True):
        accepted = client.post(f"/api/builds/{build.public_id}/cancel/")

    assert enqueued == [str(build.public_id)]
    build.refresh_from_db()

    assert accepted.status_code == 202
    assert build.status == "cancelled"


@pytest.mark.django_db
def test_saved_build_is_idempotent_and_deploy_saves_ready_image(django_capture_on_commit_callbacks, monkeypatch):
    owner = get_user_model().objects.create_user("saved-build-owner@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="saved build")
    version = ModelVersion.objects.create(project=project, version="1")
    build = Build.objects.create(version=version, status="ready")
    enqueued = []
    def enqueue(deployment_id):
        enqueued.append(deployment_id)
        return SimpleNamespace(id="test-task")

    monkeypatch.setattr(deployment_service.execute_deployment, "delay", enqueue)
    client = APIClient()
    client.force_authenticate(owner)

    first_save = client.post(f"/api/builds/{build.public_id}/save/")
    second_save = client.post(f"/api/builds/{build.public_id}/save/")
    build.refresh_from_db()
    assert first_save.status_code == 200
    assert second_save.status_code == 200
    assert build.is_saved is True
    assert build.saved_at is not None

    unsaved_build = Build.objects.create(version=version, status="ready")
    with django_capture_on_commit_callbacks(execute=True):
        deployed = client.post("/api/deployments/", {"build": str(unsaved_build.public_id)}, format="json")
    unsaved_build.refresh_from_db()

    assert deployed.status_code == 201
    assert unsaved_build.is_saved is True
    assert unsaved_build.saved_at is not None
    assert enqueued == [str(deployed.data["id"])]


@override_settings(BUILD_BACKEND="docker", DEPLOYMENT_BACKEND="argo")
def test_deployment_backend_uses_its_own_setting(monkeypatch):
    created = []

    def create_argo_backend():
        created.append("argo")
        return object()

    monkeypatch.setattr(factory, "ArgoDeploymentBackend", create_argo_backend)
    factory.deployment_backend()
    assert created == ["argo"]


@override_settings(BUILD_BACKEND="argo", DEPLOYMENT_BACKEND="docker")
def test_deployment_backend_does_not_follow_build_backend(monkeypatch):
    created = []

    def create_docker_backend():
        created.append("docker")
        return object()

    monkeypatch.setattr(factory, "DockerDeploymentBackend", create_docker_backend)
    factory.deployment_backend()
    assert created == ["docker"]
