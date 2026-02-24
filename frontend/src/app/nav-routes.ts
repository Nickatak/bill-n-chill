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
    href: "/invoices",
    label: "4 Invoices",
    exact: ["/invoices"],
  },
  {
    href: "/payments",
    label: "5 Payments",
    exact: ["/payments"],
  },
];

export const opsMetaRoutes: NavRoute[] = [
  { href: "/customers", label: "Customers", exact: ["/customers"] },
];

export const opsMetaWipRoutes: NavRoute[] = [
  { href: "/ops/meta", label: "Notes", exact: ["/ops/meta"] },
  { href: "/ops/organization", label: "Organization", exact: ["/ops/organization"] },
  { href: "/vendors", label: "Vendors", exact: ["/vendors"] },
  { href: "/cost-codes", label: "Cost Codes", exact: ["/cost-codes"] },
  {
    href: "/financials-auditing",
    label: "Financials & Auditing",
    exact: ["/financials-auditing"],
  },
  { href: "/settings/intake", label: "Intake Settings", exact: ["/settings/intake"] },
];

export function isRouteActive(pathname: string, route: NavRoute): boolean {
  const exactMatches = route.exact ?? [route.href];
  if (exactMatches.includes(pathname)) {
    return true;
  }
  const prefixMatches = route.startsWith ?? [];
  return prefixMatches.some((prefix) => pathname.startsWith(prefix));
}
