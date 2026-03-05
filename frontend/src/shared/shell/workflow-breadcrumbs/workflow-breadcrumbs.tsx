/**
 * Breadcrumb trail rendered below the workflow navbar.
 *
 * Builds a hierarchical path (Organization > Section > Page) from a
 * static rule table. When the current route is project-scoped, the
 * breadcrumbs inject a "Project: <name>" segment and rewrite all
 * sibling hrefs to carry the project context (path param or query).
 *
 * Project names are fetched from the API on demand so the breadcrumb
 * shows a human-readable label instead of just a numeric id.
 */
"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import styles from "./workflow-breadcrumbs.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Shared crumb anchors
// ---------------------------------------------------------------------------

const CUSTOMERS_HUB_CRUMB: CrumbDef = { href: "/customers", label: "Customers" };
const PROJECTS_HUB_CRUMB: CrumbDef = { href: "/projects", label: "Projects" };
const BILLING_HUB_CRUMB: CrumbDef = { href: "/invoices", label: "Billing" };
const META_HUB_CRUMB: CrumbDef = { href: "/customers", label: "Ops / Meta" };

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

/**
 * Top-level routes that historically accepted `?project=<id>` for
 * project scoping before the nested `/projects/:id/...` URLs existed.
 */
const legacyProjectScopedPrefixes = [
  "/change-orders",
  "/invoices",
];

/**
 * Static rule table mapping pathnames to breadcrumb hierarchies.
 * The first matching rule wins. If no rule matches, the breadcrumbs
 * fall back to the Projects hub crumb.
 */
const hierarchyRules: HierarchyRule[] = [
  {
    when: (pathname) => pathname === "/",
    crumbs: [{ href: "/", label: "Dashboard" }],
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
    when: (pathname) => /^\/projects\/\d+\/audit-trail$/.test(pathname),
    crumbs: [PROJECTS_HUB_CRUMB, { href: "/audit-trail", label: "Audit Trail" }],
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
    crumbs: [CUSTOMERS_HUB_CRUMB],
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
    when: (pathname) => pathname === "/onboarding",
    crumbs: [
      META_HUB_CRUMB,
      { href: "/onboarding", label: "Get Started" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Crumb builders
// ---------------------------------------------------------------------------

/**
 * Build the base breadcrumb array for a given pathname.
 *
 * Always prepends the organization root crumb so every trail starts
 * with the org name as a home anchor.
 */
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

/** Check if a pathname belongs to a legacy top-level route that uses `?project=` scoping. */
function isLegacyProjectScopedRoute(pathname: string): boolean {
  return legacyProjectScopedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Billing hub routes don't show a project crumb even when project-scoped. */
function isBillingRoute(pathname: string): boolean {
  return pathname === "/invoices" || pathname === "/bills";
}

/**
 * Rewrite a generic crumb href to carry the active project context.
 *
 * Routes that live under `/projects/:id/...` get nested paths;
 * top-level routes that accept project scoping get a `?project=` param.
 */
function projectScopedHref(href: string, projectId: string): string {
  if (href === "/projects") {
    return `/projects?project=${encodeURIComponent(projectId)}`;
  }
  if (href === "/estimates") {
    return `/projects/${encodeURIComponent(projectId)}/estimates`;
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
  if (href === "/audit-trail") {
    return `/projects/${encodeURIComponent(projectId)}/audit-trail`;
  }
  return href;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Render a breadcrumb trail reflecting the current route hierarchy.
 *
 * When a project is in scope (from the URL path or `?project=` query),
 * the trail injects a project crumb and rewrites sibling hrefs so
 * navigation stays within the project context.
 */
export function WorkflowBreadcrumbs() {
  const { token, organization } = useSharedSessionAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Derive project id from either the path segment or query param.
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

  // Fetch the project name so the breadcrumb shows "Project: Riverside Remodel"
  // instead of "Project #42". Skipped when no project is in scope.
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

  // When project-scoped, splice a project crumb into the trail,
  // replacing the generic "Projects" hub crumb if present.
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
