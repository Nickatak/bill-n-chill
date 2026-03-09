"""Authentication serializers for login and registration."""

from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class LoginSerializer(serializers.Serializer):
    """Write serializer for email/password login."""

    email = serializers.EmailField()
    password = serializers.CharField()

    def validate(self, attrs):
        email = attrs["email"].strip().lower()
        password = attrs["password"]

        # Anti-enumeration: both branches return the same error message so
        # an attacker cannot distinguish "no such account" from "wrong password".
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            raise serializers.ValidationError("Invalid email or password.")
        if not user.check_password(password):
            raise serializers.ValidationError("Invalid email or password.")

        attrs["user"] = user
        return attrs


class RegisterSerializer(serializers.Serializer):
    """Write serializer for new user registration.

    Email uniqueness is NOT checked here — the view handles it silently
    to prevent email enumeration (always returns the same response
    regardless of whether the email exists).
    """

    email = serializers.EmailField()
    password = serializers.CharField(min_length=8)

    def validate_email(self, value: str) -> str:
        return value.strip().lower()
