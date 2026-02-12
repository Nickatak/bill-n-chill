from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0004_estimate_estimatelineitem"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="EstimateStatusEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "from_status",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("draft", "Draft"),
                            ("sent", "Sent"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("archived", "Archived"),
                        ],
                        max_length=32,
                        null=True,
                    ),
                ),
                (
                    "to_status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("sent", "Sent"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("archived", "Archived"),
                        ],
                        max_length=32,
                    ),
                ),
                ("note", models.TextField(blank=True)),
                ("changed_at", models.DateTimeField(auto_now_add=True)),
                (
                    "changed_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="estimate_status_events",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "estimate",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="status_events",
                        to="core.estimate",
                    ),
                ),
            ],
            options={
                "ordering": ["-changed_at", "-id"],
            },
        ),
    ]
