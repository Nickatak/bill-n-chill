"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import styles from "./workflow-breadcrumbs.module.css";

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

const INTAKE_CRUMB: CrumbDef = { href: "/intake/quick-add", label: "Intake" };
const PROJECTS_HUB_CRUMB: CrumbDef = { href: "/projects", label: "Projects" };
const BILLING_HUB_CRUMB: CrumbDef = { href: "/invoices", label: "Billing" };
const META_HUB_CRUMB: CrumbDef = { href: "/customers", label: "Ops / Meta" };
const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
const legacyProjectScopedPrefixes = [
  "/change-orders",
  "/invoices",
];

const hierarchyRules: HierarchyRule[] = [
  {
    when: (pathname) => pathname === "/" || pathname === "/intake/quick-add",
    crumbs: [INTAKE_CRUMB],
  },
  {
    when: (pathname) => pathname === "/projects",
    crumbs: [PROJECTS_HUB_CRUMB],
  },
  {
    when: (pathname) =>
      /^\/projects\/\d+\/estimates$/.test(pathname),
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
    crumbs: [{ href: "/change-orders", label: "Change Orders" }],
  },
  {
    when: (pathname) => pathname === "/invoices",
    crumbs: [BILLING_HUB_CRUMB, { href: "/invoices", label: "Invoices" }],
  },
  {
    when: (pathname) =>
      pathname === "/bills",
    crumbs: [BILLING_HUB_CRUMB, { href: "/bills", label: "Bills" }],
  },
  {
    when: (pathname) => pathname === "/ops/organization",
    crumbs: [
      META_HUB_CRUMB,
      { href: "/ops/organization", label: "Organization" },
    ],
  },
  {
    when: (pathname) => pathname === "/customers",
    crumbs: [{ href: "/customers", label: "Customers" }],
  },
  {
    when: (pathname) => pathname === "/vendors",
    crumbs: [
      META_HUB_CRUMB,
      { href: "/vendors", label: "Vendors" },
    ],
  },
  {
    when: (pathname) => pathname === "/cost-codes",
    crumbs: [
      META_HUB_CRUMB,
      { href: "/cost-codes", label: "Cost Codes" },
    ],
  },
  {
    when: (pathname) => pathname === "/financials-auditing",
    crumbs: [
      PROJECTS_HUB_CRUMB,
      { href: "/financials-auditing", label: "Financials & Accounting" },
    ],
  },
  {
    when: (pathname) => pathname === "/settings/intake",
    crumbs: [
      META_HUB_CRUMB,
      { href: "/settings/intake", label: "Settings" },
    ],
  },
  {
    when: (pathname) => pathname === "/ops/meta/help",
    crumbs: [
      META_HUB_CRUMB,
      { href: "/ops/meta/help", label: "Help" },
    ],
  },
  {
    when: (pathname) => pathname.startsWith("/settings/"),
    crumbs: [META_HUB_CRUMB, { href: "/settings/intake", label: "Settings" }],
  },
];

function buildCrumbs(pathname: string, organizationLabel: string): Crumb[] {
  const matchingRule = hierarchyRules.find((rule) => rule.when(pathname));
  const crumbDefs = matchingRule?.crumbs ?? [PROJECTS_HUB_CRUMB];
  const orgRootCrumb: CrumbDef = {
    href: "/projects",
    label: organizationLabel,
  };
  const fullCrumbDefs = [orgRootCrumb, ...crumbDefs];

  return fullCrumbDefs.map((crumb, index) => ({
    href: crumb.href,
    label: crumb.label,
    isCurrent: index === fullCrumbDefs.length - 1,
  }));
}

function isLegacyProjectScopedRoute(pathname: string): boolean {
  return legacyProjectScopedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isBillingRoute(pathname: string): boolean {
  return pathname === "/invoices" || pathname === "/bills";
}

function projectScopedHref(href: string, projectId: string): string {
  if (href === "/projects") {
    return `/projects?project=${encodeURIComponent(projectId)}`;
  }
  if (href === "/estimates") {
    return `/projects/${encodeURIComponent(projectId)}/estimates`;
  }
  if (href === "/budgets/analytics") {
    return `/projects/${encodeURIComponent(projectId)}/budgets/analytics`;
  }
  if (href === "/change-orders") {
    return `/projects/${encodeURIComponent(projectId)}/change-orders`;
  }
  if (href === "/invoices") {
    return `/invoices?project=${encodeURIComponent(projectId)}`;
  }
  if (href === "/bills") {
    return `/bills?project=${encodeURIComponent(projectId)}`;
  }
  if (href === "/activity") {
    return `/projects/${encodeURIComponent(projectId)}/activity`;
  }
  return href;
}

export function WorkflowBreadcrumbs() {
  const { token, organization } = useSharedSessionAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathnameValue = pathname || "/";
  const pathProjectMatch = pathnameValue.match(/^\/projects\/(\d+)(?:\/|$)/);
  const pathProjectId = pathProjectMatch?.[1] ?? null;
  const queryProjectId = searchParams.get("project");
  const projectId =
    pathProjectId ??
    (queryProjectId && /^\d+$/.test(queryProjectId) ? queryProjectId : null);
  const organizationLabel = organization?.displayName?.trim() || "Organization";
  const [projectTitle, setProjectTitle] = useState("");
  const baseCrumbs = buildCrumbs(pathnameValue, organizationLabel);
  const shouldShowProjectCrumb = Boolean(
    projectId &&
      /^\d+$/.test(projectId) &&
      (Boolean(pathProjectId) || isLegacyProjectScopedRoute(pathnameValue)),
  ) && !isBillingRoute(pathnameValue);

  useEffect(() => {
    let cancelled = false;

    async function loadProjectTitle() {
      if (!shouldShowProjectCrumb || !projectId || !token) {
        setProjectTitle("");
        return;
      }

      try {
        const response = await fetch(`${defaultApiBaseUrl}/projects/${projectId}/`, {
          headers: buildAuthHeaders(token),
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
          href: `/projects?project=${encodeURIComponent(projectId!)}`,
          label: `Project: ${projectTitle || `Project #${projectId}`}`,
          isCurrent: false,
        };
        const projectsIndex = baseCrumbs.findIndex(
          (crumb, index) => index > 0 && crumb.href === "/projects" && crumb.label === PROJECTS_HUB_CRUMB.label,
        );
        const nextCrumbs = [...baseCrumbs];
        if (projectsIndex >= 0) {
          nextCrumbs.splice(projectsIndex, 1, projectHubCrumb);
        } else {
          nextCrumbs.splice(1, 0, projectHubCrumb);
        }
        return nextCrumbs.map((crumb, index, source) => ({
          ...crumb,
          isCurrent: index === source.length - 1,
        }));
      })()
    : baseCrumbs;

  return (
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
      <div className={styles.inner}>
        {crumbs.map((crumb, index) => {
          const href = projectId ? projectScopedHref(crumb.href, projectId) : crumb.href;
          const key = `${crumb.href}-${crumb.label}`;
          return (
            <span key={key} className={styles.item}>
              {crumb.isCurrent ? (
                <span className={styles.current} aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link href={href} className={styles.link}>
                  {crumb.label}
                </Link>
              )}
              {index < crumbs.length - 1 ? <span className={styles.separator}>/</span> : null}
            </span>
          );
        })}
      </div>
    </nav>
  );
}
