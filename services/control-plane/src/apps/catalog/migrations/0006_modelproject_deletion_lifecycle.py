from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("catalog", "0005_modelbuildmetadata_artifact_format")]

    operations = [
        migrations.AddField(
            model_name="modelproject",
            name="deletion_state",
            field=models.CharField(
                choices=[
                    ("active", "Active"),
                    ("deleting", "Deleting"),
                    ("deleted", "Deleted"),
                    ("delete_failed", "Delete Failed"),
                ],
                default="active",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="modelproject",
            name="deletion_error",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="modelproject",
            name="deletion_task_id",
            field=models.CharField(blank=True, db_index=True, max_length=255),
        ),
        migrations.AddField(
            model_name="modelproject",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
