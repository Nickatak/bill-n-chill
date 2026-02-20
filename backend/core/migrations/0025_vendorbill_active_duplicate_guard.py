from django.db import migrations, models
from django.db.models import Q
from django.db.models.functions import Lower


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0024_vendorbill_scheduled_for"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="vendorbill",
            constraint=models.UniqueConstraint(
                "created_by",
                "vendor",
                Lower("bill_number"),
                condition=~Q(status="void"),
                name="uniq_active_vendor_bill_number_per_user_vendor_ci",
            ),
        ),
    ]
