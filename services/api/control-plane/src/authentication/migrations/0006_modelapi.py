from django.conf import settings
from django.db import migrations, models
import authentication.models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0005_alter_customuser_avatar_alter_useravatar_image"),
    ]

    operations = [
        migrations.CreateModel(
            name="ModelAPI",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=160)),
                ("description", models.TextField(blank=True)),
                ("model_info", models.TextField(blank=True)),
                (
                    "access_mode",
                    models.CharField(
                        choices=[("private", "Private"), ("public", "Public")],
                        default="private",
                        max_length=20,
                    ),
                ),
                (
                    "artifact",
                    models.FileField(
                        blank=True,
                        null=True,
                        upload_to=authentication.models.model_artifact_path,
                    ),
                ),
                ("model_uri", models.CharField(blank=True, max_length=1024)),
                ("endpoint_url", models.CharField(blank=True, max_length=1024)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("ready", "Ready"),
                            ("uploading", "Uploading"),
                            ("error", "Error"),
                            ("disabled", "Disabled"),
                        ],
                        default="ready",
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
                        related_name="model_apis",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-updated_at"],
            },
        ),
        migrations.AddIndex(
            model_name="modelapi",
            index=models.Index(fields=["tenant", "status"], name="authenticat_tenant__dcb6f3_idx"),
        ),
        migrations.AddIndex(
            model_name="modelapi",
            index=models.Index(fields=["tenant", "access_mode"], name="authenticat_tenant__e54007_idx"),
        ),
    ]
