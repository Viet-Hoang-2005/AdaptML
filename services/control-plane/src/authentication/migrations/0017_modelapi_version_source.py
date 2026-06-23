from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0016_merge_modelapi_trainingjob_heads"),
    ]

    operations = [
        migrations.AddField(
            model_name="modelapi",
            name="source_artifact_uri",
            field=models.CharField(blank=True, max_length=1024),
        ),
        migrations.AddField(
            model_name="modelapi",
            name="source_type",
            field=models.CharField(
                choices=[
                    ("manual_upload", "Manual Upload"),
                    ("training_job", "Training Job"),
                ],
                default="manual_upload",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="modelapi",
            name="version",
            field=models.CharField(default="v1", max_length=80),
        ),
        migrations.AddField(
            model_name="modelapi",
            name="source_training_job",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="registered_model_apis",
                to="authentication.trainingjob",
            ),
        ),
        migrations.AddIndex(
            model_name="modelapi",
            index=models.Index(
                fields=["tenant", "name", "version"],
                name="authenticat_model_v_lookup_idx",
            ),
        ),
    ]
