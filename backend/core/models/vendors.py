from django.contrib.auth import get_user_model
from django.db import models

User = get_user_model()


class Vendor(models.Model):
    """Payee directory record used for AP bills and commitments.

    Business workflow:
    - Maintained internally by the contractor/user.
    - Reused for downstream AP and commitment workflows.
    - Duplicate warnings are handled at application level by name/email.
    """

    name = models.CharField(max_length=255)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    tax_id_last4 = models.CharField(max_length=4, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        related_name="vendors",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self) -> str:
        return self.name
