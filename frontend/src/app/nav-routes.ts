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
    href: "/estimates",
    label: "3 Estimates",
    exact: ["/estimates", "/estimates-placeholder"],
    startsWith: ["/estimates/"],
  },
  {
    href: "/budgets",
    label: "4 Budgets",
    exact: ["/budgets", "/budgets-placeholder"],
  },
  {
    href: "/change-orders",
    label: "5 Change Orders",
    exact: ["/change-orders"],
  },
  {
    href: "/invoices",
    label: "6 Invoices",
    exact: ["/invoices"],
  },
  {
    href: "/vendor-bills",
    label: "7 Vendor Bills",
    exact: ["/vendor-bills", "/vendor-bills-placeholder"],
  },
  {
    href: "/expenses",
    label: "8 Expenses",
    exact: ["/expenses", "/expenses-placeholder"],
  },
  {
    href: "/payments",
    label: "9 Payments",
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
  const exactMatches = route.exact ?? [route.href];
  if (exactMatches.includes(pathname)) {
    return true;
  }
  const prefixMatches = route.startsWith ?? [];
  return prefixMatches.some((prefix) => pathname.startsWith(prefix));
}
