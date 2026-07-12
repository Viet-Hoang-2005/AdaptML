import pytest
from django.contrib.auth import get_user_model
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APIClient

from apps.catalog.models import ModelProject
from apps.deployment.models import Build, Deployment, Endpoint
from apps.registry.models import ModelVersion, RegistryAlias
from apps.registry.services.routing import predict_alias, predict_version
from apps.registry.services.versions import register_version
from apps.training.models import TrainingJob, TrainingOutput


@pytest.mark.django_db
def test_registration_maps_training_outputs_and_requirements_snapshot():
    user = get_user_model().objects.create_user("owner@example.com", "password123")
    project = ModelProject.objects.create(owner=user, name="NIDS")
    job = TrainingJob.objects.create(
        project=project,
        name="job",
        status="completed",
        requirements_text="xgboost==2.0.3",
        code_snapshot_uri="s3://bucket/code.zip",
        data_snapshot_uri="s3://bucket/train.csv",
        output_uri="s3://bucket/output/model.tar.gz",
    )
    TrainingOutput.objects.create(job=job, kind="model", relative_path="model.tar.gz", s3_uri=job.output_uri)

    version = register_version(project=project, actor=user, validated_data={"version": "1", "source_job": job})

    assert version.requirements_snapshot == "xgboost==2.0.3"
    assert version.artifacts.get().uri == job.output_uri


@pytest.mark.django_db
def test_version_smoke_test_is_tenant_scoped(monkeypatch):
    owner = get_user_model().objects.create_user("smoke-owner@example.com", "password123")
    other = get_user_model().objects.create_user("smoke-other@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="Smoke")
    version = register_version(project=project, actor=owner, validated_data={"version": "1"})
    client = APIClient()
    url = f"/api/registry/versions/{version.public_id}/smoke-test/"

    client.force_authenticate(other)
    assert client.post(url, {"features": {}} , format="json").status_code == 404

    client.force_authenticate(owner)
    calls = []

    def fake_predict_version(**kwargs):
        calls.append(kwargs)
        return {"success": True}

    monkeypatch.setattr("apps.registry.api.endpoints.predict_version", fake_predict_version)
    response = client.post(url, {"features": {"value": 1}}, format="json")

    assert response.status_code == 200
    assert len(calls) == 1


class FakeResponse:
    status_code = 200

    def json(self):
        return {"prediction": [1], "confidence": [0.97]}


class FakeHttpClient:
    def __init__(self):
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        return FakeResponse()


@pytest.fixture
def routable_version(db):
    user = get_user_model().objects.create_user("route-owner@example.com", "password123")
    project = ModelProject.objects.create(owner=user, name="Routable")
    version = ModelVersion.objects.create(project=project, version="1")
    build = Build.objects.create(version=version, status="ready")
    deployment = Deployment.objects.create(version=version, build=build, status="healthy")
    Endpoint.objects.create(
        deployment=deployment,
        public_url="https://models.example/predict",
        internal_url="http://worker:3000",
        health_status="healthy",
    )
    return project, version


def test_predict_version_proxies_to_healthy_endpoint(routable_version):
    _, version = routable_version
    http = FakeHttpClient()

    result = predict_version(version=version, payload={"features": {"value": 1}}, http=http)

    assert result["prediction"] == [1]
    assert result["confidence"] == [0.97]
    assert result["endpoint_url"] == "https://models.example/predict"
    assert http.calls == [
        ("POST", "http://worker:3000/predict", {"json": {"features": {"value": 1}}})
    ]


def test_predict_version_rejects_version_without_healthy_endpoint(routable_version):
    _, version = routable_version
    Endpoint.objects.update(health_status="unhealthy")

    with pytest.raises(ValidationError, match="no healthy endpoint"):
        predict_version(version=version, payload={}, http=FakeHttpClient())


def test_predict_alias_resolves_alias_and_rejects_missing_alias(routable_version):
    project, version = routable_version
    RegistryAlias.objects.create(project=project, version=version, name="production")

    result = predict_alias(project=project, alias_name="production", payload={}, http=FakeHttpClient())
    assert result["success"] is True

    with pytest.raises(NotFound, match="does not exist"):
        predict_alias(project=project, alias_name="missing", payload={}, http=FakeHttpClient())
