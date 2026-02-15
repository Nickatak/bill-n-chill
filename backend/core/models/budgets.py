from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Budget(models.Model):
    """Internal execution budget baseline derived from an approved estimate.

    Business workflow:
    - Created after client-approved estimating is complete.
    - Stores immutable baseline snapshot of the source estimate.
    - Exposes mutable working lines for internal planning/tracking.
    - Distinction: client approves Estimate; team manages Budget internally.
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        SUPERSEDED = "superseded", "Superseded"

    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="budgets",
    )
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    source_estimate = models.ForeignKey(
        "Estimate",
        on_delete=models.PROTECT,
        related_name="budgets",
    )
    baseline_snapshot_json = models.JSONField(default=dict)
    approved_change_order_total = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="budgets",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.project.name} budget ({self.status})"


class BudgetLine(models.Model):
    """Internal working-budget line for expected spend by cost category.

    Business workflow:
    - Used by the contractor/user to plan and track budgeted/actual/committed values.
    - Not a client-facing artifact.
    """

    budget = models.ForeignKey(
        "Budget",
        on_delete=models.CASCADE,
        related_name="line_items",
    )
    cost_code = models.ForeignKey(
        "CostCode",
        on_delete=models.PROTECT,
        related_name="budget_lines",
    )
    description = models.CharField(max_length=255)
    budget_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    actual_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    committed_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.cost_code.code} {self.description}"


class ChangeOrder(models.Model):
    """Post-baseline contract delta request for scope/time/cost changes.

    Business workflow:
    - Represents change governance after baseline, not a full estimate restart.
    - Routed through draft -> pending approval -> approved/rejected/void lifecycle.
    - Approved amount deltas propagate to project contract current and budget CO total.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PENDING_APPROVAL = "pending_approval", "Pending Approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        VOID = "void", "Void"

    project = models.ForeignKey(
        "Project",
        on_delete=models.PROTECT,
        related_name="change_orders",
    )
    number = models.PositiveIntegerField()
    title = models.CharField(max_length=255)
    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    amount_delta = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    days_delta = models.IntegerField(default=0)
    reason = models.TextField(blank=True)
    requested_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="requested_change_orders",
    )
    approved_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="approved_change_orders",
        null=True,
        blank=True,
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        unique_together = ("project", "number")

    def __str__(self) -> str:
        return f"{self.project.name} CO-{self.number}"
