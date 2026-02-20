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
    href: "/change-orders",
    label: "3 Change Orders",
    exact: ["/change-orders"],
  },
  {
    href: "/invoices",
    label: "4 Invoices",
    exact: ["/invoices"],
  },
  {
    href: "/vendor-bills",
    label: "5 Vendor Bills",
    exact: ["/vendor-bills", "/vendor-bills-placeholder"],
  },
  {
    href: "/expenses",
    label: "6 Expenses",
    exact: ["/expenses", "/expenses-placeholder"],
  },
  {
    href: "/payments",
    label: "7 Payments",
    exact: ["/payments"],
  },
];

export const opsMetaRoutes: NavRoute[] = [
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
    (pathname === "/vendor-bills" || pathname === "/vendor-bills-placeholder" || /^\/projects\/\d+\/vendor-bills$/.test(pathname))
  ) {
    return true;
  }
  if (
    route.href === "/expenses" &&
    (pathname === "/expenses" || pathname === "/expenses-placeholder" || /^\/projects\/\d+\/expenses$/.test(pathname))
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
