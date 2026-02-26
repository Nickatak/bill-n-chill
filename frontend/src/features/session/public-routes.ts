const PUBLIC_DOCUMENT_ROUTE_PATTERNS = [
  /^\/estimate\/[^/]+\/?$/,
  /^\/invoice\/[^/]+\/?$/,
  /^\/change-order\/[^/]+\/?$/,
];

export function isPublicDocumentRoute(pathname?: string | null): boolean {
  if (!pathname) {
    return false;
  }
  return PUBLIC_DOCUMENT_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function isPublicAuthRoute(pathname?: string | null): boolean {
  if (!pathname) {
    return false;
  }
  if (pathname === "/" || pathname === "/register") {
    return true;
  }
  return isPublicDocumentRoute(pathname);
}
