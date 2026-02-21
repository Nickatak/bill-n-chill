from decimal import Decimal, ROUND_HALF_UP

MONEY_QUANTUM = Decimal("0.01")
MONEY_ZERO = Decimal("0.00")


def quantize_money(value) -> Decimal:
    """Normalize any money value to 2-decimal currency precision."""
    return Decimal(str(value)).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)

