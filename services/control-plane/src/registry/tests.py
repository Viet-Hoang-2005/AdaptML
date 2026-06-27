from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
import requests
from rest_framework.test import APIClient
from unittest.mock import ANY, Mock, patch

from authentication.models import (
    CustomUser,
    DriftMonitoringJob,
    DriftMonitoringResult,
    ModelAPI,
    ModelFamily,
    ModelRoutingAlias,
    ModelVersion,
    TrainingJob,
)


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
            "model_insights_summary": {
                "schema_version": "model-insights-v1",
                "kind": "feature_importance",
                "source": "training_artifact",
                "feature_count": 2,
                "items": [
                    {"name": "packet_rate", "value": 0.7, "abs_value": 0.7, "rank": 1},
                    {"name": "duration", "value": 0.3, "abs_value": 0.3, "rank": 2},
                ],
            },
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

    def _family(self, tenant=None, name="nids-xgb"):
        return ModelFamily.objects.create(tenant=tenant or self.user, name=name, display_name=name)

    def _version(self, family, version="v1", **overrides):
        defaults = {
            "tenant": family.tenant,
            "family": family,
            "version": version,
            "stage": "candidate",
            "source_type": "training_job",
            "metrics_summary": {"accuracy": 0.91, "loss": 0.4},
            "params_summary": {"n_estimators": 100},
            "artifact_manifest": [
                {"path": "model.pkl", "kind": "model", "size_bytes": 100, "sha256": "a" * 64},
                {"path": "metadata.json", "kind": "metadata", "size_bytes": 20, "sha256": "m" * 64},
            ],
            "deployability_status": "deployable",
            "deployability_reason": "Found supported model artifact: model.pkl.",
        }
        defaults.update(overrides)
        return ModelVersion.objects.create(**defaults)

    def _deployed_model_api(self, name="alias-nids", version="v1", tenant=None, **overrides):
        tenant = tenant or self.user
        defaults = {
            "tenant": tenant,
            "name": name,
            "version": version,
            "source_type": "manual_upload",
            "status": "deployed",
            "endpoint_status": "healthy",
            "endpoint_url": f"http://localhost:5000/{tenant.tenant_id}/models/test/{version}/predict",
            "build_status": "ready",
            "flavor": "sklearn",
        }
        defaults.update(overrides)
        return ModelAPI.objects.create(**defaults)

    def _manual_upload_payload(self, **overrides):
        payload = {
            "name": "manual-nids",
            "version": "v1",
            "description": "Manual upload test",
            "model_info": "Uploaded artifact",
            "access_mode": "private",
            "flavor": "sklearn",
            "requirements_text": "scikit-learn\n",
            "source_artifact": SimpleUploadedFile("model.pkl", b"model-bytes", content_type="application/octet-stream"),
        }
        payload.update(overrides)
        return payload

    @patch("registry.views.get_build_adapter")
    def test_manual_upload_accepts_metadata_files_and_syncs_model_version(self, mock_get_build_adapter):
        mock_get_build_adapter.return_value = Mock()
        payload = self._manual_upload_payload(
            metrics_file=SimpleUploadedFile("metrics.json", b'{"metrics":{"accuracy":0.99,"f1_score":0.98}}', content_type="application/json"),
            params_file=SimpleUploadedFile("params.json", b'{"params":{"max_depth":7,"n_estimators":101}}', content_type="application/json"),
            model_insights_file=SimpleUploadedFile(
                "model_insights.json",
                b'{"items":[{"name":"packet_rate","value":0.2},{"name":"duration","value":0.7}]}',
                content_type="application/json",
            ),
        )

        response = self.client.post("/api/models/build/", payload, format="multipart")

        self.assertEqual(response.status_code, 201)
        model_api = ModelAPI.objects.get(tenant=self.user, name="manual-nids", version="v1")
        self.assertEqual(model_api.metrics_summary["accuracy"], 0.99)
        self.assertEqual(model_api.params_summary["max_depth"], 7)
        self.assertEqual(model_api.model_insights_summary["items"][0]["name"], "duration")
        version = ModelVersion.objects.get(tenant=self.user, family__name="manual-nids", version="v1")
        self.assertEqual(version.source_type, "manual_upload")
        self.assertEqual(version.model_api_id, model_api.id)
        self.assertEqual(version.metrics_summary["f1_score"], 0.98)
        self.assertEqual(version.params_summary["n_estimators"], 101)
        self.assertEqual(version.model_insights_summary["kind"], "feature_importance")
        self.assertEqual(version.model_insights_summary["items"][0]["rank"], 1)
        self.assertEqual(version.deployability_status, "deployable")

    @patch("registry.views.get_build_adapter")
    def test_manual_upload_invalid_metadata_warns_without_failing_upload(self, mock_get_build_adapter):
        mock_get_build_adapter.return_value = Mock()
        payload = self._manual_upload_payload(
            name="manual-invalid-metadata",
            metrics_file=SimpleUploadedFile("metrics.json", b"{not-json", content_type="application/json"),
            feature_importance_file=SimpleUploadedFile(
                "feature_importance.json",
                b'{"feature_importance":{"f1":0.1,"f2":0.3}}',
                content_type="application/json",
            ),
        )

        response = self.client.post("/api/models/build/", payload, format="multipart")

        self.assertEqual(response.status_code, 201)
        self.assertIn("metadata_warnings", response.data)
        self.assertTrue(response.data["metadata_warnings"])
        version = ModelVersion.objects.get(tenant=self.user, family__name="manual-invalid-metadata", version="v1")
        self.assertEqual(version.metrics_summary, {})
        self.assertEqual(version.model_insights_summary["items"][0]["name"], "f2")

    @patch("registry.views.get_build_adapter")
    def test_manual_upload_artifact_only_still_syncs_model_version(self, mock_get_build_adapter):
        mock_get_build_adapter.return_value = Mock()

        response = self.client.post("/api/models/build/", self._manual_upload_payload(name="manual-artifact-only"), format="multipart")

        self.assertEqual(response.status_code, 201)
        model_api = ModelAPI.objects.get(tenant=self.user, name="manual-artifact-only", version="v1")
        self.assertEqual(model_api.metrics_summary, {})
        self.assertEqual(model_api.params_summary, {})
        self.assertEqual(model_api.model_insights_summary, {})
        version = ModelVersion.objects.get(tenant=self.user, family__name="manual-artifact-only", version="v1")
        self.assertEqual(version.source_type, "manual_upload")
        self.assertEqual(version.metrics_summary, {})
        self.assertEqual(version.model_insights_summary, {})
        self.assertEqual(version.deployability_status, "deployable")

    @patch("registry.views.get_build_adapter")
    def test_registry_build_package_supports_manual_upload_versions(self, mock_get_build_adapter):
        adapter = Mock()
        mock_get_build_adapter.return_value = adapter
        model_api = ModelAPI.objects.create(
            tenant=self.user,
            name="manual-build",
            version="v1",
            source_type="manual_upload",
            flavor="sklearn",
            source_artifact=SimpleUploadedFile("model.pkl", b"model-bytes"),
            requirements_text="scikit-learn\n",
            build_status="not_started",
            status="ready",
        )
        from registry.views import sync_registry_version_from_model_api
        version = sync_registry_version_from_model_api(model_api)

        response = self.client.post(f"/api/registry/versions/{version.id}/build-package/", {}, format="json")

        self.assertEqual(response.status_code, 200)
        adapter.trigger_build.assert_called_once()
        model_api.refresh_from_db()
        self.assertEqual(model_api.build_status, "building")

    def test_promote_endpoint_creates_production_alias(self):
        family = self._family(name="alias-family")
        model_api = self._deployed_model_api(name="alias-family", version="v1")
        version = self._version(family, version="v1", source_type="manual_upload", model_api=model_api)

        response = self.client.post(
            f"/api/registry/families/{family.id}/versions/{version.id}/promote/",
            {"alias": "production"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["success"])
        self.assertEqual(response.data["alias"]["alias_name"], "production")
        alias = ModelRoutingAlias.objects.get(tenant=self.user, family=family, alias_name="production")
        self.assertEqual(alias.target_version_id, version.id)
        family.refresh_from_db()
        self.assertEqual(family.current_production_version_id, version.id)

    def test_promoting_another_version_updates_existing_alias(self):
        family = self._family(name="alias-update-family")
        first_api = self._deployed_model_api(name="alias-update-family", version="v1")
        second_api = self._deployed_model_api(name="alias-update-family", version="v2")
        first = self._version(family, version="v1", source_type="manual_upload", model_api=first_api)
        second = self._version(family, version="v2", source_type="manual_upload", model_api=second_api)

        self.client.post(f"/api/registry/families/{family.id}/versions/{first.id}/promote/", {"alias": "production"}, format="json")
        response = self.client.post(f"/api/registry/families/{family.id}/versions/{second.id}/promote/", {"alias": "production"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(ModelRoutingAlias.objects.filter(tenant=self.user, family=family, alias_name="production").count(), 1)
        alias = ModelRoutingAlias.objects.get(tenant=self.user, family=family, alias_name="production")
        self.assertEqual(alias.target_version_id, second.id)

    def test_promote_invalid_alias_returns_400(self):
        family = self._family(name="alias-invalid-family")
        model_api = self._deployed_model_api(name="alias-invalid-family")
        version = self._version(family, source_type="manual_upload", model_api=model_api)

        response = self.client.post(
            f"/api/registry/families/{family.id}/versions/{version.id}/promote/",
            {"alias": "canary"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["reason_code"], "INVALID_ALIAS")

    def test_promote_version_without_endpoint_returns_409(self):
        family = self._family(name="alias-not-deployed-family")
        model_api = self._deployed_model_api(name="alias-not-deployed-family", endpoint_url="", endpoint_status="not_deployed")
        version = self._version(family, source_type="manual_upload", model_api=model_api, endpoint_url="")

        response = self.client.post(
            f"/api/registry/families/{family.id}/versions/{version.id}/promote/",
            {"alias": "production"},
            format="json",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["reason_code"], "VERSION_NOT_DEPLOYED")

    def test_cross_tenant_promote_denied(self):
        family = self._family(name="alias-tenant-family")
        model_api = self._deployed_model_api(name="alias-tenant-family")
        version = self._version(family, source_type="manual_upload", model_api=model_api)
        other_client = APIClient()
        other_client.force_authenticate(user=self.other_user)

        response = other_client.post(
            f"/api/registry/families/{family.id}/versions/{version.id}/promote/",
            {"alias": "production"},
            format="json",
        )

        self.assertEqual(response.status_code, 404)

    def test_version_outside_family_cannot_be_promoted(self):
        family = self._family(name="alias-family-a")
        other_family = self._family(name="alias-family-b")
        model_api = self._deployed_model_api(name="alias-family-b")
        version = self._version(other_family, source_type="manual_upload", model_api=model_api)

        response = self.client.post(
            f"/api/registry/families/{family.id}/versions/{version.id}/promote/",
            {"alias": "production"},
            format="json",
        )

        self.assertEqual(response.status_code, 404)

    def test_registry_serializers_include_routing_alias_fields(self):
        family = self._family(name="alias-serializer-family")
        model_api = self._deployed_model_api(name="alias-serializer-family")
        version = self._version(family, source_type="manual_upload", model_api=model_api)
        self.client.post(f"/api/registry/families/{family.id}/versions/{version.id}/promote/", {"alias": "production"}, format="json")

        detail = self.client.get(f"/api/registry/versions/{version.id}/")
        family_response = self.client.get(f"/api/registry/families/{family.id}/")

        self.assertEqual(detail.status_code, 200)
        self.assertTrue(detail.data["routing_alias_enabled"])
        self.assertTrue(detail.data["can_promote"])
        self.assertEqual(detail.data["routing_aliases"][0]["alias_name"], "production")
        self.assertEqual(family_response.status_code, 200)
        self.assertEqual(family_response.data["production_alias_version_id"], version.id)

    @override_settings(MODEL_SERVER_PUBLIC_URL="http://localhost:5000", MODEL_SERVER_INTERNAL_URL="http://traefik:5000")
    @patch("registry.views.requests.post")
    def test_alias_predict_endpoint_proxies_to_target(self, mock_post):
        family = self._family(name="alias-predict-family")
        self.user.api_key = "test-api-key"
        self.user.save(update_fields=["api_key"])
        model_api = self._deployed_model_api(name="alias-predict-family")
        version = self._version(family, source_type="manual_upload", model_api=model_api)
        self.client.post(f"/api/registry/families/{family.id}/versions/{version.id}/promote/", {"alias": "production"}, format="json")
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"prediction": 1, "success": True}
        mock_post.return_value = mock_response

        response = self.client.post(
            f"/api/registry/families/{family.id}/aliases/production/predict/",
            {"features": {"f1": 1}},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["prediction"], 1)
        mock_post.assert_called_once()
        self.assertEqual(mock_post.call_args.kwargs["json"], {"features": {"f1": 1}})
        self.assertEqual(mock_post.call_args.args[0], model_api.endpoint_url.replace("http://localhost:5000", "http://traefik:5000", 1))
        self.assertEqual(mock_post.call_args.kwargs["headers"], {"X-API-Key": "test-api-key"})

    @patch("registry.views.requests.post")
    def test_alias_predict_endpoint_returns_structured_502_when_unreachable(self, mock_post):
        family = self._family(name="alias-unreachable-family")
        model_api = self._deployed_model_api(name="alias-unreachable-family")
        version = self._version(family, source_type="manual_upload", model_api=model_api)
        self.client.post(f"/api/registry/families/{family.id}/versions/{version.id}/promote/", {"alias": "production"}, format="json")
        mock_post.side_effect = requests.exceptions.ConnectionError("HTTPConnectionPool raw detail")

        response = self.client.post(
            f"/api/registry/families/{family.id}/aliases/production/predict/",
            {"features": {"f1": 1}},
            format="json",
        )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.data["reason_code"], "ALIAS_TARGET_UNREACHABLE")
        self.assertEqual(response.data["message"], "Alias target endpoint is currently unreachable.")

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
        self.assertEqual(version.model_insights_summary["kind"], "feature_importance")
        self.assertEqual(version.model_insights_summary["items"][0]["name"], "packet_rate")
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
        self.assertTrue(response.data["has_model_insights"])
        self.assertEqual(response.data["model_insights_kind"], "feature_importance")
        self.assertEqual(response.data["model_insights_item_count"], 2)
        self.assertEqual(response.data["model_insights_summary"]["items"][0]["name"], "packet_rate")
        self.assertEqual(response.data["deployability_status"], "deployable")
        self.assertEqual(response.data["source_training_job_backend"], "aws_batch")
        self.assertEqual(response.data["mlflow_run_id"], "run-123")

    @override_settings(MLFLOW_UI_URL="http://localhost:5001")
    def test_registry_version_detail_uses_mlflow_ui_url_for_run_link(self):
        family = self._family(name="mlflow-link-family")
        version = self._version(
            family,
            version="v1",
            mlflow_run_id="run-123",
            mlflow_experiment_id="exp-1",
        )

        response = self.client.get(f"/api/registry/versions/{version.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["mlflow_run_url"],
            "http://localhost:5001/#/experiments/exp-1/runs/run-123",
        )

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

    @patch("registry.views.get_build_adapter")
    def test_deployable_version_can_build_package_wrapper(self, mock_get_build_adapter):
        adapter = Mock()
        mock_get_build_adapter.return_value = adapter
        job = self._completed_job()
        self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )
        version = ModelVersion.objects.get(family__tenant=self.user, family__name="nids-xgb", version="v2")

        response = self.client.post(f"/api/registry/versions/{version.id}/build-package/", {}, format="json")

        self.assertEqual(response.status_code, 200)
        adapter.trigger_build.assert_called_once()
        version.model_api.refresh_from_db()
        self.assertEqual(version.model_api.build_status, "building")

    def test_track_only_version_cannot_build_package(self):
        job = self._completed_job(deployability_status="track_only", deployability_reason="Only checkpoint files were found.")
        self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )
        version = ModelVersion.objects.get(family__tenant=self.user, family__name="nids-xgb", version="v2")

        response = self.client.post(f"/api/registry/versions/{version.id}/build-package/", {}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["deployability_status"], "track_only")

    def test_invalid_version_cannot_deploy(self):
        job = self._completed_job(deployability_status="invalid", deployability_reason="Artifact is corrupt.")
        self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )
        version = ModelVersion.objects.get(family__tenant=self.user, family__name="nids-xgb", version="v2")

        response = self.client.post(f"/api/registry/versions/{version.id}/deploy/", {}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["deployability_status"], "invalid")

    @patch("registry.views.get_deploy_adapter")
    def test_deployable_version_can_deploy_when_build_ready_without_mlflow_run(self, mock_get_deploy_adapter):
        adapter = Mock()
        mock_get_deploy_adapter.return_value = adapter
        job = self._completed_job(tracking_status="failed", mlflow_run_id="", mlflow_experiment_id="", mlflow_artifact_uri="")
        self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )
        version = ModelVersion.objects.get(family__tenant=self.user, family__name="nids-xgb", version="v2")
        version.model_api.build_status = "ready"
        version.model_api.endpoint_image_name = "tenant-model-id:latest"
        version.model_api.save(update_fields=["build_status", "endpoint_image_name", "updated_at"])

        response = self.client.post(f"/api/registry/versions/{version.id}/deploy/", {}, format="json")

        self.assertEqual(response.status_code, 200)
        adapter.deploy_model.assert_called_once()

    def test_smoke_test_rejects_missing_endpoint(self):
        job = self._completed_job()
        self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )
        version = ModelVersion.objects.get(family__tenant=self.user, family__name="nids-xgb", version="v2")
        version.model_api.endpoint_url = ""
        version.model_api.save(update_fields=["endpoint_url", "updated_at"])
        version.endpoint_url = ""
        version.save(update_fields=["endpoint_url", "updated_at"])

        response = self.client.post(
            f"/api/registry/versions/{version.id}/smoke-test/",
            {"features": {"f1": 1}},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("endpoint", response.data["error"].lower())

    @patch("registry.views.requests.post")
    def test_smoke_test_calls_endpoint_with_current_predict_schema(self, mock_post):
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"success": True, "prediction": "normal", "confidence": 0.91}
        mock_post.return_value = mock_response
        job = self._completed_job()
        self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )
        version = ModelVersion.objects.get(family__tenant=self.user, family__name="nids-xgb", version="v2")
        version.model_api.endpoint_url = "http://localhost:5000/T-1/models/m/v2/predict"
        version.model_api.save(update_fields=["endpoint_url", "updated_at"])

        response = self.client.post(
            f"/api/registry/versions/{version.id}/smoke-test/",
            {"features": {"f1": 1}},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        # resolve_smoke_test_url replaces public base with internal base when
        # MODEL_SERVER_INTERNAL_URL is configured (http://traefik:5000 in compose).
        from django.conf import settings
        internal_base = getattr(settings, "MODEL_SERVER_INTERNAL_URL", "").rstrip("/")
        public_base = getattr(settings, "MODEL_SERVER_PUBLIC_URL", "http://localhost:5000").rstrip("/")
        expected_url = "http://localhost:5000/T-1/models/m/v2/predict"
        if internal_base and expected_url.startswith(public_base):
            expected_url = expected_url.replace(public_base, internal_base, 1)
        mock_post.assert_called_once_with(
            expected_url,
            json={"features": {"f1": 1}},
            headers=ANY,
            timeout=15,
        )
        self.assertIn("X-API-Key", mock_post.call_args.kwargs["headers"])
        self.assertEqual(response.data["prediction"], "normal")

    @patch("registry.views.get_deploy_adapter")
    def test_health_check_missing_endpoint_returns_friendly_response(self, mock_get_deploy_adapter):
        adapter = Mock()
        adapter.check_health.return_value = (
            False,
            {
                "success": False,
                "status": "not_running",
                "reason_code": "ENDPOINT_CONTAINER_NOT_FOUND",
                "message": "The model endpoint container is not running in the local Docker network.",
                "endpoint_url": "http://localhost:5000/T-1/models/m/v2/predict",
                "internal_url": "http://endpoint_t-1_model_m:5000/models/m/health",
                "technical_detail": "HTTPConnectionPool(host='endpoint_t-1_model_m')",
            },
        )
        mock_get_deploy_adapter.return_value = adapter
        job = self._completed_job()
        self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )
        version = ModelVersion.objects.get(family__tenant=self.user, family__name="nids-xgb", version="v2")
        version.model_api.endpoint_url = "http://localhost:5000/T-1/models/m/v2/predict"
        version.model_api.save(update_fields=["endpoint_url", "updated_at"])

        response = self.client.post(f"/api/registry/versions/{version.id}/check-health/", {}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["reason_code"], "ENDPOINT_CONTAINER_NOT_FOUND")
        self.assertIn("not running", response.data["message"])
        self.assertNotIn("HTTPConnectionPool", response.data["message"])
        self.assertIn("HTTPConnectionPool", response.data["technical_detail"])
        version.model_api.refresh_from_db()
        self.assertEqual(version.model_api.endpoint_status, "unhealthy")
        self.assertNotIn("HTTPConnectionPool", version.model_api.endpoint_error)

    @patch("registry.views.requests.post")
    def test_smoke_test_missing_endpoint_returns_friendly_response(self, mock_post):
        mock_post.side_effect = requests.exceptions.ConnectionError(
            "HTTPConnectionPool(host='endpoint_t-1_model_m'): Max retries exceeded with url: /predict "
            "(Caused by NameResolutionError(\"failed to resolve\"))"
        )
        job = self._completed_job()
        self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )
        version = ModelVersion.objects.get(family__tenant=self.user, family__name="nids-xgb", version="v2")
        version.model_api.endpoint_url = "http://localhost:5000/T-1/models/m/v2/predict"
        version.model_api.save(update_fields=["endpoint_url", "updated_at"])

        response = self.client.post(
            f"/api/registry/versions/{version.id}/smoke-test/",
            {"features": {"f1": 1}},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["success"])
        self.assertEqual(response.data["reason_code"], "ENDPOINT_CONTAINER_NOT_FOUND")
        self.assertIn("not running", response.data["message"])
        self.assertNotIn("HTTPConnectionPool", response.data["message"])
        self.assertIn("HTTPConnectionPool", response.data["technical_detail"])

    def test_cross_tenant_build_denied(self):
        job = self._completed_job()
        self.client.post(
            f"/api/training/jobs/{job.id}/register-model/",
            {"model_name": "nids-xgb", "model_version": "v2", "flavor": "sklearn"},
            format="json",
        )
        version = ModelVersion.objects.get(family__tenant=self.user, family__name="nids-xgb", version="v2")
        other_client = APIClient()
        other_client.force_authenticate(user=self.other_user)

        response = other_client.post(f"/api/registry/versions/{version.id}/build-package/", {}, format="json")

        self.assertEqual(response.status_code, 404)

    def test_compare_endpoint_requires_auth(self):
        family = self._family()
        left = self._version(family, "v1")
        right = self._version(family, "v2")
        client = APIClient()

        response = client.get(f"/api/registry/families/{family.id}/compare/?left={left.id}&right={right.id}")

        self.assertEqual(response.status_code, 401)

    def test_compare_metrics_diff_and_winner(self):
        family = self._family()
        left = self._version(family, "v1", metrics_summary={"accuracy": 0.91})
        right = self._version(family, "v2", metrics_summary={"accuracy": 0.94})

        response = self.client.get(f"/api/registry/families/{family.id}/compare/?left={left.id}&right={right.id}")

        self.assertEqual(response.status_code, 200)
        accuracy = next(item for item in response.data["metrics_diff"] if item["name"] == "accuracy")
        self.assertAlmostEqual(accuracy["delta"], 0.03)
        self.assertEqual(accuracy["winner"], "right")
        self.assertEqual(response.data["recommendation"]["winner"], "right")

    def test_compare_loss_uses_lower_is_better(self):
        family = self._family()
        left = self._version(family, "v1", metrics_summary={"loss": 0.2})
        right = self._version(family, "v2", metrics_summary={"loss": 0.5})

        response = self.client.get(f"/api/registry/families/{family.id}/compare/?left={left.id}&right={right.id}")

        self.assertEqual(response.status_code, 200)
        loss = next(item for item in response.data["metrics_diff"] if item["name"] == "loss")
        self.assertEqual(loss["winner"], "left")

    def test_compare_params_and_artifacts_diff(self):
        family = self._family()
        left = self._version(
            family,
            "v1",
            params_summary={"n_estimators": 100, "max_depth": 4},
            artifact_manifest=[
                {"path": "model.pkl", "kind": "model", "size_bytes": 100, "sha256": "a" * 64},
                {"path": "old.txt", "kind": "metadata", "size_bytes": 10, "sha256": "o" * 64},
                {"path": "same.json", "kind": "metadata", "size_bytes": 5, "sha256": "s" * 64},
            ],
        )
        right = self._version(
            family,
            "v2",
            params_summary={"n_estimators": 200},
            artifact_manifest=[
                {"path": "model.pkl", "kind": "model", "size_bytes": 200, "sha256": "b" * 64},
                {"path": "new.txt", "kind": "metadata", "size_bytes": 10, "sha256": "n" * 64},
                {"path": "same.json", "kind": "metadata", "size_bytes": 5, "sha256": "s" * 64},
            ],
        )

        response = self.client.get(f"/api/registry/families/{family.id}/compare/?left={left.id}&right={right.id}")

        self.assertEqual(response.status_code, 200)
        params = {item["name"]: item for item in response.data["params_diff"]}
        self.assertTrue(params["n_estimators"]["changed"])
        self.assertEqual(params["max_depth"]["only_in"], "left")
        self.assertEqual(len(response.data["artifact_diff"]["added"]), 1)
        self.assertEqual(len(response.data["artifact_diff"]["removed"]), 1)
        self.assertEqual(len(response.data["artifact_diff"]["changed"]), 1)
        self.assertEqual(response.data["artifact_diff"]["unchanged_count"], 1)

    def test_compare_warns_when_better_version_is_track_only(self):
        family = self._family()
        left = self._version(family, "v1", metrics_summary={"accuracy": 0.90})
        right = self._version(
            family,
            "v2",
            metrics_summary={"accuracy": 0.95},
            deployability_status="track_only",
            deployability_reason="No supported serving artifact found.",
        )

        response = self.client.get(f"/api/registry/families/{family.id}/compare/?left={left.id}&right={right.id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["recommendation"]["winner"], "right")
        self.assertIn("not deployable", response.data["recommendation"]["warnings"][0])

    def test_compare_empty_metrics_returns_unknown_winner_without_mlflow(self):
        family = self._family()
        left = self._version(family, "v1", metrics_summary={}, mlflow_run_id="")
        right = self._version(family, "v2", metrics_summary={}, mlflow_run_id="")

        response = self.client.get(f"/api/registry/families/{family.id}/compare/?left={left.id}&right={right.id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["recommendation"]["winner"], "unknown")

    def test_compare_rejects_different_families_and_cross_tenant(self):
        family = self._family()
        other_family = self._family(name="other-family")
        left = self._version(family, "v1")
        right = self._version(other_family, "v2")

        response = self.client.get(f"/api/registry/families/{family.id}/compare/?left={left.id}&right={right.id}")

        self.assertEqual(response.status_code, 404)

        other_tenant_family = self._family(tenant=self.other_user, name="nids-xgb")
        other_version = self._version(other_tenant_family, "v3")
        response = self.client.get(f"/api/registry/families/{other_tenant_family.id}/compare/?left={left.id}&right={other_version.id}")
        self.assertEqual(response.status_code, 404)

    def test_compare_same_version_rejected(self):
        family = self._family()
        left = self._version(family, "v1")

        response = self.client.get(f"/api/registry/families/{family.id}/compare/?left={left.id}&right={left.id}")

        self.assertEqual(response.status_code, 400)


class DriftSummaryInVersionDetailTests(TestCase):
    """Tests for drift_summary injected into GET /api/registry/versions/<id>/."""

    def setUp(self):
        self.user = CustomUser.objects.create_user(email="drift-tenant@example.com", password="pass")
        self.other_user = CustomUser.objects.create_user(email="drift-other@example.com", password="pass")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _make_model_api(self, user=None, name="nids-drift", version="v1"):
        return ModelAPI.objects.create(
            tenant=user or self.user,
            name=name,
            version=version,
            status="ready",
            build_status="ready",
            access_mode="private",
            flavor="xgboost",
        )

    def _make_family_and_version(self, model_api, user=None):
        tenant = user or self.user
        family, _ = ModelFamily.objects.get_or_create(
            tenant=tenant,
            name=model_api.name,
            defaults={"display_name": model_api.name},
        )
        version = ModelVersion.objects.create(
            tenant=tenant,
            family=family,
            version=model_api.version or "v1",
            model_api=model_api,
            source_type="manual_upload",
            stage="candidate",
            deployability_status="deployable",
        )
        return family, version

    def _make_drift_job(self, model_api):
        return DriftMonitoringJob.objects.create(
            tenant=model_api.tenant,
            model_api=model_api,
            trigger_threshold=1000,
            status="active",
        )

    def _make_drift_result(self, job, drift_score=0.235, dataset_drift=True, report_url="s3://bucket/report.html"):
        return DriftMonitoringResult.objects.create(
            job=job,
            drift_score=drift_score,
            dataset_drift=dataset_drift,
            report_url=report_url,
            drifted_features_count=12,
            total_features=52,
        )

    # ------------------------------------------------------------------
    # Test: not_configured when no drift job exists
    # ------------------------------------------------------------------
    def test_drift_summary_not_configured_when_no_job(self):
        model_api = self._make_model_api()
        _family, version = self._make_family_and_version(model_api)

        response = self.client.get(f"/api/registry/versions/{version.id}/")

        self.assertEqual(response.status_code, 200)
        ds = response.data["drift_summary"]
        self.assertFalse(ds["configured"])
        self.assertEqual(ds["status"], "not_configured")
        self.assertIsNone(ds["drift_percent"])
        self.assertIsNone(ds["drift_score"])
        self.assertIsNone(ds["latest_result_id"])

    # ------------------------------------------------------------------
    # Test: healthy when dataset_drift=False
    # ------------------------------------------------------------------
    def test_drift_summary_healthy_when_dataset_drift_false(self):
        model_api = self._make_model_api(name="nids-healthy")
        _family, version = self._make_family_and_version(model_api)
        job = self._make_drift_job(model_api)
        self._make_drift_result(job, drift_score=0.05, dataset_drift=False, report_url="s3://bucket/healthy.html")

        response = self.client.get(f"/api/registry/versions/{version.id}/")

        self.assertEqual(response.status_code, 200)
        ds = response.data["drift_summary"]
        self.assertTrue(ds["configured"])
        self.assertEqual(ds["status"], "healthy")
        self.assertEqual(ds["drift_percent"], 5.0)
        self.assertFalse(ds["dataset_drift"])

    # ------------------------------------------------------------------
    # Test: drift_detected when dataset_drift=True
    # ------------------------------------------------------------------
    def test_drift_summary_drift_detected_when_dataset_drift_true(self):
        model_api = self._make_model_api(name="nids-drifted")
        _family, version = self._make_family_and_version(model_api)
        job = self._make_drift_job(model_api)
        self._make_drift_result(job, drift_score=0.235, dataset_drift=True, report_url="s3://bucket/drifted.html")

        response = self.client.get(f"/api/registry/versions/{version.id}/")

        self.assertEqual(response.status_code, 200)
        ds = response.data["drift_summary"]
        self.assertTrue(ds["configured"])
        self.assertEqual(ds["status"], "drift_detected")
        self.assertTrue(ds["dataset_drift"])
        self.assertEqual(ds["drift_percent"], 23.5)

    # ------------------------------------------------------------------
    # Test: percent conversion — score 0.235 → 23.5
    # ------------------------------------------------------------------
    def test_drift_percent_conversion_score_0_to_1_range(self):
        model_api = self._make_model_api(name="nids-pct-low")
        _family, version = self._make_family_and_version(model_api)
        job = self._make_drift_job(model_api)
        self._make_drift_result(job, drift_score=0.235, dataset_drift=True, report_url="s3://b/r.html")

        response = self.client.get(f"/api/registry/versions/{version.id}/")

        ds = response.data["drift_summary"]
        self.assertEqual(ds["drift_percent"], 23.5)
        self.assertAlmostEqual(ds["drift_score"], 0.235)

    # ------------------------------------------------------------------
    # Test: percent conversion — score 23.5 stays 23.5
    # ------------------------------------------------------------------
    def test_drift_score_already_percent_range(self):
        model_api = self._make_model_api(name="nids-pct-high")
        _family, version = self._make_family_and_version(model_api)
        job = self._make_drift_job(model_api)
        self._make_drift_result(job, drift_score=23.5, dataset_drift=True, report_url="s3://b/r.html")

        response = self.client.get(f"/api/registry/versions/{version.id}/")

        ds = response.data["drift_summary"]
        self.assertEqual(ds["drift_percent"], 23.5)
        self.assertEqual(ds["drift_score"], 23.5)

    # ------------------------------------------------------------------
    # Test: missing report_url returns report_unavailable
    # ------------------------------------------------------------------
    def test_missing_report_url_returns_report_unavailable(self):
        model_api = self._make_model_api(name="nids-no-report")
        _family, version = self._make_family_and_version(model_api)
        job = self._make_drift_job(model_api)
        self._make_drift_result(job, drift_score=0.3, dataset_drift=True, report_url="")

        response = self.client.get(f"/api/registry/versions/{version.id}/")

        self.assertEqual(response.status_code, 200)
        ds = response.data["drift_summary"]
        self.assertTrue(ds["configured"])
        self.assertEqual(ds["status"], "report_unavailable")
        self.assertIsNone(ds["report_url"])

    # ------------------------------------------------------------------
    # Test: report_page_url is always included
    # ------------------------------------------------------------------
    def test_report_page_url_included(self):
        model_api = self._make_model_api(name="nids-page-url")
        _family, version = self._make_family_and_version(model_api)
        job = self._make_drift_job(model_api)
        self._make_drift_result(job)

        response = self.client.get(f"/api/registry/versions/{version.id}/")

        ds = response.data["drift_summary"]
        self.assertIn("report_page_url", ds)
        self.assertIsNotNone(ds["report_page_url"])
        self.assertIn("/dashboard/drift-monitoring/", ds["report_page_url"])

    # ------------------------------------------------------------------
    # Test: tenant isolation — other tenant's version returns 404
    # ------------------------------------------------------------------
    def test_tenant_isolation_other_tenant_version_not_visible(self):
        other_model_api = self._make_model_api(user=self.other_user, name="nids-other")
        other_family, other_version = self._make_family_and_version(other_model_api, user=self.other_user)

        response = self.client.get(f"/api/registry/versions/{other_version.id}/")

        self.assertEqual(response.status_code, 404)

    # ------------------------------------------------------------------
    # Test: no drift_job → version detail still returns 200 (not 500)
    # ------------------------------------------------------------------
    def test_no_drift_job_does_not_500(self):
        model_api = self._make_model_api(name="nids-no-500")
        _family, version = self._make_family_and_version(model_api)
        # Intentionally no DriftMonitoringJob

        response = self.client.get(f"/api/registry/versions/{version.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("drift_summary", response.data)
        self.assertEqual(response.data["drift_summary"]["status"], "not_configured")
