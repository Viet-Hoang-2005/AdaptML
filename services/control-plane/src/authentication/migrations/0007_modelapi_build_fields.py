import authentication.models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0006_modelapi"),
    ]

    operations = [
        migrations.AddField(
            model_name="modelapi",
            name="source_artifact",
            field=models.FileField(
                blank=True,
                null=True,
                upload_to=authentication.models.model_source_artifact_path,
            ),
        ),
        migrations.AddField(
            model_name="modelapi",
            name="flavor",
            field=models.CharField(blank=True, max_length=40),
        ),
        migrations.AddField(
            model_name="modelapi",
            name="requirements_text",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="modelapi",
            name="package_manifest",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="modelapi",
            name="package_preview_tree",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="modelapi",
            name="build_status",
            field=models.CharField(
                choices=[
                    ("not_started", "Not Started"),
                    ("building", "Building"),
                    ("ready", "Ready"),
                    ("error", "Error"),
                ],
                default="not_started",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="modelapi",
            name="build_error",
            field=models.TextField(blank=True),
        ),
    ]
