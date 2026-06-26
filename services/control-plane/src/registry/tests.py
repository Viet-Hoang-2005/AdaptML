from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from authentication.models import CustomUser, ModelFamily, ModelVersion, TrainingJob


class ModelEvolutionSummaryMirrorTests(TestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user(email="tenant@example.com", password="pass")
        self.other_user = CustomUser.objects.create_user(email="other@example.com", password="pass")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _completed_job(self, **overrides):
        defaults = {
            "tenant": self.user,
            "name": "nids-xgb",
            "model_version": "v2",
            "entry_point": "train.py",
            "training_backend": "aws_batch",
            "source_zip": SimpleUploadedFile("source.zip", b"zip"),
            "training_data": SimpleUploadedFile("train.csv", b"f1,label\n1,0\n"),
            "status": "completed",
            "model_artifact_uri": "s3://bucket/tenants/T-1/training-jobs/1/output/batch/model.tar.gz",
            "tracking_status": "completed",
            "training_summary": {"entry_point": "train.py", "status": "succeeded"},
            "metrics_summary": {"accuracy": 0.97, "loss": 0.12},
            "params_summary": {"n_estimators": 100},
            "artifact_manifest": [
                {
                    "path": "model.pkl",
                    "kind": "model",
                    "size_bytes": 123,
                    "sha256": "a" * 64,
                }
            ],
            "deployability_status": "deployable",
            "deployability_reason": "Found supported model artifact: model.pkl.",
            "mlflow_run_id": "run-123",
            "mlflow_experiment_id": "exp-1",
            "mlflow_artifact_uri": "s3://bucket/mlflow/run-123",
        }
        defaults.update(overrides)
        return TrainingJob.objects.create(**defaults)

    def test_register_training_job_mirrors_tracking_summary_to_model_version(self):
        job = self._completed_job()

        response = self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        version = ModelVersion.objects.select_related("family", "source_training_job").get(
            family__tenant=self.user,
            family__name="nids-xgb",
            version="v2",
        )
        self.assertEqual(version.source_training_job_id, job.id)
        self.assertEqual(version.metrics_summary["accuracy"], 0.97)
        self.assertEqual(version.params_summary["n_estimators"], 100)
        self.assertEqual(version.artifact_manifest[0]["path"], "model.pkl")
        self.assertEqual(version.deployability_status, "deployable")
        self.assertEqual(version.mlflow_run_id, "run-123")

    def test_re_register_same_training_job_updates_existing_model_version(self):
        job = self._completed_job()
        payload = {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"}

        first = self.client.post(f"/api/training/jobs/{job.id}/register-model/", payload, format="json")
        second = self.client.post(f"/api/training/jobs/{job.id}/register-model/", payload, format="json")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(ModelFamily.objects.filter(tenant=self.user, name="nids-xgb").count(), 1)
        self.assertEqual(ModelVersion.objects.filter(family__tenant=self.user, family__name="nids-xgb", version="v2").count(), 1)

    def test_registry_version_detail_includes_tracking_summary_fields(self):
        job = self._completed_job()
        self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )
        version = ModelVersion.objects.get(family__tenant=self.user, family__name="nids-xgb", version="v2")

        response = self.client.get(f"/api/registry/versions/{version.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["tracking_status"], "completed")
        self.assertEqual(response.data["metrics_summary"]["accuracy"], 0.97)
        self.assertEqual(response.data["deployability_status"], "deployable")
        self.assertEqual(response.data["source_training_job_backend"], "aws_batch")
        self.assertEqual(response.data["mlflow_run_id"], "run-123")

    def test_cross_tenant_registry_version_detail_denied(self):
        job = self._completed_job()
        self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )
        version = ModelVersion.objects.get(family__tenant=self.user, family__name="nids-xgb", version="v2")
        other_client = APIClient()
        other_client.force_authenticate(user=self.other_user)

        response = other_client.get(f"/api/registry/versions/{version.id}/")

        self.assertEqual(response.status_code, 404)

    def test_registration_allows_failed_tracking_and_missing_mlflow_run(self):
        job = self._completed_job(
            tracking_status="failed",
            tracking_error="MLflow tracking failed: connection refused",
            mlflow_run_id="",
            mlflow_experiment_id="",
            mlflow_artifact_uri="",
        )

        response = self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        version = ModelVersion.objects.get(family__tenant=self.user, family__name="nids-xgb", version="v2")
        self.assertEqual(version.tracking_status, "failed")
        self.assertIn("MLflow tracking failed", version.tracking_error)
        self.assertFalse(version.mlflow_run_id)
