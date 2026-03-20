"""Money precision utilities for consistent currency rounding."""

from decimal import Decimal, ROUND_HALF_UP

MONEY_QUANTUM = Decimal("0.01")
MONEY_ZERO = Decimal("0.00")


def quantize_money(value) -> Decimal:
    """Normalize any money value to 2-decimal currency precision."""
    return Decimal(str(value)).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def validate_positive_amount(amount: Decimal, field_name: str = "amount") -> dict | None:
    """Return an error payload if amount is <= 0, else None.

    The returned dict follows the standard API error envelope shape
    and can be passed directly to ``Response(error, status=400)``.
    """
    if amount <= MONEY_ZERO:
        return {
            "error": {
                "code": "validation_error",
                "message": f"{field_name.capitalize()} must be greater than zero.",
                "fields": {field_name: ["Must be greater than zero."]},
            }
        }
    return None

