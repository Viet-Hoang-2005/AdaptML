#!/usr/bin/env python
import os
import sys
from pathlib import Path


def main():
    service_root = Path(__file__).resolve().parent
    sys.path.insert(0, str(service_root / "src"))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.local")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
