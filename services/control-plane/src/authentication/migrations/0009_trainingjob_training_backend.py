from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0008_trainingjob"),
    ]

    operations = [
        migrations.AddField(
            model_name="trainingjob",
            name="training_backend",
            field=models.CharField(
                choices=[("sagemaker", "SageMaker"), ("local", "Local")],
                default="sagemaker",
                max_length=20,
            ),
        ),
    ]
