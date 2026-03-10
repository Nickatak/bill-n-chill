"""Custom DRF authentication backends."""

from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed

from core.models.shared_operations.impersonation import ImpersonationToken


class ImpersonationTokenAuthentication(TokenAuthentication):
    """Authenticate using an impersonation token if one exists.

    Uses the same ``Token <key>`` header format as DRF's built-in
    TokenAuthentication. Checks the ImpersonationToken table first;
    if no match, returns None so the next auth class can try.

    On success, sets ``request.user`` to the impersonated (target) user
    and attaches ``request.impersonated_by`` so views and audit logic
    can identify the real actor.
    """

    def authenticate_credentials(self, key):
        """Look up the key in ImpersonationToken. Fall through if not found."""
        try:
            token = ImpersonationToken.objects.select_related(
                "user", "impersonated_by"
            ).get(key=key)
        except ImpersonationToken.DoesNotExist:
            # Not an impersonation token — let the next auth backend handle it.
            return None

        if token.is_expired:
            token.delete()
            raise AuthenticationFailed("Impersonation session has expired.")

        if not token.user.is_active:
            raise AuthenticationFailed("Impersonated user account is inactive.")

        # Stash the real actor on the token so the view layer can read it
        # via request.auth.impersonated_by.
        return (token.user, token)
