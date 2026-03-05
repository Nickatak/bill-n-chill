/**
 * Horizontal workflow navbar showing the numbered workflow steps.
 *
 * Renders one link per step from `workflowRoutes`.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isRouteActive, workflowRoutes } from "../nav-routes";
import styles from "./workflow-navbar.module.css";

/** Map workflow route hrefs to onboarding target names for guide arrows. */
const ONBOARDING_TARGETS: Record<string, string> = {
  "/customers": "customers",
  "/projects": "projects",
  "/invoices": "invoices",
};

/**
 * Render the primary workflow step navbar.
 *
 * Each step maps to a `NavRoute` from `workflowRoutes` and renders as
 * a plain link.
 */
export function WorkflowNavbar() {
  const pathname = usePathname() ?? "";

  return (
    <nav className={styles.nav} aria-label="MVP workflow order">
      <div className={styles.inner}>
        <div className={styles.scroll}>
          {workflowRoutes.map((route) => {
            const isActive = isRouteActive(pathname, route);
            const onboardingTarget = ONBOARDING_TARGETS[route.href];
            return (
              <Link
                key={route.href}
                href={route.href}
                className={`${styles.link} ${isActive ? styles.linkActive : ""}`}
                {...(onboardingTarget ? { "data-onboarding-target": onboardingTarget } : {})}
              >
                {route.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
