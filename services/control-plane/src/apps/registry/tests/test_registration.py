from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.catalog.models import ModelProject
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
def test_version_smoke_test_is_tenant_scoped():
    owner = get_user_model().objects.create_user("smoke-owner@example.com", "password123")
    other = get_user_model().objects.create_user("smoke-other@example.com", "password123")
    project = ModelProject.objects.create(owner=owner, name="Smoke")
    version = register_version(project=project, actor=owner, validated_data={"version": "1"})
    client = APIClient()
    url = f"/api/registry/versions/{version.public_id}/smoke-test/"

    client.force_authenticate(other)
    assert client.post(url, {"features": {}} , format="json").status_code == 404

    client.force_authenticate(owner)
    with patch("apps.registry.api.endpoints.predict_version", return_value={"success": True}) as predict:
        response = client.post(url, {"features": {"value": 1}}, format="json")

    assert response.status_code == 200
    predict.assert_called_once()
