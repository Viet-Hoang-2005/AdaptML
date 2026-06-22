from django.core.management.base import BaseCommand
from authentication.models import ModelVersion
from orchestration.registry_service import sync_metrics_for_version

class Command(BaseCommand):
    help = "Parse METRIC_JSON from TrainingJob logs and backfill ModelMetric for all ModelVersions."

    def handle(self, *args, **options):
        self.stdout.write("Starting metrics backfill...")
        versions = ModelVersion.objects.exclude(source_training_job__isnull=True)
        
        total_created = 0
        for ver in versions:
            created = sync_metrics_for_version(ver)
            total_created += created

        self.stdout.write(self.style.SUCCESS(f"Successfully ingested {total_created} metrics into ModelMetric."))
