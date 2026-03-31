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
            created_by=owner,
            help_email="",
            default_quote_valid_delta=0,
            invoice_terms_and_conditions="",
            quote_terms_and_conditions="",
            change_order_terms_and_conditions="",
        )
        custom_org = Organization.objects.create(
            display_name="Custom Org",
            created_by=owner,
            help_email="help@custom.org",
            default_quote_valid_delta=60,
            invoice_terms_and_conditions="Custom terms",
            quote_terms_and_conditions="Custom quote terms",
            change_order_terms_and_conditions="Custom CO terms",
        )

        call_command("backfill_organization_invoice_defaults")

        missing_defaults_org.refresh_from_db()
        self.assertEqual(
            missing_defaults_org.help_email,
            "backfill-owner@example.com",
        )
        self.assertEqual(missing_defaults_org.default_quote_valid_delta, 30)
        self.assertEqual(
            missing_defaults_org.invoice_terms_and_conditions,
            "Payment due within 30 days of invoice date.",
        )
        self.assertEqual(
            missing_defaults_org.quote_terms_and_conditions,
            "Quote is valid for 30 days. Scope and pricing are based on visible conditions only; hidden conditions may require a change order.",
        )
        self.assertEqual(
            missing_defaults_org.change_order_terms_and_conditions,
            "Change order pricing is based on current labor and material rates. "
            "Approved changes are final and will be reflected in the next billing cycle.",
        )

        custom_org.refresh_from_db()
        self.assertEqual(custom_org.help_email, "help@custom.org")
        self.assertEqual(custom_org.default_quote_valid_delta, 60)
        self.assertEqual(custom_org.invoice_terms_and_conditions, "Custom terms")
        self.assertEqual(custom_org.quote_terms_and_conditions, "Custom quote terms")
        self.assertEqual(custom_org.change_order_terms_and_conditions, "Custom CO terms")
