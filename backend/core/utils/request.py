"""Request utilities — helpers for extracting metadata from Django/DRF requests."""


def get_client_ip(request) -> str | None:
    """Extract the real client IP from a request, respecting reverse proxy headers.

    Checks X-Forwarded-For first (set by Caddy/nginx reverse proxies), then
    falls back to REMOTE_ADDR. Returns the first (leftmost) IP in the
    X-Forwarded-For chain, which is the original client address.
    """
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded_for:
        # X-Forwarded-For: client, proxy1, proxy2 — leftmost is the client
        return forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")
