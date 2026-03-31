"""Reusable model mixins for cross-cutting concerns.

ImmutableModelMixin — enforces append-only semantics (save once, never update/delete).
StatusTransitionMixin — provides transition validation for models with status workflows.
"""

from django.core.exceptions import ValidationError
from django.db import models


class ImmutableQuerySet(models.QuerySet):
    """QuerySet that prevents bulk deletion of immutable records."""

    def delete(self):
        label = getattr(self.model, "_immutable_label", self.model.__name__)
        raise ValidationError(f"{label} are immutable and cannot be deleted.")


class ImmutableModelMixin(models.Model):
    """Abstract base for append-only audit/capture models.

    Subclasses must set ``_immutable_label`` to a human-readable plural noun
    (e.g., ``"Change-order snapshots"``).  The label is used in error messages.

    Provides:
    - ``save()`` guard: raises on update (pk already set).
    - ``delete()`` guard: always raises.
    - ``objects`` manager backed by ``ImmutableQuerySet`` (bulk delete guard).
    """

    _immutable_label: str = ""

    objects = ImmutableQuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValidationError(
                f"{self._immutable_label} are immutable and cannot be updated."
            )
        super().save(*args, **kwargs)

    def delete(self, using=None, keep_parents=False):
        raise ValidationError(
            f"{self._immutable_label} are immutable and cannot be deleted."
        )


class StatusTransitionMixin:
    """Mixin for models with ``ALLOWED_STATUS_TRANSITIONS`` and a ``status`` field.

    Subclasses must define:
    - ``ALLOWED_STATUS_TRANSITIONS``: dict mapping each status to a set of valid next statuses.
    - ``_status_label``: lowercase noun for error messages (e.g., ``"quote"``).

    Provides:
    - ``is_transition_allowed(current, next)`` classmethod.
    - ``validate_status_transition(errors)`` instance method for use in ``clean()``.
    """

    ALLOWED_STATUS_TRANSITIONS: dict = {}
    _status_label: str = ""

    @classmethod
    def is_transition_allowed(cls, current_status: str, next_status: str) -> bool:
        if current_status == next_status:
            return True
        return next_status in cls.ALLOWED_STATUS_TRANSITIONS.get(current_status, set())

    def validate_status_transition(self, errors: dict) -> None:
        """Append a status-transition error to *errors* if the transition is invalid.

        Call from ``clean()`` after collecting domain-specific errors.
        """
        if self.pk:
            previous_status = (
                type(self)
                .objects.filter(pk=self.pk)
                .values_list("status", flat=True)
                .first()
            )
            if previous_status and not self.is_transition_allowed(
                previous_status, self.status
            ):
                errors.setdefault("status", []).append(
                    f"Invalid {self._status_label} status transition: "
                    f"{previous_status} -> {self.status}."
                )
