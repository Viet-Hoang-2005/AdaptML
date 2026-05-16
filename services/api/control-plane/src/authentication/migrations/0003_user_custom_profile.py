from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0002_user_api_key"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="company",
            field=models.CharField(blank=True, max_length=150, null=True),
        ),
        migrations.AddField(
            model_name="customuser",
            name="description",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="customuser",
            name="pronouns",
            field=models.CharField(blank=True, max_length=30, null=True),
        ),
    ]
