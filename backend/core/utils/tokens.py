"""Shared token generation utilities."""

import secrets
import string


def generate_public_token(length: int = 12) -> str:
    """Generate a random alphanumeric token for public-facing share links."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))
