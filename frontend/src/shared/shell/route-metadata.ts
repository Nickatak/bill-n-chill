/**
 * Shared route-shim metadata helpers.
 *
 * Why this file exists:
 * - `generateMetadata` must be exported from route modules for Next.js discovery
 * - title formatting/validation logic should stay reusable and testable outside route files
 */

/**
 * Route id matcher:
 * - matches digits only (for example "7", "42", "001")
 * - rejects blanks, whitespace, signs, decimals, and non-digit characters
 */
const NUMERIC_ROUTE_ID_PATTERN = /^\d+$/;

/**
 * Returns `true` only for digit-only ids used in route params/query values.
 */
export function isNumericRouteId(value: string | null | undefined): value is string {
  return typeof value === "string" && NUMERIC_ROUTE_ID_PATTERN.test(value);
}

/**
 * Build a route title from optional `?project=<id>` query input.
 *
 * Examples:
 * - ("Invoices", "17") => "Invoices - Project #17"
 * - ("Invoices", "abc") => "Invoices"
 */
export function resolveProjectQueryTitle(baseTitle: string, projectQuery: string | undefined): string {
  if (!isNumericRouteId(projectQuery)) {
    return baseTitle;
  }
  return `${baseTitle} - Project #${projectQuery}`;
}

/**
 * Build a route title from a required project route param with fallback safety.
 *
 * Example:
 * - ("17", "Quotes", "Project Quotes") => "Project #17 Quotes"
 */
export function resolveProjectParamTitle(
  projectId: string,
  scopedSuffix: string,
  fallbackTitle: string,
): string {
  if (!isNumericRouteId(projectId)) {
    return fallbackTitle;
  }
  return `Project #${projectId} ${scopedSuffix}`;
}
