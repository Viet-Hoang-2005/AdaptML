import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

import runner


class RunnerMetadataBundleTests(unittest.TestCase):
    def test_training_artifacts_require_presigned_http_urls(self):
        runner.validate_presigned_url("https://bucket.s3.amazonaws.com/object?signature=example")

        with self.assertRaisesRegex(RuntimeError, "presigned HTTP"):
            runner.validate_presigned_url("s3://mlops-paas-artifacts/input/source.zip")

    def test_mlflow_artifact_uri_is_proxied_through_tracking_server(self):
        uri = runner.mlflow_proxy_artifact_uri(
            "s3://mlops-paas-artifacts/users/T-user/models/project/training/jobs/job/mlflow/"
        )

        self.assertEqual(
            uri,
            "mlflow-artifacts:/users/T-user/models/project/training/jobs/job/mlflow/",
        )

    def test_mlflow_artifact_uri_requires_s3_location(self):
        with self.assertRaisesRegex(RuntimeError, "Invalid S3 URI"):
            runner.mlflow_proxy_artifact_uri("https://example.test/artifacts")

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp())
        self.original_paths = {
            "SOURCE_DIR": runner.SOURCE_DIR,
            "INPUT_TRAIN_DIR": runner.INPUT_TRAIN_DIR,
            "MODEL_DIR": runner.MODEL_DIR,
            "OUTPUT_DIR": runner.OUTPUT_DIR,
        }
        runner.SOURCE_DIR = self.tmpdir / "source"
        runner.INPUT_TRAIN_DIR = self.tmpdir / "input" / "train"
        runner.MODEL_DIR = self.tmpdir / "model"
        runner.OUTPUT_DIR = self.tmpdir / "output"
        runner.SOURCE_DIR.mkdir(parents=True)
        runner.INPUT_TRAIN_DIR.mkdir(parents=True)
        runner.MODEL_DIR.mkdir(parents=True)
        runner.OUTPUT_DIR.mkdir(parents=True)

    def tearDown(self):
        for name, path in self.original_paths.items():
            setattr(runner, name, path)
        shutil.rmtree(self.tmpdir)

    def test_writes_mlops_bundle_and_manifest(self):
        model_path = runner.MODEL_DIR / "model.pkl"
        model_path.write_bytes(b"demo-model")
        (runner.OUTPUT_DIR / "metrics.json").write_text(
            json.dumps({"accuracy": 0.99, "loss": 0.05, "note": "ignored"}),
            encoding="utf-8",
        )
        (runner.OUTPUT_DIR / "params.json").write_text(
            json.dumps({"n_estimators": 10, "nested": {"enabled": True}}),
            encoding="utf-8",
        )
        (runner.OUTPUT_DIR / "feature_importance.json").write_text(
            json.dumps({"feature_importance": {"duration": 0.25, "packet_rate": 0.75}}),
            encoding="utf-8",
        )
        stdout_text = "\n".join(
            [
                "starting",
                'METRIC_JSON:{"accuracy":0.1,"precision":0.8}',
                "METRIC_JSON:not-json",
            ]
        )
        stderr_text = "warning on stderr"

        runner.write_mlops_bundle(
            entry_point="train.py",
            model_version="v1",
            training_job_id="job-1",
            status="succeeded",
            stdout_text=stdout_text,
            stderr_text=stderr_text,
        )

        mlops_dir = runner.MODEL_DIR / "_mlops"
        self.assertTrue((mlops_dir / "training_summary.json").exists())
        self.assertTrue((mlops_dir / "metrics.json").exists())
        self.assertTrue((mlops_dir / "params.json").exists())
        self.assertTrue((mlops_dir / "model_insights.json").exists())
        self.assertTrue((mlops_dir / "metric_events.jsonl").exists())
        self.assertEqual((mlops_dir / "stdout.txt").read_text(encoding="utf-8"), stdout_text)
        self.assertEqual((mlops_dir / "stderr.txt").read_text(encoding="utf-8"), stderr_text)

        metrics = json.loads((mlops_dir / "metrics.json").read_text(encoding="utf-8"))
        self.assertEqual(metrics["accuracy"], 0.99)
        self.assertEqual(metrics["precision"], 0.8)
        self.assertEqual(metrics["loss"], 0.05)
        self.assertNotIn("note", metrics)

        params = json.loads((mlops_dir / "params.json").read_text(encoding="utf-8"))
        self.assertEqual(params["n_estimators"], 10)
        self.assertEqual(params["nested"]["enabled"], True)

        insights = json.loads((mlops_dir / "model_insights.json").read_text(encoding="utf-8"))
        self.assertEqual(insights["schema_version"], "model-insights-v1")
        self.assertEqual(insights["kind"], "feature_importance")
        self.assertEqual(insights["items"][0]["name"], "packet_rate")
        self.assertEqual(insights["items"][0]["rank"], 1)

        warnings = json.loads((mlops_dir / "warnings.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(warnings), 2)
        self.assertTrue(any(item["code"] == "invalid_metric_json" for item in warnings))
        self.assertTrue(any(item["code"] == "non_numeric_metric_ignored" for item in warnings))

        events = (mlops_dir / "metric_events.jsonl").read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(events), 1)

        manifest = json.loads((mlops_dir / "artifact_manifest.json").read_text(encoding="utf-8"))
        model_entries = [item for item in manifest if item["path"] == "model.pkl"]
        insight_entries = [item for item in manifest if item["path"] == "_mlops/model_insights.json"]
        self.assertEqual(len(model_entries), 1)
        self.assertEqual(len(insight_entries), 1)
        self.assertEqual(model_entries[0]["kind"], "model")
        self.assertEqual(model_entries[0]["size_bytes"], len(b"demo-model"))
        self.assertEqual(len(model_entries[0]["sha256"]), 64)

        summary = json.loads((mlops_dir / "training_summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["runner_version"], runner.RUNNER_VERSION)
        self.assertEqual(summary["status"], "succeeded")
        self.assertEqual(summary["metrics"]["accuracy"], 0.99)
        self.assertGreater(summary["artifact_count"], 0)
        self.assertEqual(summary["warnings_count"], len(warnings))

    def test_failed_user_script_preserves_logs_and_status(self):
        script_path = runner.SOURCE_DIR / "fail.py"
        script_path.write_text(
            "import sys\nprint('hello stdout')\nprint('bad stderr', file=sys.stderr)\nsys.exit(3)\n",
            encoding="utf-8",
        )
        os.environ["AWS_BUCKET_NAME"] = "unit-test-bucket"

        result = runner.run_training("fail.py", "v1")
        self.assertEqual(result.returncode, 3)
        self.assertIn("hello stdout", result.stdout)
        self.assertIn("bad stderr", result.stderr)

        runner.write_mlops_bundle(
            entry_point="fail.py",
            model_version="v1",
            training_job_id="job-fail",
            status="failed",
            stdout_text=result.stdout,
            stderr_text=result.stderr,
        )

        summary = json.loads((runner.MODEL_DIR / "_mlops" / "training_summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["status"], "failed")
        self.assertIn("hello stdout", (runner.MODEL_DIR / "_mlops" / "stdout.txt").read_text(encoding="utf-8"))
        self.assertIn("bad stderr", (runner.MODEL_DIR / "_mlops" / "stderr.txt").read_text(encoding="utf-8"))

    def test_example_requirements_do_not_require_mlflow(self):
        repo_root = None
        for parent in Path(__file__).resolve().parents:
            if (parent / "examples" / "training" / "deployable-sklearn").exists():
                repo_root = parent
                break
        if repo_root is None:
            self.skipTest("Repository root with examples directory is not mounted.")
        requirements = repo_root / "examples" / "training" / "deployable-sklearn" / "requirements.txt"
        if requirements.exists():
            self.assertNotIn("mlflow", requirements.read_text(encoding="utf-8").lower())


if __name__ == "__main__":
    unittest.main()
