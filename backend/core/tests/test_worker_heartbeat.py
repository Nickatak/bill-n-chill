from datetime import timedelta
from django.test import TestCase
from django.utils import timezone

from core.models import WorkerHeartbeat


class WorkerHeartbeatModelTests(TestCase):
    def test_pulse_creates_row_on_first_call(self):
        self.assertFalse(WorkerHeartbeat.objects.exists())
        WorkerHeartbeat.pulse()
        self.assertEqual(WorkerHeartbeat.objects.count(), 1)

    def test_pulse_updates_existing_row(self):
        old_time = timezone.now() - timedelta(hours=1)
        WorkerHeartbeat.objects.create(pk=1, last_seen=old_time)

        WorkerHeartbeat.pulse()

        heartbeat = WorkerHeartbeat.objects.get(pk=1)
        self.assertGreater(heartbeat.last_seen, old_time)
        self.assertEqual(WorkerHeartbeat.objects.count(), 1)

    def test_is_healthy_returns_false_when_no_row(self):
        self.assertFalse(WorkerHeartbeat.is_healthy())

    def test_is_healthy_returns_true_after_recent_pulse(self):
        WorkerHeartbeat.pulse()
        self.assertTrue(WorkerHeartbeat.is_healthy())

    def test_is_healthy_returns_false_when_stale(self):
        WorkerHeartbeat.objects.create(
            pk=1, last_seen=timezone.now() - timedelta(minutes=15),
        )
        self.assertFalse(WorkerHeartbeat.is_healthy())

    def test_is_healthy_respects_custom_max_age(self):
        WorkerHeartbeat.objects.create(
            pk=1, last_seen=timezone.now() - timedelta(seconds=30),
        )
        self.assertTrue(WorkerHeartbeat.is_healthy(max_age_seconds=60))
        self.assertFalse(WorkerHeartbeat.is_healthy(max_age_seconds=10))

    def test_last_seen_iso_returns_none_when_no_row(self):
        self.assertIsNone(WorkerHeartbeat.last_seen_iso())

    def test_last_seen_iso_returns_string_after_pulse(self):
        WorkerHeartbeat.pulse()
        iso = WorkerHeartbeat.last_seen_iso()
        self.assertIsInstance(iso, str)
        self.assertIn("T", iso)


class WorkerHeartbeatTaskTests(TestCase):
    def test_heartbeat_task_creates_pulse(self):
        from core.tasks import worker_heartbeat_task

        self.assertFalse(WorkerHeartbeat.objects.exists())
        worker_heartbeat_task()
        self.assertTrue(WorkerHeartbeat.is_healthy())
