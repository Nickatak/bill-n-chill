"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type Crumb = {
  href: string;
  label: string;
  isCurrent: boolean;
};

type CrumbDef = {
  href: string;
  label: string;
};

type HierarchyRule = {
  when: (pathname: string) => boolean;
  crumbs: CrumbDef[];
};

const ROOT_CRUMB: CrumbDef = { href: "/", label: "Intake" };
const PROJECTS_HUB_CRUMB: CrumbDef = { href: "/projects", label: "Projects" };
const projectScopedPrefixes = [
  "/estimates",
  "/budgets",
  "/change-orders",
  "/invoices",
  "/vendor-bills",
  "/expenses",
  "/payments",
];

const hierarchyRules: HierarchyRule[] = [
  {
    when: (pathname) => pathname === "/" || pathname === "/intake/quick-add",
    crumbs: [ROOT_CRUMB, { href: "/intake/quick-add", label: "Quick Add" }],
  },
  {
    when: (pathname) => pathname === "/projects",
    crumbs: [PROJECTS_HUB_CRUMB],
  },
  {
    when: (pathname) => pathname === "/estimates/post-create",
    crumbs: [
      PROJECTS_HUB_CRUMB,
      { href: "/estimates", label: "Estimates" },
      { href: "/estimates/post-create", label: "Post Create" },
    ],
  },
  {
    when: (pathname) =>
      pathname === "/estimates" ||
      pathname === "/estimates-placeholder" ||
      pathname.startsWith("/estimates/"),
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/estimates", label: "Estimates" }],
  },
  {
    when: (pathname) => pathname === "/budgets" || pathname === "/budgets-placeholder",
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/budgets", label: "Budgets" }],
  },
  {
    when: (pathname) => pathname === "/change-orders",
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/change-orders", label: "Change Orders" }],
  },
  {
    when: (pathname) => pathname === "/invoices",
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/invoices", label: "Invoices" }],
  },
  {
    when: (pathname) => pathname === "/vendor-bills" || pathname === "/vendor-bills-placeholder",
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/vendor-bills", label: "Vendor Bills" }],
  },
  {
    when: (pathname) => pathname === "/expenses" || pathname === "/expenses-placeholder",
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/expenses", label: "Expenses" }],
  },
  {
    when: (pathname) => pathname === "/payments",
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/payments", label: "Payments" }],
  },
  {
    when: (pathname) => pathname === "/contacts",
    crumbs: [
      PROJECTS_HUB_CRUMB,
      { href: "/contacts", label: "Meta" },
      { href: "/contacts", label: "Contacts" },
    ],
  },
  {
    when: (pathname) => pathname === "/vendors",
    crumbs: [
      PROJECTS_HUB_CRUMB,
      { href: "/vendors", label: "Meta" },
      { href: "/vendors", label: "Vendors" },
    ],
  },
  {
    when: (pathname) => pathname === "/cost-codes",
    crumbs: [
      PROJECTS_HUB_CRUMB,
      { href: "/cost-codes", label: "Meta" },
      { href: "/cost-codes", label: "Cost Codes" },
    ],
  },
  {
    when: (pathname) => pathname === "/settings/intake",
    crumbs: [
      PROJECTS_HUB_CRUMB,
      { href: "/settings/intake", label: "Meta" },
      { href: "/settings/intake", label: "Intake Form" },
    ],
  },
  {
    when: (pathname) => pathname.startsWith("/settings/"),
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/settings/intake", label: "Meta" }],
  },
];

function buildCrumbs(pathname: string): Crumb[] {
  const matchingRule = hierarchyRules.find((rule) => rule.when(pathname));
  const crumbDefs = matchingRule?.crumbs ?? [PROJECTS_HUB_CRUMB];

  return crumbDefs.map((crumb, index) => ({
    href: crumb.href,
    label: crumb.label,
    isCurrent: index === crumbDefs.length - 1,
  }));
}

function isProjectScopedRoute(pathname: string): boolean {
  return projectScopedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname === `${prefix}-placeholder`,
  );
}

export function WorkflowBreadcrumbs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const baseCrumbs = buildCrumbs(pathname || "/");
  const shouldShowProjectCrumb = Boolean(
    projectId && /^\d+$/.test(projectId) && isProjectScopedRoute(pathname || "/"),
  );
  const crumbs = shouldShowProjectCrumb
    ? (() => {
        const projectCrumb: Crumb = {
          href: `/projects?project=${encodeURIComponent(projectId!)}`,
          label: `Project #${projectId}`,
          isCurrent: false,
        };
        const projectsIndex = baseCrumbs.findIndex((crumb) => crumb.href === "/projects");
        if (projectsIndex >= 0) {
          return [
            ...baseCrumbs.slice(0, projectsIndex + 1),
            projectCrumb,
            ...baseCrumbs.slice(projectsIndex + 1),
          ].map((crumb, index, source) => ({
            ...crumb,
            isCurrent: index === source.length - 1,
          }));
        }
        return [...baseCrumbs, projectCrumb].map((crumb, index, source) => ({
          ...crumb,
          isCurrent: index === source.length - 1,
        }));
      })()
    : baseCrumbs;

  return (
    <nav className="workflowBreadcrumbs" aria-label="Breadcrumb">
      <div className="workflowBreadcrumbsInner">
        {crumbs.map((crumb, index) => {
          const href =
            projectId && crumb.href !== "/" ? `${crumb.href}?project=${encodeURIComponent(projectId)}` : crumb.href;
          const key = `${crumb.href}-${crumb.label}`;
          return (
            <span key={key} className="workflowBreadcrumbItem">
              {crumb.isCurrent ? (
                <span className="workflowBreadcrumbCurrent" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link href={href} className="workflowBreadcrumbLink">
                  {crumb.label}
                </Link>
              )}
              {index < crumbs.length - 1 ? <span className="workflowBreadcrumbSeparator">/</span> : null}
            </span>
          );
        })}
      </div>
    </nav>
  );
}
