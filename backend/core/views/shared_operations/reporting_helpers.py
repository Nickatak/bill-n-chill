"""Domain-specific helpers for reporting views."""

# ---------------------------------------------------------------------------
# Constants (imported by views)
# ---------------------------------------------------------------------------

DUE_SOON_WINDOW_DAYS: int = 7

QUICK_JUMP_RESULT_LIMIT: int = 40

VALID_TIMELINE_CATEGORIES: set[str] = {"all", "financial", "workflow"}

SEVERITY_RANK: dict[str, int] = {"high": 0, "medium": 1, "low": 2}
