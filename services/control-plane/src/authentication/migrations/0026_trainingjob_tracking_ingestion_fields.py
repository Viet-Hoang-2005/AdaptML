from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0025_merge_drift_model_evolution"),
    ]

    operations = [
        migrations.AddField(
            model_name="trainingjob",
            name="tracking_status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("ingesting", "Ingesting"),
                    ("completed", "Completed"),
                    ("failed", "Failed"),
                    ("skipped", "Skipped"),
                ],
                default="pending",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="trainingjob",
            name="tracking_error",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="trainingjob",
            name="tracking_ingested_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="trainingjob",
            name="training_summary",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="trainingjob",
            name="metrics_summary",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="trainingjob",
            name="params_summary",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="trainingjob",
            name="artifact_manifest",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="trainingjob",
            name="deployability_status",
            field=models.CharField(
                choices=[
                    ("unknown", "Unknown"),
                    ("deployable", "Deployable"),
                    ("track_only", "Track Only"),
                    ("invalid", "Invalid"),
                ],
                default="unknown",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="trainingjob",
            name="deployability_reason",
            field=models.TextField(blank=True),
        ),
    ]
