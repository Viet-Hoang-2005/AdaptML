from django.core.management.base import BaseCommand
from django.utils import timezone

from authentication.models import ModelAPI


class Command(BaseCommand):
    help = "Mark stale ModelAPI builds stuck in building as failed."

    def add_arguments(self, parser):
        parser.add_argument("--model-id", type=int, help="Only reset one ModelAPI id.")
        parser.add_argument(
            "--message",
            default="Build callback failed or timed out. Please rebuild.",
            help="build_error message to store.",
        )

    def handle(self, *args, **options):
        queryset = ModelAPI.objects.filter(build_status="building")
        model_id = options.get("model_id")
        if model_id:
            queryset = queryset.filter(id=model_id)

        message = options["message"]
        updated = queryset.update(
            status="error",
            build_status="error",
            error_message="Model build failed.",
            build_error=message,
            updated_at=timezone.now(),
        )
        self.stdout.write(self.style.SUCCESS(f"Reset {updated} stuck model build(s)."))
