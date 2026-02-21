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
    href: "/projects",
    label: "2 Projects",
    exact: ["/projects"],
  },
  {
    href: "/invoices",
    label: "3 Invoices",
    exact: ["/invoices"],
  },
  {
    href: "/vendor-bills",
    label: "4 Vendor Bills",
    exact: ["/vendor-bills"],
  },
  {
    href: "/expenses",
    label: "5 Expenses",
    exact: ["/expenses"],
  },
  {
    href: "/payments",
    label: "6 Payments",
    exact: ["/payments"],
  },
];

export const opsMetaRoutes: NavRoute[] = [
  { href: "/ops/meta", label: "Notes", exact: ["/ops/meta"] },
  { href: "/contacts", label: "Contacts", exact: ["/contacts"] },
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
  if (
    route.href === "/vendor-bills" &&
    (pathname === "/vendor-bills" || /^\/projects\/\d+\/vendor-bills$/.test(pathname))
  ) {
    return true;
  }
  if (
    route.href === "/expenses" &&
    (pathname === "/expenses" || /^\/projects\/\d+\/expenses$/.test(pathname))
  ) {
    return true;
  }
  const exactMatches = route.exact ?? [route.href];
  if (exactMatches.includes(pathname)) {
    return true;
  }
  const prefixMatches = route.startsWith ?? [];
  return prefixMatches.some((prefix) => pathname.startsWith(prefix));
}
