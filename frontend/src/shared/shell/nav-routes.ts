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
  /** Dropdown section label. Routes with the same section are grouped under a heading. */
  section?: string;
};

/**
 * Primary workflow steps shown in the top-level navbar.
 * Numbered labels reflect the intended left-to-right construction workflow.
 */
export const workflowRoutes: NavRoute[] = [
  {
    href: "/",
    label: "Dashboard",
    exact: ["/"],
  },
  {
    href: "/customers",
    label: "1 Customers",
    exact: ["/customers"],
  },
  {
    href: "/projects",
    label: "2 Projects",
    exact: ["/projects"],
    startsWith: ["/projects/"],
  },
  {
    href: "/invoices",
    label: "3 Billing",
    kind: "billing_menu",
    exact: ["/invoices", "/bills"],
  },
  {
    href: "/financials-auditing",
    label: "4 Financials",
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
  { href: "/cost-codes", label: "Cost Codes", exact: ["/cost-codes"], section: "Management" },
  { href: "/vendors", label: "Vendors", exact: ["/vendors"], section: "Management" },
  { href: "/onboarding", label: "Get Started", exact: ["/onboarding"] },
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
