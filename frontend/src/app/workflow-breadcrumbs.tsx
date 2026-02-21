"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";

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
const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
const legacyProjectScopedPrefixes = [
  "/estimates",
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
      /^\/projects\/\d+\/estimates$/.test(pathname) ||
      pathname.startsWith("/estimates/"),
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/estimates", label: "Estimates" }],
  },
  {
    when: (pathname) => /^\/projects\/\d+\/budgets\/analytics$/.test(pathname),
    crumbs: [
      PROJECTS_HUB_CRUMB,
      { href: "/budgets/analytics", label: "Budgets" },
      { href: "/budgets/analytics", label: "Analytics" },
    ],
  },
  {
    when: (pathname) => /^\/projects\/\d+\/activity$/.test(pathname),
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/activity", label: "Activity" }],
  },
  {
    when: (pathname) => pathname === "/change-orders" || /^\/projects\/\d+\/change-orders$/.test(pathname),
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/change-orders", label: "Change Orders" }],
  },
  {
    when: (pathname) => pathname === "/invoices",
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/invoices", label: "Invoices" }],
  },
  {
    when: (pathname) =>
      pathname === "/vendor-bills" ||
      /^\/projects\/\d+\/vendor-bills$/.test(pathname),
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/vendor-bills", label: "Vendor Bills" }],
  },
  {
    when: (pathname) =>
      pathname === "/expenses" ||
      /^\/projects\/\d+\/expenses$/.test(pathname),
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/expenses", label: "Expenses" }],
  },
  {
    when: (pathname) => pathname === "/payments",
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/payments", label: "Payments" }],
  },
  {
    when: (pathname) => pathname === "/ops/meta",
    crumbs: [
      PROJECTS_HUB_CRUMB,
      { href: "/ops/meta", label: "Meta" },
      { href: "/ops/meta", label: "Notes" },
    ],
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
    when: (pathname) => pathname === "/financials-auditing",
    crumbs: [
      PROJECTS_HUB_CRUMB,
      { href: "/financials-auditing", label: "Meta" },
      { href: "/financials-auditing", label: "Financials & Auditing" },
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

function isLegacyProjectScopedRoute(pathname: string): boolean {
  return legacyProjectScopedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function projectScopedHref(href: string, projectId: string): string {
  if (href === "/projects") {
    return `/projects/${encodeURIComponent(projectId)}`;
  }
  if (href === "/estimates") {
    return `/projects/${encodeURIComponent(projectId)}/estimates`;
  }
  if (href === "/budgets/analytics") {
    return `/projects/${encodeURIComponent(projectId)}/budgets/analytics`;
  }
  if (href === "/vendor-bills") {
    return `/projects/${encodeURIComponent(projectId)}/vendor-bills`;
  }
  if (href === "/expenses") {
    return `/projects/${encodeURIComponent(projectId)}/expenses`;
  }
  if (href === "/change-orders") {
    return `/projects/${encodeURIComponent(projectId)}/change-orders`;
  }
  if (href === "/activity") {
    return `/projects/${encodeURIComponent(projectId)}/activity`;
  }
  return href;
}

export function WorkflowBreadcrumbs() {
  const { token } = useSharedSessionAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathnameValue = pathname || "/";
  const pathProjectMatch = pathnameValue.match(/^\/projects\/(\d+)(?:\/|$)/);
  const pathProjectId = pathProjectMatch?.[1] ?? null;
  const queryProjectId = searchParams.get("project");
  const projectId =
    pathProjectId ??
    (queryProjectId && /^\d+$/.test(queryProjectId) ? queryProjectId : null);
  const [projectTitle, setProjectTitle] = useState("");
  const baseCrumbs = buildCrumbs(pathnameValue);
  const shouldShowProjectCrumb = Boolean(
    projectId &&
      /^\d+$/.test(projectId) &&
      (Boolean(pathProjectId) || isLegacyProjectScopedRoute(pathnameValue)),
  );

  useEffect(() => {
    let cancelled = false;

    async function loadProjectTitle() {
      if (!shouldShowProjectCrumb || !projectId || !token) {
        setProjectTitle("");
        return;
      }

      try {
        const response = await fetch(`${defaultApiBaseUrl}/projects/${projectId}/`, {
          headers: { Authorization: `Token ${token}` },
        });
        const payload = await response.json();
        if (!response.ok) {
          if (!cancelled) {
            setProjectTitle("");
          }
          return;
        }
        if (!cancelled) {
          setProjectTitle(String(payload?.data?.name ?? ""));
        }
      } catch {
        if (!cancelled) {
          setProjectTitle("");
        }
      }
    }

    void loadProjectTitle();

    return () => {
      cancelled = true;
    };
  }, [projectId, shouldShowProjectCrumb, token]);

  const crumbs = shouldShowProjectCrumb
    ? (() => {
        const projectHubCrumb: Crumb = {
          href: `/projects/${encodeURIComponent(projectId!)}`,
          label: `Project: ${projectTitle || `Project #${projectId}`}`,
          isCurrent: false,
        };
        const projectsIndex = baseCrumbs.findIndex((crumb) => crumb.href === "/projects");
        if (projectsIndex >= 0) {
          return [
            ...baseCrumbs.slice(0, projectsIndex),
            projectHubCrumb,
            ...baseCrumbs.slice(projectsIndex + 1),
          ].map((crumb, index, source) => ({
            ...crumb,
            isCurrent: index === source.length - 1,
          }));
        }
        return [projectHubCrumb, ...baseCrumbs].map((crumb, index, source) => ({
          ...crumb,
          isCurrent: index === source.length - 1,
        }));
      })()
    : baseCrumbs;

  return (
    <nav className="workflowBreadcrumbs" aria-label="Breadcrumb">
      <div className="workflowBreadcrumbsInner">
        {crumbs.map((crumb, index) => {
          const href = projectId ? projectScopedHref(crumb.href, projectId) : crumb.href;
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
