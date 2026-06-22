from django.core.management.base import BaseCommand
from authentication.models import ModelAPI
from orchestration.registry_service import sync_model_registry_for_model_api, record_history

class Command(BaseCommand):
    help = "Backfill ModelRegistry (ModelFamily and ModelVersion) from existing ModelAPI records."

    def handle(self, *args, **options):
        self.stdout.write("Starting ModelRegistry backfill...")
        models = ModelAPI.objects.exclude(status="disabled").order_by("created_at")
        
        count = 0
        for model in models:
            fam, ver = sync_model_registry_for_model_api(model)
            
            # Record an initial history event if none exists
            if not ver.history.exists():
                record_history(ver, "registered", actor="System (Backfill)")
                
                if model.build_status == "ready":
                    record_history(ver, "built", actor="System (Backfill)")
                
                if model.endpoint_status == "healthy":
                    record_history(ver, "deployed", actor="System (Backfill)")
                    
            count += 1

        self.stdout.write(self.style.SUCCESS(f"Successfully backfilled {count} ModelAPI records into ModelRegistry."))
