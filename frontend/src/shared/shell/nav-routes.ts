/**
 * Canonical route definitions for the workflow navbar and ops/meta menu.
 *
 * Each route declares matching rules (`exact`, `startsWith`) so the
 * navbar and breadcrumbs can highlight the active item without coupling
 * to Next.js router internals. The `kind` discriminator lets the navbar
 * render special UI (e.g. the billing dropdown) for specific entries.
 */

export type NavRoute = {
  href: string;
  label: string;
  /** When set, the navbar renders a custom control instead of a plain link. */
  kind?: "billing_menu";
  /** Pathnames that count as an exact active match. */
  exact?: string[];
  /** Pathname prefixes that count as an active match. */
  startsWith?: string[];
};

/**
 * Primary workflow steps shown in the top-level navbar.
 * Numbered labels reflect the intended left-to-right construction workflow.
 */
export const workflowRoutes: NavRoute[] = [
  {
    href: "/intake/quick-add",
    label: "1 Intake",
    exact: ["/", "/intake/quick-add"],
  },
  {
    href: "/customers",
    label: "2 Customers",
    exact: ["/customers"],
  },
  {
    href: "/projects",
    label: "3 Projects",
    exact: ["/projects"],
    startsWith: ["/projects/"],
  },
  {
    href: "/invoices",
    label: "4 Billing",
    kind: "billing_menu",
    exact: ["/invoices", "/bills"],
  },
  {
    href: "/financials-auditing",
    label: "5 Financials & Accounting (WIP)",
    exact: ["/financials-auditing"],
  },
];

/**
 * Secondary routes shown in the "Ops / Meta" dropdown menu.
 * These are operational and configuration pages that sit outside
 * the main workflow sequence.
 */
export const opsMetaRoutes: NavRoute[] = [
  { href: "/customers", label: "Customers", exact: ["/customers"] },
  { href: "/cost-codes", label: "Cost Codes (WIP)", exact: ["/cost-codes"] },
  { href: "/vendors", label: "Vendors (WIP)", exact: ["/vendors"] },
  { href: "/settings/intake", label: "Settings (WIP)", exact: ["/settings/intake"] },
  { href: "/ops/meta/help", label: "Help (WIP)", exact: ["/ops/meta/help"] },
];

/**
 * Determine whether a route should be highlighted as "active" for
 * the given pathname.
 *
 * Checks exact matches first, then falls back to prefix matches.
 * If no explicit `exact` array is provided, the route's `href` is
 * used as the sole exact match.
 */
export function isRouteActive(pathname: string, route: NavRoute): boolean {
  const exactMatches = route.exact ?? [route.href];
  if (exactMatches.includes(pathname)) {
    return true;
  }

  const prefixMatches = route.startsWith ?? [];
  return prefixMatches.some((prefix) => pathname.startsWith(prefix));
}
