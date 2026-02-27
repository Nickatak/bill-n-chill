export type NavRoute = {
  href: string;
  label: string;
  exact?: string[];
  startsWith?: string[];
};

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
  },
  {
    href: "/billing",
    label: "4 Billing (WIP)",
    exact: ["/invoices"],
  },
  {
    href: "/financials-auditing",
    label: "5 Financials & Accounting (WIP)",
    exact: ["/financials-auditing"],
  },
];

export const opsMetaRoutes: NavRoute[] = [
  { href: "/customers", label: "Customers", exact: ["/customers"] },
  { href: "/cost-codes", label: "Cost Codes", exact: ["/cost-codes"] },
  { href: "/vendors", label: "Vendors (WIP)", exact: ["/vendors"] },
  { href: "/settings/intake", label: "Settings (WIP)", exact: ["/settings/intake"] },
  { href: "/ops/meta/help", label: "Help (WIP)", exact: ["/ops/meta/help"] },
];

export function isRouteActive(pathname: string, route: NavRoute): boolean {
  const exactMatches = route.exact ?? [route.href];
  if (exactMatches.includes(pathname)) {
    return true;
  }
  const prefixMatches = route.startsWith ?? [];
  return prefixMatches.some((prefix) => pathname.startsWith(prefix));
}
