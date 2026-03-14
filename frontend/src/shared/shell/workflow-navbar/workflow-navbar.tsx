/**
 * Horizontal workflow navbar showing the numbered workflow steps.
 *
 * Renders one link per step from `workflowRoutes`.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  isRouteActive,
  workflowRoutes,
  debugWorkflowRoutes,
  debugBusinessMenuRoutes,
  isDebugMode,
} from "../nav-routes";
import styles from "./workflow-navbar.module.css";

/** Map workflow route hrefs to onboarding target names for guide arrows. */
const ONBOARDING_TARGETS: Record<string, string> = {
  "/customers": "customers",
  "/projects": "projects",
  "/accounting": "accounting",
  "/bills": "bills",
};

/** All debug routes combined into one dropdown. */
const allDebugRoutes = [...debugWorkflowRoutes, ...debugBusinessMenuRoutes];

/**
 * Render the primary workflow step navbar.
 *
 * Each step maps to a `NavRoute` from `workflowRoutes` and renders as
 * a plain link. When NEXT_PUBLIC_DEBUG is enabled, a "Dev" dropdown
 * appears with all debug-only pages.
 */
export function WorkflowNavbar() {
  const pathname = usePathname() ?? "";
  const devMenuRef = useRef<HTMLDetailsElement>(null);
  const hasActiveDevRoute = allDebugRoutes.some((r) => isRouteActive(pathname, r));

  // Close dev menu on route change.
  useEffect(() => {
    devMenuRef.current?.removeAttribute("open");
  }, [pathname]);

  // Close dev menu on outside click.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target || devMenuRef.current?.contains(target)) return;
      devMenuRef.current?.removeAttribute("open");
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

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
        {isDebugMode ? (
          <details ref={devMenuRef} className={styles.devMenu}>
            <summary className={`${styles.link} ${styles.devTrigger} ${hasActiveDevRoute ? styles.devTriggerActive : ""}`}>
              Dev <span className={styles.devChevron}>&#9662;</span>
            </summary>
            <div className={styles.devMenuList} role="menu" aria-label="Dev pages">
              {allDebugRoutes.map((route) => (
                <Link
                  key={route.href}
                  href={route.href}
                  className={`${styles.devMenuItem} ${isRouteActive(pathname, route) ? styles.devMenuItemActive : ""}`}
                  role="menuitem"
                >
                  {route.label}
                </Link>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </nav>
  );
}
