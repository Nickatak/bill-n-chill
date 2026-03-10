/**
 * Route classification helpers for the auth gate.
 *
 * Public document routes (estimate, invoice, change-order viewer) and
 * auth routes (login, register) bypass the global auth gate so
 * unauthenticated visitors can access them.
 */

const PUBLIC_DOCUMENT_ROUTE_PATTERNS = [
  /^\/estimate\/[^/]+\/?$/,
  /^\/invoice\/[^/]+\/?$/,
  /^\/change-order\/[^/]+\/?$/,
];

/** True if the pathname matches a tokenized public document viewer route. */
export function isPublicDocumentRoute(pathname?: string | null): boolean {
  if (!pathname) {
    return false;
  }
  return PUBLIC_DOCUMENT_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

/** True if the pathname is accessible without authentication (login, register, or public document). */
export function isPublicAuthRoute(pathname?: string | null): boolean {
  if (!pathname) {
    return false;
  }
  if (pathname === "/" || pathname === "/login" || pathname === "/register" || pathname === "/verify-email" || pathname === "/reset-password") {
    return true;
  }
  return isPublicDocumentRoute(pathname);
}
