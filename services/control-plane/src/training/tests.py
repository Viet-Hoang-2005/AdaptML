import json
import os
import tarfile
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from authentication.models import CustomUser, ModelAPI, ModelVersion, TrainingJob
from training.tracking_ingestion_service import (
    compute_deployability,
    ingest_training_job_tracking,
)
from training.s3_storage_service import upload_training_inputs_to_s3


class _FakeS3Paginator:
    def __init__(self, pages):
        self.pages = pages

    def paginate(self, **kwargs):
        bucket = kwargs["Bucket"]
        prefix = kwargs["Prefix"]
        contents = [
            {"Key": key}
            for key in self.pages.get(bucket, [])
            if key.startswith(prefix)
        ]
        return [{"Contents": contents}]


class _FakeS3Client:
    def __init__(self):
        self.objects = {
            ("source-bucket", "tenants/T-1/models/demo/v1/code/train.py"): b"print('ok')\n",
            ("source-bucket", "tenants/T-1/models/demo/v1/code/requirements.txt"): b"pandas\n",
            ("source-bucket", "tenants/T-1/models/demo/v1/references/train.csv"): b"f1,label\n1,0\n",
        }
        self.uploads = {}
        self.copies = []

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        pages = {}
        for bucket, key in self.objects:
            pages.setdefault(bucket, []).append(key)
        return _FakeS3Paginator(pages)

    def download_fileobj(self, bucket, key, file_obj):
        file_obj.write(self.objects[(bucket, key)])

    def upload_fileobj(self, file_obj, bucket, key):
        self.uploads[(bucket, key)] = file_obj.read()

    def copy_object(self, **kwargs):
        self.copies.append(kwargs)


class S3TrainingInputPackagingTests(TestCase):
    def setUp(self):
        self.user = CustomUser.objects.create_user(email="tenant@example.com", password="pass")

    def _job(self, **overrides):
        defaults = {
            "tenant": self.user,
            "name": "demo-model",
            "model_version": "v1",
            "entry_point": "train.py",
            "training_backend": "kubeflow",
            "source_zip": SimpleUploadedFile("placeholder.zip", b""),
            "training_data": SimpleUploadedFile("placeholder.csv", b""),
            "status": "pending",
            "s3_source_uri": "s3://source-bucket/tenants/T-1/models/demo/v1/code/",
            "s3_training_data_uri": "s3://source-bucket/tenants/T-1/models/demo/v1/references/",
        }
        defaults.update(overrides)
        return TrainingJob.objects.create(**defaults)

    @override_settings(AWS_STORAGE_BUCKET_NAME="target-bucket")
    @patch("training.s3_storage_service._s3_client")
    def test_full_s3_code_and_reference_prefixes_are_packaged_for_batch(self, mock_s3_client):
        fake_client = _FakeS3Client()
        mock_s3_client.return_value = fake_client
        job = self._job()

        source_uri, data_uri, prefix = upload_training_inputs_to_s3(job)

        expected_source_key = f"{prefix}/source/source.zip"
        expected_data_key = f"{prefix}/data/train.csv"
        self.assertEqual(source_uri, f"s3://target-bucket/{expected_source_key}")
        self.assertEqual(data_uri, f"s3://target-bucket/{expected_data_key}")
        self.assertIn(("target-bucket", expected_source_key), fake_client.uploads)
        with zipfile.ZipFile(BytesIO(fake_client.uploads[("target-bucket", expected_source_key)])) as archive:
            self.assertEqual(sorted(archive.namelist()), ["requirements.txt", "train.py"])
        self.assertEqual(
            fake_client.copies[0],
            {
                "CopySource": {"Bucket": "source-bucket", "Key": "tenants/T-1/models/demo/v1/references/train.csv"},
                "Bucket": "target-bucket",
                "Key": expected_data_key,
            },
        )


@override_settings(MLFLOW_TRACKING_REQUIRED=True)
class TrackingIngestionTests(TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.workspace = Path(self.tmpdir.name)
        self.user = CustomUser.objects.create_user(email="tenant@example.com", password="pass")
        self.other_user = CustomUser.objects.create_user(email="other@example.com", password="pass")

    def tearDown(self):
        self.tmpdir.cleanup()

    def _job(self, artifact_path: Path, tenant=None, status="completed"):
        return TrainingJob.objects.create(
            tenant=tenant or self.user,
            name="demo-model",
            model_version="v1",
            entry_point="train.py",
            training_backend="kubeflow",
            source_zip=SimpleUploadedFile("source.zip", b"zip"),
            training_data=SimpleUploadedFile("train.csv", b"f1,label\n1,0\n"),
            status=status,
            model_artifact_uri=str(artifact_path),
        )

    def _write_tar(self, tar_path: Path, files: dict[str, str | bytes]):
        source_dir = self.workspace / f"src-{tar_path.stem}"
        source_dir.mkdir(parents=True)
        for relative, content in files.items():
            path = source_dir / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(content, bytes):
                path.write_bytes(content)
            else:
                path.write_text(content, encoding="utf-8")
        with tarfile.open(tar_path, "w:gz") as archive:
            for item in source_dir.rglob("*"):
                archive.add(item, arcname=item.relative_to(source_dir))

    def _write_unsafe_tar(self, tar_path: Path):
        payload = self.workspace / "evil.txt"
        payload.write_text("evil", encoding="utf-8")
        with tarfile.open(tar_path, "w:gz") as archive:
            archive.add(payload, arcname="../evil.txt")

    def _valid_mlops_files(self):
        return {
            "model.pkl": b"model-bytes",
            "_mlops/training_summary.json": json.dumps(
                {
                    "runner_version": "mlops-metadata-bundle-v1",
                    "entry_point": "train.py",
                    "model_version": "v1",
                    "status": "succeeded",
                }
            ),
            "_mlops/metrics.json": json.dumps({"accuracy": 0.98, "note": "ignored"}),
            "_mlops/params.json": json.dumps({"n_estimators": 10}),
            "_mlops/model_insights.json": json.dumps(
                {
                    "feature_importance": {
                        "duration": 0.2,
                        "packet_rate": 0.8,
                    }
                }
            ),
            "_mlops/artifact_manifest.json": json.dumps(
                [
                    {
                        "path": "model.pkl",
                        "size_bytes": 11,
                        "sha256": "abc",
                        "kind": "model",
                    }
                ]
            ),
            "_mlops/warnings.json": "[]",
            "_mlops/stdout.txt": "training output",
            "_mlops/stderr.txt": "",
            "_mlops/metric_events.jsonl": "",
        }

    @patch("training.tracking_ingestion_service._log_to_mlflow")
    def test_valid_mlops_ingests_summaries(self, mock_mlflow):
        mock_mlflow.return_value = {
            "run_id": "run-1",
            "experiment_id": "exp-1",
            "artifact_uri": "s3://bucket/mlflow/run-1",
            "tracking_uri": "http://mlflow:5000",
            "run_name": "training-job-1-demo",
        }
        tar_path = self.workspace / "model.tar.gz"
        self._write_tar(tar_path, self._valid_mlops_files())
        job = self._job(tar_path)

        payload = ingest_training_job_tracking(job)
        job.refresh_from_db()

        self.assertEqual(payload["tracking_status"], "completed")
        self.assertEqual(job.tracking_status, "completed")
        self.assertEqual(job.metrics_summary["accuracy"], 0.98)
        self.assertEqual(job.params_summary["n_estimators"], 10)
        self.assertEqual(job.model_insights_summary["schema_version"], "model-insights-v1")
        self.assertEqual(job.model_insights_summary["items"][0]["name"], "packet_rate")
        self.assertEqual(job.model_insights_summary["items"][0]["rank"], 1)
        self.assertEqual(job.deployability_status, "deployable")
        self.assertEqual(job.mlflow_run_id, "run-1")

    @patch("training.tracking_ingestion_service._log_to_mlflow")
    def test_missing_model_insights_does_not_fail_ingestion(self, mock_mlflow):
        mock_mlflow.return_value = {
            "run_id": "run-no-insights",
            "experiment_id": "exp-1",
            "artifact_uri": "s3://bucket/mlflow/run-no-insights",
            "tracking_uri": "http://mlflow:5000",
            "run_name": "training-job-no-insights-demo",
        }
        files = self._valid_mlops_files()
        files.pop("_mlops/model_insights.json")
        tar_path = self.workspace / "no-insights.tar.gz"
        self._write_tar(tar_path, files)
        job = self._job(tar_path)

        ingest_training_job_tracking(job)
        job.refresh_from_db()

        self.assertEqual(job.tracking_status, "completed")
        self.assertEqual(job.model_insights_summary, {})

    @patch("training.tracking_ingestion_service._log_to_mlflow")
    def test_missing_mlops_falls_back_to_artifact_scan(self, mock_mlflow):
        mock_mlflow.return_value = {
            "run_id": "run-2",
            "experiment_id": "exp-1",
            "artifact_uri": "s3://bucket/mlflow/run-2",
            "tracking_uri": "http://mlflow:5000",
            "run_name": "training-job-2-demo",
        }
        tar_path = self.workspace / "plain-model.tar.gz"
        self._write_tar(tar_path, {"model.joblib": b"model"})
        job = self._job(tar_path)

        ingest_training_job_tracking(job)
        job.refresh_from_db()

        self.assertEqual(job.tracking_status, "completed")
        self.assertEqual(job.deployability_status, "deployable")
        self.assertTrue(any(item["path"] == "model.joblib" for item in job.artifact_manifest))
        self.assertIn("warning", job.training_summary)

    def test_corrupt_tar_sets_invalid_failed(self):
        tar_path = self.workspace / "corrupt.tar.gz"
        tar_path.write_text("not a tar", encoding="utf-8")
        job = self._job(tar_path)

        ingest_training_job_tracking(job)
        job.refresh_from_db()

        self.assertEqual(job.tracking_status, "failed")
        self.assertEqual(job.deployability_status, "invalid")
        self.assertIn("could not be extracted", job.tracking_error)

    def test_unsafe_tar_path_rejected(self):
        tar_path = self.workspace / "unsafe.tar.gz"
        self._write_unsafe_tar(tar_path)
        job = self._job(tar_path)

        ingest_training_job_tracking(job)
        job.refresh_from_db()

        self.assertEqual(job.tracking_status, "failed")
        self.assertEqual(job.deployability_status, "invalid")
        self.assertIn("Unsafe tar path", job.tracking_error)

    @patch("training.tracking_ingestion_service._log_to_mlflow")
    def test_repeated_ingestion_is_idempotent(self, mock_mlflow):
        mock_mlflow.return_value = {
            "run_id": "run-3",
            "experiment_id": "exp-1",
            "artifact_uri": "s3://bucket/mlflow/run-3",
            "tracking_uri": "http://mlflow:5000",
            "run_name": "training-job-3-demo",
        }
        tar_path = self.workspace / "idempotent.tar.gz"
        self._write_tar(tar_path, self._valid_mlops_files())
        job = self._job(tar_path)

        ingest_training_job_tracking(job)
        ingest_training_job_tracking(job)

        self.assertEqual(mock_mlflow.call_count, 1)

    @override_settings(MLFLOW_TRACKING_REQUIRED=False)
    @patch("training.tracking_ingestion_service._log_to_mlflow")
    def test_mlflow_disabled_skips_tracking(self, mock_mlflow):
        tar_path = self.workspace / "model.tar.gz"
        self._write_tar(tar_path, self._valid_mlops_files())
        job = self._job(tar_path)

        payload = ingest_training_job_tracking(job)
        job.refresh_from_db()

        self.assertEqual(mock_mlflow.call_count, 0)
        self.assertEqual(payload["tracking_status"], "skipped")
        self.assertEqual(job.tracking_status, "skipped")
        self.assertIn("MLflow tracking is disabled", job.tracking_error)
        self.assertEqual(job.metrics_summary["accuracy"], 0.98)
        self.assertEqual(job.params_summary["n_estimators"], 10)
        self.assertEqual(job.deployability_status, "deployable")

    @override_settings(MLFLOW_TRACKING_REQUIRED=False)
    @patch("training.tracking_ingestion_service._log_to_mlflow")
    def test_mlflow_disabled_syncs_registered_model_version(self, mock_mlflow):
        tar_path = self.workspace / "model-registered.tar.gz"
        self._write_tar(tar_path, self._valid_mlops_files())
        job = self._job(tar_path)
        model_api = ModelAPI.objects.create(
            tenant=self.user,
            name=job.name,
            version=job.model_version,
            source_type="training_job",
            source_training_job=job,
            source_artifact_uri=job.model_artifact_uri,
            flavor="sklearn",
        )

        ingest_training_job_tracking(job)

        self.assertEqual(mock_mlflow.call_count, 0)
        version = ModelVersion.objects.get(tenant=self.user, model_api=model_api)
        self.assertEqual(version.metrics_summary["accuracy"], 0.98)
        self.assertEqual(version.params_summary["n_estimators"], 10)
        self.assertEqual(version.model_insights_summary["items"][0]["name"], "packet_rate")
        self.assertEqual(version.tracking_status, "skipped")
        self.assertEqual(version.deployability_status, "deployable")

    @patch("training.tracking_ingestion_service._log_to_mlflow")
    def test_mlflow_down_preserves_summaries(self, mock_mlflow):
        mock_mlflow.side_effect = RuntimeError(
            "HTTPConnectionPool(host='mlflow', port=5000): Max retries exceeded with url: / "
            "(Caused by NameResolutionError('failed to resolve mlflow'))"
        )
        tar_path = self.workspace / "mlflow-down.tar.gz"
        self._write_tar(tar_path, self._valid_mlops_files())
        job = self._job(tar_path)

        ingest_training_job_tracking(job)
        job.refresh_from_db()

        self.assertEqual(job.tracking_status, "failed")
        self.assertEqual(job.metrics_summary["accuracy"], 0.98)
        self.assertEqual(job.deployability_status, "deployable")
        self.assertIn("MLFLOW_UNAVAILABLE", job.tracking_error)
        self.assertNotIn("HTTPConnectionPool", job.tracking_error)
        self.assertNotIn("NameResolutionError", job.tracking_error)
        self.assertEqual(job.status, "completed")

    def test_compute_deployability_variants(self):
        self.assertEqual(compute_deployability([{"path": "MLmodel"}])[0], "deployable")
        self.assertEqual(compute_deployability([{"path": "model.xgb"}])[0], "deployable")
        self.assertEqual(compute_deployability([{"path": "weights.pt"}])[0], "track_only")
        self.assertEqual(compute_deployability([])[0], "invalid")

    def test_cross_tenant_summary_denied(self):
        tar_path = self.workspace / "tenant.tar.gz"
        self._write_tar(tar_path, self._valid_mlops_files())
        job = self._job(tar_path, tenant=self.other_user)
        client = APIClient()
        client.force_authenticate(user=self.user)

        response = client.get(f"/api/training/jobs/{job.id}/summary/")

        self.assertEqual(response.status_code, 400)
