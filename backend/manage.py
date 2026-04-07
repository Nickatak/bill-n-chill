#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def _print_db_connection_help() -> None:
    print(
        "\n[DB Connection Error] Could not connect to PostgreSQL at 127.0.0.1.\n"
        "Start the Dockerized database first:\n"
        "  make db-up\n\n"
        "Then retry your command (for example):\n"
        "  make local-run-backend\n",
        file=sys.stderr,
    )


def main():
    """Run administrative tasks."""
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    try:
        execute_from_command_line(sys.argv)
    except Exception as exc:
        message = str(exc)
        if "could not connect to server" in message.lower() or "connection refused" in message.lower():
            _print_db_connection_help()
            raise SystemExit(1) from exc
        raise


if __name__ == "__main__":
    main()
