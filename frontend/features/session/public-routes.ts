const PUBLIC_AUTH_ROUTES = new Set(['/login', '/register']);

export function isPublicAuthRoute(pathname?: string | null): boolean {
  if (!pathname) {
    return false;
  }

  return PUBLIC_AUTH_ROUTES.has(pathname);
}
