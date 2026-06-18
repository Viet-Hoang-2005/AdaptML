from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0011_trainingjob_training_logs"),
    ]

    operations = [
        migrations.AddField(
            model_name="trainingjob",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="trainingjob",
            index=models.Index(fields=["tenant", "deleted_at"], name="authenticat_trainin_6a33d7_idx"),
        ),
    ]
