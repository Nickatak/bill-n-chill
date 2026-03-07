from unittest.mock import patch

from django.core.exceptions import ValidationError

from core.tests.common import *


class AccountingSyncEventTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="pm24",
            email="pm24@example.com",
            password="secret123",
        )
        self.other_user = User.objects.create_user(
            username="pm25",
            email="pm25@example.com",
            password="secret123",
        )
        self.token, _ = Token.objects.get_or_create(user=self.user)
        self.org = _bootstrap_org(self.user)
        self.other_org = _bootstrap_org(self.other_user)
        self.other_token, _ = Token.objects.get_or_create(user=self.other_user)

        customer = Customer.objects.create(
            organization=self.org,
            display_name="Owner Sync",
            email="owner-sync@example.com",
            phone="555-1112",
            billing_address="101 Main St",
            created_by=self.user,
        )
        self.project = Project.objects.create(
            organization=self.org,
            customer=customer,
            name="Sync Project",
            status=Project.Status.ACTIVE,
            created_by=self.user,
        )

        other_customer = Customer.objects.create(
            organization=self.other_org,
            display_name="Owner Other Sync",
            email="owner-other-sync@example.com",
            phone="555-1113",
            billing_address="102 Main St",
            created_by=self.other_user,
        )
        self.other_project = Project.objects.create(
            organization=self.other_org,
            customer=other_customer,
            name="Other Sync Project",
            status=Project.Status.ACTIVE,
            created_by=self.other_user,
        )

    def test_project_sync_event_list_create_and_scope(self):
        create_response = self.client.post(
            f"/api/v1/projects/{self.project.id}/accounting-sync-events/",
            data={
                "provider": "quickbooks_online",
                "object_type": "invoice",
                "object_id": 12,
                "direction": "push",
                "status": "failed",
                "error_message": "Remote API timeout",
            },
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(create_response.status_code, 201)
        created = create_response.json()["data"]
        self.assertEqual(created["status"], "failed")
        self.assertEqual(created["error_message"], "Remote API timeout")
        self.assertIsNotNone(created["last_attempt_at"])
        created_event_id = created["id"]

        record = AccountingSyncRecord.objects.filter(accounting_sync_event_id=created_event_id).first()
        self.assertIsNotNone(record)
        self.assertEqual(record.event_type, AccountingSyncRecord.EventType.CREATED)
        self.assertEqual(record.capture_source, AccountingSyncRecord.CaptureSource.MANUAL_UI)
        self.assertIsNone(record.from_status)
        self.assertEqual(record.to_status, AccountingSyncEvent.Status.FAILED)
        self.assertEqual(record.recorded_by_id, self.user.id)

        AccountingSyncEvent.objects.create(
            project=self.other_project,
            provider=AccountingSyncEvent.Provider.QUICKBOOKS_ONLINE,
            object_type="invoice",
            object_id=99,
            direction=AccountingSyncEvent.Direction.PUSH,
            status=AccountingSyncEvent.Status.FAILED,
            created_by=self.other_user,
        )

        list_response = self.client.get(
            f"/api/v1/projects/{self.project.id}/accounting-sync-events/",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(list_response.status_code, 200)
        rows = list_response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["project"], self.project.id)

    def test_retry_failed_event_is_safe(self):
        event = AccountingSyncEvent.objects.create(
            project=self.project,
            provider=AccountingSyncEvent.Provider.QUICKBOOKS_ONLINE,
            object_type="invoice",
            object_id=55,
            direction=AccountingSyncEvent.Direction.PUSH,
            status=AccountingSyncEvent.Status.FAILED,
            error_message="Invalid token",
            created_by=self.user,
        )

        retry_response = self.client.post(
            f"/api/v1/accounting-sync-events/{event.id}/retry/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(retry_response.status_code, 200)
        self.assertEqual(retry_response.json()["meta"]["retry_status"], "retried")

        event.refresh_from_db()
        self.assertEqual(event.status, AccountingSyncEvent.Status.QUEUED)
        self.assertEqual(event.error_message, "")
        self.assertEqual(event.retry_count, 1)
        self.assertIsNotNone(event.last_attempt_at)
        retry_record = AccountingSyncRecord.objects.filter(accounting_sync_event=event).first()
        self.assertIsNotNone(retry_record)
        self.assertEqual(retry_record.event_type, AccountingSyncRecord.EventType.RETRIED)
        self.assertEqual(retry_record.from_status, AccountingSyncEvent.Status.FAILED)
        self.assertEqual(retry_record.to_status, AccountingSyncEvent.Status.QUEUED)
        self.assertEqual(retry_record.recorded_by_id, self.user.id)

        second_retry = self.client.post(
            f"/api/v1/accounting-sync-events/{event.id}/retry/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(second_retry.status_code, 200)
        self.assertEqual(second_retry.json()["meta"]["retry_status"], "already_queued")
        event.refresh_from_db()
        self.assertEqual(event.retry_count, 1)

    def test_retry_rejects_success_and_other_user_scope(self):
        success_event = AccountingSyncEvent.objects.create(
            project=self.project,
            provider=AccountingSyncEvent.Provider.QUICKBOOKS_ONLINE,
            object_type="invoice",
            object_id=56,
            direction=AccountingSyncEvent.Direction.PUSH,
            status=AccountingSyncEvent.Status.SUCCESS,
            external_id="QB-123",
            created_by=self.user,
        )
        blocked = self.client.post(
            f"/api/v1/accounting-sync-events/{success_event.id}/retry/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.token.key}",
        )
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(blocked.json()["error"]["code"], "validation_error")

        hidden = self.client.post(
            f"/api/v1/accounting-sync-events/{success_event.id}/retry/",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Token {self.other_token.key}",
        )
        self.assertEqual(hidden.status_code, 404)

    def test_accounting_sync_record_is_immutable(self):
        event = AccountingSyncEvent.objects.create(
            project=self.project,
            provider=AccountingSyncEvent.Provider.QUICKBOOKS_ONLINE,
            object_type="invoice",
            object_id=57,
            direction=AccountingSyncEvent.Direction.PUSH,
            status=AccountingSyncEvent.Status.FAILED,
            created_by=self.user,
        )
        record = AccountingSyncRecord.objects.create(
            accounting_sync_event=event,
            event_type=AccountingSyncRecord.EventType.CREATED,
            capture_source=AccountingSyncRecord.CaptureSource.SYSTEM,
            from_status=None,
            to_status=AccountingSyncEvent.Status.FAILED,
            snapshot_json={"accounting_sync_event": {"id": event.id}},
            recorded_by=self.user,
        )
        record.note = "mutate"
        with self.assertRaises(ValidationError):
            record.save()
        with self.assertRaises(ValidationError):
            record.delete()

    def test_create_rolls_back_when_record_capture_fails(self):
        with patch(
            "core.views.shared_operations.accounting._record_accounting_sync_record",
            side_effect=RuntimeError("capture-write-failed"),
        ):
            with self.assertRaises(RuntimeError):
                self.client.post(
                    f"/api/v1/projects/{self.project.id}/accounting-sync-events/",
                    data={
                        "provider": "quickbooks_online",
                        "object_type": "invoice",
                        "object_id": 44,
                        "direction": "push",
                    },
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Token {self.token.key}",
                )

        self.assertEqual(
            AccountingSyncEvent.objects.filter(project=self.project, object_id=44).count(),
            0,
        )
