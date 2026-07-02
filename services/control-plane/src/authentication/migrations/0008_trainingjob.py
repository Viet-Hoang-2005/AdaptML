import authentication.models
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0007_modelapi_build_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="TrainingJob",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=160)),
                ("model_version", models.CharField(max_length=80)),
                ("entry_point", models.CharField(default="train.py", max_length=160)),
                (
                    "source_zip",
                    models.FileField(
                        storage=authentication.models.training_upload_storage,
                        upload_to="",
                    ),
                ),
                (
                    "requirements_file",
                    models.FileField(
                        blank=True,
                        null=True,
                        storage=authentication.models.training_upload_storage,
                        upload_to="",
                    ),
                ),
                (
                    "training_data",
                    models.FileField(
                        storage=authentication.models.training_upload_storage,
                        upload_to="",
                    ),
                ),
                ("s3_source_uri", models.CharField(blank=True, max_length=1024)),
                ("s3_training_data_uri", models.CharField(blank=True, max_length=1024)),
                ("sagemaker_job_name", models.CharField(blank=True, max_length=160)),
                ("output_s3_uri", models.CharField(blank=True, max_length=1024)),
                ("model_artifact_uri", models.CharField(blank=True, max_length=1024)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("uploading", "Uploading"),
                            ("running", "Running"),
                            ("completed", "Completed"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("error_message", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "tenant",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="training_jobs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-updated_at"],
                "indexes": [
                    models.Index(fields=["tenant", "status"], name="authenticat_trainin_57fd0f_idx"),
                    models.Index(fields=["tenant", "model_version"], name="authenticat_trainin_5cba8b_idx"),
                ],
            },
        ),
    ]
