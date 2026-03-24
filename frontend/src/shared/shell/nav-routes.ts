/**
 * Canonical route definitions for the workflow navbar and business menu.
 *
 * Each route declares matching rules (`exact`, `startsWith`) so the
 * navbar and breadcrumbs can highlight the active item without coupling
 * to Next.js router internals. The `kind` discriminator lets the navbar
 * render special UI (e.g. the billing dropdown) for specific entries.
 */

export type NavRoute = {
  href: string;
  label: string;
  /** Abbreviated label for compact contexts (e.g. mobile bottom nav). Falls back to `label`. */
  shortLabel?: string;
  /** Pathnames that count as an exact active match. */
  exact?: string[];
  /** Pathname prefixes that count as an active match. */
  startsWith?: string[];
  /** Dropdown section label. Routes with the same section are grouped under a heading. */
  section?: string;
};

/** True when the frontend is running with NEXT_PUBLIC_DEBUG=true. */
export const isDebugMode = process.env.NEXT_PUBLIC_DEBUG === "true";

/** Primary workflow steps shown in the top-level navbar. */
export const workflowRoutes: NavRoute[] = [
  {
    href: "/customers",
    label: "Customers",
    shortLabel: "Cust",
    exact: ["/customers"],
  },
  {
    href: "/projects",
    label: "Projects",
    shortLabel: "Proj",
    exact: ["/projects"],
    startsWith: ["/projects/"],
  },
  {
    href: "/accounting",
    label: "Accounting",
    shortLabel: "Acct",
    exact: ["/accounting"],
  },
];

/**
 * Secondary routes shown in the organization dropdown menu.
 * These are business-setup and configuration pages that sit outside
 * the main workflow sequence. The dropdown trigger shows the org name.
 */
export const businessMenuRoutes: NavRoute[] = [
  { href: "/ops/organization", label: "Organization", exact: ["/ops/organization"], section: "Settings" },
  { href: "/cost-codes", label: "Cost Codes", exact: ["/cost-codes"], section: "Settings" },
  { href: "/vendors", label: "Vendors", exact: ["/vendors"], section: "Settings" },
  { href: "/onboarding", label: "Get Started", exact: ["/onboarding"], section: "Support" },
];

/** Dev-only workflow routes, shown in the navbar when NEXT_PUBLIC_DEBUG=true. */
export const debugWorkflowRoutes: NavRoute[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    shortLabel: "Dash",
    exact: ["/dashboard"],
  },
  {
    href: "/dev-notes",
    label: "Dev Notes",
    shortLabel: "Notes",
    exact: ["/dev-notes"],
  },
];

/** Dev-only business menu routes, shown in the org dropdown when NEXT_PUBLIC_DEBUG=true. */
export const debugBusinessMenuRoutes: NavRoute[] = [];

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
