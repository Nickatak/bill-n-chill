"""System-level models for infrastructure health monitoring."""

from django.db import models
from django.utils import timezone


class WorkerHeartbeat(models.Model):
    """Single-row table tracking the last time a django-q2 worker ran a heartbeat task.

    The heartbeat task runs every 5 minutes via a django-q2 Schedule.
    The health endpoint checks staleness to detect a dead worker.
    """

    last_seen = models.DateTimeField()

    class Meta:
        db_table = "worker_heartbeat"

    @classmethod
    def pulse(cls):
        """Update the heartbeat timestamp. Creates the row if it doesn't exist."""
        cls.objects.update_or_create(pk=1, defaults={"last_seen": timezone.now()})

    @classmethod
    def is_healthy(cls, max_age_seconds=600):
        """Return True if the last heartbeat is within max_age_seconds (default 10 min)."""
        try:
            heartbeat = cls.objects.get(pk=1)
            age = (timezone.now() - heartbeat.last_seen).total_seconds()
            return age < max_age_seconds
        except cls.DoesNotExist:
            return False

    @classmethod
    def last_seen_iso(cls):
        """Return the last heartbeat timestamp as an ISO string, or None."""
        try:
            return cls.objects.get(pk=1).last_seen.isoformat()
        except cls.DoesNotExist:
            return None
