from django.db import models


class Permission(models.Model):
    """UNUSED (for now): Atomic capability key.

    Workflow role:
    - Defines one granular action that can be granted by a role template.
    - Intended to become the stable authorization vocabulary for endpoint guards.
    - Permission gates will be added as we iterate, but keys are intentionally not
      used for runtime authorization until all models are gated and parity tests pass.

    Naming convention:
    - Use dotted keys like `invoices.write`, `change_orders.approve`, `accounting.export`.
    - Keys should be globally unique and semantically stable over time.
    """

    key = models.CharField(max_length=120, unique=True)
    category = models.CharField(max_length=64, blank=True, default="")
    description = models.CharField(max_length=255, blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["key"]

    def __str__(self) -> str:
        return self.key
