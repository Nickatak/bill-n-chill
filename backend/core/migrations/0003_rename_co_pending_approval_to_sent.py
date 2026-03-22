"""Rename change-order status value 'pending_approval' → 'sent' for cross-document symmetry."""

from django.db import migrations


def rename_pending_approval_to_sent(apps, schema_editor):
    """Update existing change-order rows and snapshot JSON from pending_approval to sent."""
    ChangeOrder = apps.get_model("core", "ChangeOrder")
    ChangeOrderSnapshot = apps.get_model("core", "ChangeOrderSnapshot")

    ChangeOrder.objects.filter(status="pending_approval").update(status="sent")

    for snapshot in ChangeOrderSnapshot.objects.all():
        json_data = snapshot.snapshot_json or {}
        changed = False

        # Update top-level change_order.status
        co_block = json_data.get("change_order", {})
        if co_block.get("status") == "pending_approval":
            co_block["status"] = "sent"
            changed = True

        # Update decision_context.previous_status
        dc_block = json_data.get("decision_context", {})
        if dc_block.get("previous_status") == "pending_approval":
            dc_block["previous_status"] = "sent"
            changed = True

        if changed:
            snapshot.snapshot_json = json_data
            snapshot.save(update_fields=["snapshot_json"])


def rename_sent_to_pending_approval(apps, schema_editor):
    """Reverse: sent → pending_approval."""
    ChangeOrder = apps.get_model("core", "ChangeOrder")
    ChangeOrderSnapshot = apps.get_model("core", "ChangeOrderSnapshot")

    ChangeOrder.objects.filter(status="sent").update(status="pending_approval")

    for snapshot in ChangeOrderSnapshot.objects.all():
        json_data = snapshot.snapshot_json or {}
        changed = False

        co_block = json_data.get("change_order", {})
        if co_block.get("status") == "sent":
            co_block["status"] = "pending_approval"
            changed = True

        dc_block = json_data.get("decision_context", {})
        if dc_block.get("previous_status") == "sent":
            dc_block["previous_status"] = "pending_approval"
            changed = True

        if changed:
            snapshot.snapshot_json = json_data
            snapshot.save(update_fields=["snapshot_json"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_rename_unit_cost_to_unit_price"),
    ]

    operations = [
        migrations.AlterField(
            model_name="changeorder",
            name="status",
            field=__import__("django.db.models", fromlist=["CharField"]).CharField(
                choices=[
                    ("draft", "Draft"),
                    ("sent", "Sent"),
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                    ("void", "Void"),
                ],
                db_index=True,
                default="draft",
                max_length=32,
            ),
        ),
        migrations.RunPython(
            rename_pending_approval_to_sent,
            rename_sent_to_pending_approval,
        ),
    ]
