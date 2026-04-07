#!/usr/bin/env python3
import os
import sys
import time
from pathlib import Path


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(repo_root / "backend"))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

    from django import setup
    from django.db import connections
    from django.db.utils import OperationalError

    setup()
    db_settings = connections["default"].settings_dict
    host = db_settings.get("HOST") or "127.0.0.1"
    port = str(db_settings.get("PORT") or "5432")

    max_attempts = 15
    last_exception: Exception | None = None
    for _ in range(max_attempts):
        try:
            with connections["default"].cursor():
                return 0
        except OperationalError as exc:
            last_exception = exc
            message = str(exc).lower()
            if "could not connect to server" in message or "connection refused" in message:
                time.sleep(1)
                continue
            raise
        except Exception as exc:
            last_exception = exc
            raise

    if last_exception:
        message = str(last_exception).lower()
        if "could not connect to server" in message or "connection refused" in message:
            print(
                f"\n[DB Connection Error] Could not connect to PostgreSQL on {host}:{port} after {max_attempts}s.\n"
                "PostgreSQL container may still be starting, or host/port may be mismatched.\n\n"
                "Checks:\n"
                "  make docker-up\n"
                "  make docker-logs\n"
                "  grep DATABASE_URL .env\n\n"
                "Then retry:\n"
                "  make local-run-backend\n",
                file=sys.stderr,
            )
            return 1
        raise last_exception

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
