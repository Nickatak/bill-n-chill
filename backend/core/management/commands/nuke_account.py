"""Management command to completely wipe a user account and all associated org data."""

from django.core.management import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = "Completely wipe a user account and all associated organization data using raw SQL."

    def add_arguments(self, parser):
        parser.add_argument("email", type=str, help="Email of the user account to wipe.")

    def handle(self, *args, **options):
        email = options["email"]
        cursor = connection.cursor()

        # Look up user.
        cursor.execute("SELECT id FROM auth_user WHERE email = %s", [email])
        row = cursor.fetchone()
        if not row:
            self.stderr.write(self.style.ERROR(f"No user found with email: {email}"))
            return

        user_id = row[0]

        # Look up org membership.
        cursor.execute(
            "SELECT organization_id FROM core_organizationmembership WHERE user_id = %s",
            [user_id],
        )
        row = cursor.fetchone()
        if not row:
            self.stderr.write(self.style.ERROR(f"No org membership found for user {email}"))
            return

        org_id = row[0]

        self.stdout.write(
            self.style.WARNING(
                f"This will permanently delete user '{email}' (id={user_id}), "
                f"organization (id={org_id}), and ALL associated data."
            )
        )
        confirm = input("Type 'yes' to confirm: ")
        if confirm != "yes":
            self.stdout.write("Aborted.")
            return

        # Subquery fragments for scoping.
        project_ids_sub = f"(SELECT id FROM core_project WHERE organization_id = {org_id})"
        estimate_ids_sub = f"(SELECT id FROM core_estimate WHERE project_id IN {project_ids_sub})"
        invoice_ids_sub = f"(SELECT id FROM core_invoice WHERE project_id IN {project_ids_sub})"
        vendor_bill_ids_sub = f"(SELECT id FROM core_vendorbill WHERE project_id IN {project_ids_sub})"
        payment_ids_sub = f"(SELECT id FROM core_payment WHERE project_id IN {project_ids_sub})"
        change_order_ids_sub = f"(SELECT id FROM core_changeorder WHERE project_id IN {project_ids_sub})"
        payment_alloc_ids_sub = f"(SELECT id FROM core_paymentallocation WHERE payment_id IN {payment_ids_sub})"
        cost_code_ids_sub = f"(SELECT id FROM core_costcode WHERE organization_id = {org_id})"
        membership_ids_sub = f"(SELECT id FROM core_organizationmembership WHERE organization_id = {org_id})"

        # Deletion order: deepest children first, working up to org and user.
        # Each tuple: (description, SQL)
        steps = [
            # --- Signing ceremony + document access sessions (scoped via documents) ---
            (
                "signing ceremony records",
                f"""DELETE FROM core_signingceremonyrecord
                    WHERE access_session_id IN (
                        SELECT id FROM core_documentaccesssession
                        WHERE (document_type = 'estimate' AND document_id IN {estimate_ids_sub})
                           OR (document_type = 'change_order' AND document_id IN {change_order_ids_sub})
                           OR (document_type = 'invoice' AND document_id IN {invoice_ids_sub})
                    )""",
            ),
            (
                "document access sessions",
                f"""DELETE FROM core_documentaccesssession
                    WHERE (document_type = 'estimate' AND document_id IN {estimate_ids_sub})
                       OR (document_type = 'change_order' AND document_id IN {change_order_ids_sub})
                       OR (document_type = 'invoice' AND document_id IN {invoice_ids_sub})""",
            ),
            # --- Immutable audit/snapshot records (leaf nodes) ---
            ("accounting sync records", f"DELETE FROM core_accountingsyncrecord WHERE accounting_sync_event_id IN (SELECT id FROM core_accountingsyncevent WHERE project_id IN {project_ids_sub})"),
            ("payment allocation records", f"DELETE FROM core_paymentallocationrecord WHERE payment_id IN {payment_ids_sub}"),
            ("payment records", f"DELETE FROM core_paymentrecord WHERE payment_id IN {payment_ids_sub}"),
            ("vendor bill snapshots", f"DELETE FROM core_vendorbillsnapshot WHERE vendor_bill_id IN {vendor_bill_ids_sub}"),
            ("change order snapshots", f"DELETE FROM core_changeordersnapshot WHERE change_order_id IN {change_order_ids_sub}"),
            ("estimate status events", f"DELETE FROM core_estimatestatusevent WHERE estimate_id IN {estimate_ids_sub}"),
            ("invoice status events", f"DELETE FROM core_invoicestatusevent WHERE invoice_id IN {invoice_ids_sub}"),
            ("invoice scope override events", f"DELETE FROM core_invoicescopeoverrideevent WHERE invoice_id IN {invoice_ids_sub}"),
            ("customer records", f"DELETE FROM core_customerrecord WHERE customer_id IN (SELECT id FROM core_customer WHERE organization_id = {org_id})"),
            ("organization records", f"DELETE FROM core_organizationrecord WHERE organization_id = {org_id}"),
            ("organization membership records", f"DELETE FROM core_organizationmembershiprecord WHERE organization_id = {org_id}"),
            ("lead contact records", f"DELETE FROM core_leadcontactrecord WHERE recorded_by_id = {user_id}"),
            # --- Mid-level join tables ---
            ("vendor bill allocations", f"DELETE FROM core_vendorbillallocation WHERE vendor_bill_id IN {vendor_bill_ids_sub}"),
            ("payment allocations", f"DELETE FROM core_paymentallocation WHERE payment_id IN {payment_ids_sub}"),
            ("invoice lines", f"DELETE FROM core_invoiceline WHERE invoice_id IN {invoice_ids_sub}"),
            ("change order lines", f"DELETE FROM core_changeorderline WHERE change_order_id IN {change_order_ids_sub}"),
            ("estimate line items", f"DELETE FROM core_estimatelineitem WHERE estimate_id IN {estimate_ids_sub}"),
            # --- Entity-level (project-scoped) ---
            ("accounting sync events", f"DELETE FROM core_accountingsyncevent WHERE project_id IN {project_ids_sub}"),
            ("change orders", f"DELETE FROM core_changeorder WHERE project_id IN {project_ids_sub}"),
            ("invoices", f"DELETE FROM core_invoice WHERE project_id IN {project_ids_sub}"),
            ("payments", f"DELETE FROM core_payment WHERE project_id IN {project_ids_sub}"),
            ("vendor bills", f"DELETE FROM core_vendorbill WHERE project_id IN {project_ids_sub}"),
            ("estimates", f"DELETE FROM core_estimate WHERE project_id IN {project_ids_sub}"),
            # --- Org-level entities ---
            ("projects", f"DELETE FROM core_project WHERE organization_id = {org_id}"),
            ("customers", f"DELETE FROM core_customer WHERE organization_id = {org_id}"),
            ("vendors", f"DELETE FROM core_vendor WHERE organization_id = {org_id}"),
            ("cost codes", f"DELETE FROM core_costcode WHERE organization_id = {org_id}"),
            ("organization invites", f"DELETE FROM core_organizationinvite WHERE organization_id = {org_id}"),
            ("org role templates", f"DELETE FROM core_roletemplate WHERE organization_id = {org_id}"),
            ("organization memberships", f"DELETE FROM core_organizationmembership WHERE organization_id = {org_id}"),
            # --- Organization ---
            ("organization", f"DELETE FROM core_organization WHERE id = {org_id}"),
            # --- User-level ---
            ("email records", f"DELETE FROM core_emailrecord WHERE sent_by_user_id = {user_id}"),
            ("email verification tokens", f"DELETE FROM core_emailverificationtoken WHERE user_id = {user_id}"),
            ("auth token", f"DELETE FROM authtoken_token WHERE user_id = {user_id}"),
            ("user", f"DELETE FROM auth_user WHERE id = {user_id}"),
        ]

        total_deleted = 0
        for description, sql in steps:
            cursor.execute(sql)
            count = cursor.rowcount
            total_deleted += count
            if count > 0:
                self.stdout.write(f"  Deleted {count} {description}")

        self.stdout.write(
            self.style.SUCCESS(f"\nAccount '{email}' wiped. {total_deleted} rows deleted total.")
        )
