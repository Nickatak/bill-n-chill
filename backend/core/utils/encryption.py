"""Symmetric encryption utilities for storing sensitive tokens at rest.

Derives a Fernet key from Django's SECRET_KEY via HKDF. All values are
stored as URL-safe base64 strings and decrypted on read.
"""

import base64

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from django.conf import settings


def _derive_fernet_key() -> bytes:
    """Derive a 32-byte Fernet key from Django's SECRET_KEY using HKDF."""
    kdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"bnc-qbo-token-encryption",
        info=b"fernet-key",
    )
    key_material = kdf.derive(settings.SECRET_KEY.encode("utf-8"))
    return base64.urlsafe_b64encode(key_material)


def encrypt_token(plaintext: str) -> str:
    """Encrypt a plaintext string and return a Fernet ciphertext string."""
    if not plaintext:
        return ""
    f = Fernet(_derive_fernet_key())
    return f.encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a Fernet ciphertext string back to plaintext.

    Returns empty string if the ciphertext is empty or decryption fails
    (e.g. SECRET_KEY was rotated).
    """
    if not ciphertext:
        return ""
    f = Fernet(_derive_fernet_key())
    try:
        return f.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return ""
