from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0009_trainingjob_training_backend"),
    ]

    operations = [
        migrations.AddField(
            model_name="trainingjob",
            name="external_job_id",
            field=models.CharField(blank=True, max_length=160),
        ),
        migrations.AlterField(
            model_name="trainingjob",
            name="training_backend",
            field=models.CharField(
                choices=[
                    ("sagemaker", "SageMaker"),
                    ("local", "Local"),
                    ("aws_batch", "AWS Batch"),
                ],
                default="sagemaker",
                max_length=20,
            ),
        ),
    ]
