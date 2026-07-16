import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.catalog.models import ModelProject
from apps.training.models import TrainingJob


@pytest.mark.django_db
def test_training_job_paths_are_project_scoped(monkeypatch):
    user = get_user_model().objects.create_user("owner@example.com", "password123")
    project = ModelProject.objects.create(owner=user, name="NIDS")
    client = APIClient()
    client.force_authenticate(user)

    response = client.post(
        "/api/training-jobs/",
        {
            "project": str(project.public_id),
            "name": "nightly",
            "model_flavor": "xgboost",
            "requirements_text": "xgboost==2.0.3",
            "code_snapshot_uri": "s3://other-tenant/source.zip",
            "data_snapshot_uri": "s3://other-tenant/train.csv",
        },
        format="json",
    )

    assert response.status_code == 201
    job = TrainingJob.objects.get(public_id=response.data["id"])
    prefix = f"users/{user.tenant_id}/models/{project.public_id}/training/jobs/{job.public_id}"
    assert job.code_snapshot_uri.endswith(f"{prefix}/input/code/source.zip")
    assert job.data_snapshot_uri.endswith(f"{prefix}/input/data/train.csv")
    assert job.output_uri.endswith(f"{prefix}/output/model.tar.gz")
    assert job.mlflow_artifact_uri.endswith(f"{prefix}/mlflow/")
    assert "other-tenant" not in job.code_snapshot_uri
    assert "other-tenant" not in job.data_snapshot_uri

    monkeypatch.setattr(
        "apps.training.api.endpoints.output_download_url",
        lambda selected_job: "https://s3.example/download",
    )
    download = client.get(f"/api/training-jobs/{job.public_id}/download/")
    assert download.status_code == 200
    assert download.data["download_url"] == "https://s3.example/download"


@pytest.mark.django_db
def test_runtime_capabilities_only_expose_configured_accelerators(settings):
    user = get_user_model().objects.create_user("capabilities@example.com", "password123")
    client = APIClient()
    client.force_authenticate(user)
    settings.TRAINING_BACKEND = "docker"
    settings.TRAINING_GPU_ENABLED = False
    settings.TRAINING_GPU_COUNTS = [1, 2]

    cpu_only = client.get("/api/training-jobs/runtime-capabilities/")

    assert cpu_only.status_code == 200
    assert cpu_only.data["backend"] == "docker"
    assert cpu_only.data["accelerators"] == [{"type": "none", "counts": [0]}]

    settings.TRAINING_GPU_ENABLED = True
    with_gpu = client.get("/api/training-jobs/runtime-capabilities/")
    assert with_gpu.data["accelerators"][-1] == {"type": "gpu", "counts": [1, 2]}
