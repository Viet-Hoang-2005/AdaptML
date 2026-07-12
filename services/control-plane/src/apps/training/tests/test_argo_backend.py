import pytest
from django.contrib.auth import get_user_model
from infrastructure.execution.argo_backends import ArgoTrainingBackend

from apps.catalog.models import ModelProject
from apps.training.models import TrainingJob


class FakeArgoClient:
    def __init__(self):
        self.calls = []

    def trigger(self, url, payload):
        self.calls.append((url, payload))
        return {"accepted": True}


class FakeStorage:
    def presigned_get(self, uri, expires_in):
        return f"https://storage.example/download?uri={uri}&expires={expires_in}"

    def presigned_put(self, uri, expires_in):
        return f"https://storage.example/upload?uri={uri}&expires={expires_in}"


@pytest.mark.django_db
def test_argo_training_backend_records_runtime_selectors():
    user = get_user_model().objects.create_user("owner@example.com", "password123")
    project = ModelProject.objects.create(owner=user, name="NIDS")
    job = TrainingJob.objects.create(
        project=project,
        name="nightly",
        code_snapshot_uri="s3://bucket/code.zip",
        data_snapshot_uri="s3://bucket/train.csv",
        output_uri="s3://bucket/model.tar.gz",
        mlflow_artifact_uri="s3://bucket/mlflow/",
    )
    client = FakeArgoClient()

    ArgoTrainingBackend(client=client, storage=FakeStorage()).run(job)

    job.refresh_from_db()
    runtime_name = f"training-{job.public_id}"
    expected_selector = f"mlops.io/training-job-id={job.public_id}"
    assert job.external_job_id == runtime_name
    assert job.tracking["runtime"] == {
        "backend": "argo",
        "namespace": "default",
        "pytorch_job_name": runtime_name,
        "workflow_selector": expected_selector,
        "pod_selector": expected_selector,
    }
    assert client.calls[0][1]["project_id"] == str(project.public_id)
