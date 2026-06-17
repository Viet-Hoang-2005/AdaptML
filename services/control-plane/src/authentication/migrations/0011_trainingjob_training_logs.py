from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0010_trainingjob_external_job_id_and_aws_batch"),
    ]

    operations = [
        migrations.AddField(
            model_name="trainingjob",
            name="training_logs",
            field=models.TextField(blank=True),
        ),
    ]
