from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0026_trainingjob_tracking_ingestion_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="modelversion",
            name="training_summary",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="modelversion",
            name="metrics_summary",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="modelversion",
            name="params_summary",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="modelversion",
            name="artifact_manifest",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="modelversion",
            name="tracking_status",
            field=models.CharField(blank=True, default="", max_length=30),
        ),
        migrations.AddField(
            model_name="modelversion",
            name="tracking_error",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="modelversion",
            name="tracking_ingested_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="modelversion",
            name="deployability_status",
            field=models.CharField(blank=True, default="unknown", max_length=30),
        ),
        migrations.AddField(
            model_name="modelversion",
            name="deployability_reason",
            field=models.TextField(blank=True),
        ),
    ]
