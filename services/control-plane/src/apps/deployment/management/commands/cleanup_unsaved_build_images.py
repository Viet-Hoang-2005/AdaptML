from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.deployment.services.builds import discard_ready_unsaved_build, expired_unsaved_build_ids


class Command(BaseCommand):
    help = "Delete ready build images that were neither saved nor deployed before their retention TTL."

    def add_arguments(self, parser):
        parser.add_argument("--execute", action="store_true", help="Perform deletion instead of printing a dry run.")
        parser.add_argument("--limit", type=int, default=100)

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(seconds=settings.UNSAVED_BUILD_IMAGE_TTL_SECONDS)
        build_ids = expired_unsaved_build_ids(cutoff, limit=options["limit"])
        if not options["execute"]:
            self.stdout.write(f"Dry run: {len(build_ids)} unsaved build image(s) are eligible for cleanup.")
            return
        deleted = 0
        for build_id in build_ids:
            result = discard_ready_unsaved_build(build_id)
            if result in {"deleted", "already-absent", "no-image-reference"}:
                deleted += 1
        self.stdout.write(self.style.SUCCESS(f"Discarded {deleted} unsaved build image(s)."))
