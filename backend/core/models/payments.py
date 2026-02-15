from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import models
from django.db.models import Sum

User = get_user_model()


class Payment(models.Model):
    """Recorded money movement for a project (AR inbound or AP outbound)."""

    class Direction(models.TextChoices):
        INBOUND = "inbound", "Inbound"
        OUTBOUND = "outbound", "Outbound"

    class Method(models.TextChoices):
        ACH = "ach", "ACH"
        CARD = "card", "Card"
        CHECK = "check", "Check"
        WIRE = "wire", "Wire"
        CASH = "cash", "Cash"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SETTLED = "settled", "Settled"
        FAILED = "failed", "Failed"
        VOID = "void", "Void"

    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="payments",
    )
    direction = models.CharField(max_length=16, choices=Direction.choices)
    method = models.CharField(max_length=16, choices=Method.choices)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    payment_date = models.DateField()
    reference_number = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="payments",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-payment_date", "-created_at"]

    @property
    def allocated_total(self) -> Decimal:
        return (
            self.allocations.aggregate(total=Sum("applied_amount")).get("total")
            or Decimal("0")
        )

    @property
    def unapplied_amount(self) -> Decimal:
        remainder = Decimal(str(self.amount)) - self.allocated_total
        return remainder if remainder > Decimal("0") else Decimal("0")

    def __str__(self) -> str:
        return f"{self.project.name} {self.direction} {self.amount}"


class PaymentAllocation(models.Model):
    """Applied amount from one payment to one invoice or vendor bill."""

    class TargetType(models.TextChoices):
        INVOICE = "invoice", "Invoice"
        VENDOR_BILL = "vendor_bill", "Vendor Bill"

    payment = models.ForeignKey(
        "Payment",
        on_delete=models.CASCADE,
        related_name="allocations",
    )
    target_type = models.CharField(max_length=16, choices=TargetType.choices)
    invoice = models.ForeignKey(
        "Invoice",
        on_delete=models.CASCADE,
        related_name="payment_allocations",
        null=True,
        blank=True,
    )
    vendor_bill = models.ForeignKey(
        "VendorBill",
        on_delete=models.CASCADE,
        related_name="payment_allocations",
        null=True,
        blank=True,
    )
    applied_amount = models.DecimalField(max_digits=12, decimal_places=2)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="payment_allocations",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"Payment {self.payment_id} -> {self.target_type} {self.applied_amount}"
