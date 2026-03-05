from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()

    def validate(self, attrs):
        email = attrs["email"].strip().lower()
        password = attrs["password"]

        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if not user:
            raise serializers.ValidationError("Invalid email or password.")
        if not user.check_password(password):
            raise serializers.ValidationError("Invalid email or password.")

        attrs["user"] = user
        return attrs


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8)

    def validate_email(self, value: str) -> str:
        email = value.strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return email
