# Merge migration: integrate chore/optimize-model-deploy (reference_data_file, source_code_file)
# with the existing 0019 endpoint/userapikey merge head.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("authentication", "0019_merge_modelapi_endpoint_userapikey_scope"),
        ("authentication", "0018_modelapi_reference_data_file_and_more"),
    ]

    operations = []
