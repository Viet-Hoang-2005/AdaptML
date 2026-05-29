from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = "Create the PostgreSQL schema used by the Control Plane if it does not exist."

    def handle(self, *args, **options):
        schema_name = getattr(settings, "DB_SCHEMA", "control_plane")
        quoted_schema = connection.ops.quote_name(schema_name)

        with connection.cursor() as cursor:
            cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {quoted_schema}")

        self.stdout.write(self.style.SUCCESS(f"Schema '{schema_name}' is ready."))
