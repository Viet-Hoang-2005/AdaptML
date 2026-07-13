import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.catalog.models import ModelProject
from apps.training.models import TrainingJob


@pytest.mark.django_db
def test_training_job_paths_are_project_scoped(monkeypatch):
    user = get_user_model().objects.create_user("owner@example.com", "password123")
    project = ModelProject.objects.create(owner=user, name="NIDS", requirements_text="xgboost==2.0.3")
    client = APIClient()
    client.force_authenticate(user)

    response = client.post(
        "/api/training-jobs/",
        {
            "project": str(project.public_id),
            "name": "nightly",
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
