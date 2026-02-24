import os
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings


def _resolve_reset_marker_path() -> Path:
    configured = os.getenv("DATA_RESET_MARKER_PATH", "").strip()
    if configured:
        return Path(configured).expanduser()
    return settings.BASE_DIR / ".runtime" / "last_data_reset_at.txt"


def get_last_data_reset_at() -> str | None:
    explicit = os.getenv("DATA_RESET_AT", "").strip()
    if explicit:
        return explicit

    marker_path = _resolve_reset_marker_path()
    if not marker_path.exists():
        return None
    try:
        value = marker_path.read_text(encoding="utf-8").strip()
        return value or None
    except OSError:
        return None


def write_last_data_reset_at(value: str | None = None) -> str:
    timestamp = value or datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    marker_path = _resolve_reset_marker_path()
    marker_path.parent.mkdir(parents=True, exist_ok=True)
    marker_path.write_text(timestamp, encoding="utf-8")
    return timestamp


def get_app_revision() -> str | None:
    # Prefer explicit server-side deployment metadata values.
    for env_name in ("APP_REVISION", "GIT_COMMIT_SHA", "RENDER_GIT_COMMIT", "VERCEL_GIT_COMMIT_SHA"):
        value = os.getenv(env_name, "").strip()
        if value:
            return value
    return None


def get_app_build_at() -> str | None:
    # Prefer explicit deployment build timestamp metadata values.
    for env_name in (
        "APP_BUILD_AT",
        "BUILD_TIMESTAMP",
        "RENDER_BUILD_TIMESTAMP",
        "VERCEL_GIT_COMMIT_DATE",
    ):
        value = os.getenv(env_name, "").strip()
        if value:
            return value
    return None
