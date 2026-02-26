from django.core.management import call_command

from core.tests.common import *


class OrganizationInvoiceDefaultsBackfillCommandTests(TestCase):
    def test_command_populates_missing_defaults_without_overwriting_existing_custom_values(self):
        owner = User.objects.create_user(
            username="backfill-owner",
            email="backfill-owner@example.com",
            password="secret123",
        )
        missing_defaults_org = Organization.objects.create(
            display_name="Backfill Org",
            slug="backfill-org",
            created_by=owner,
            invoice_sender_name="",
            invoice_sender_email="",
            estimate_validation_delta_days=0,
            invoice_default_terms="",
            estimate_default_terms="",
            change_order_default_reason="",
            invoice_default_footer="",
            invoice_default_notes="",
        )
        custom_org = Organization.objects.create(
            display_name="Custom Org",
            slug="custom-org",
            created_by=owner,
            invoice_sender_name="Custom Sender",
            invoice_sender_email="billing@custom.org",
            estimate_validation_delta_days=60,
            invoice_default_terms="Custom terms",
            estimate_default_terms="Custom estimate terms",
            change_order_default_reason="Custom CO reason",
            invoice_default_footer="Custom footer",
            invoice_default_notes="Custom notes",
        )

        call_command("backfill_organization_invoice_defaults")

        missing_defaults_org.refresh_from_db()
        self.assertEqual(missing_defaults_org.invoice_sender_name, "Backfill Org")
        self.assertEqual(
            missing_defaults_org.invoice_sender_email,
            "backfill-owner@example.com",
        )
        self.assertEqual(missing_defaults_org.estimate_validation_delta_days, 30)
        self.assertEqual(
            missing_defaults_org.invoice_default_terms,
            "Payment due within 30 days of invoice date.",
        )
        self.assertEqual(
            missing_defaults_org.estimate_default_terms,
            "Estimate is valid for 30 days. Scope and pricing are based on visible conditions only; hidden conditions may require a change order.",
        )
        self.assertEqual(
            missing_defaults_org.change_order_default_reason,
            "Scope adjustment requested after baseline approval due to field conditions or owner request.",
        )
        self.assertEqual(
            missing_defaults_org.invoice_default_footer,
            "Thank you for your business.",
        )
        self.assertEqual(
            missing_defaults_org.invoice_default_notes,
            "Please include invoice number with your payment.",
        )

        custom_org.refresh_from_db()
        self.assertEqual(custom_org.invoice_sender_name, "Custom Sender")
        self.assertEqual(custom_org.invoice_sender_email, "billing@custom.org")
        self.assertEqual(custom_org.estimate_validation_delta_days, 60)
        self.assertEqual(custom_org.invoice_default_terms, "Custom terms")
        self.assertEqual(custom_org.estimate_default_terms, "Custom estimate terms")
        self.assertEqual(custom_org.change_order_default_reason, "Custom CO reason")
        self.assertEqual(custom_org.invoice_default_footer, "Custom footer")
        self.assertEqual(custom_org.invoice_default_notes, "Custom notes")
