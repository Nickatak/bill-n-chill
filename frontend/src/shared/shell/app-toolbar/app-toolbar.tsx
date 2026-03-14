/**
 * Top-level application toolbar rendered at the very top of every page.
 *
 * Contains the organization dropdown menu, print button, and logout.
 * Visibility of individual controls depends on session state and
 * whether the current route is a public document view.
 */
"use client";

import { isPublicDocumentRoute } from "@/shared/session/public-routes";
import { Fragment, useEffect, useRef } from "react";
import { clearClientSession } from "@/shared/session/client-session";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isRouteActive, businessMenuRoutes, debugBusinessMenuRoutes, isDebugMode } from "../nav-routes";
import { usePrintable } from "../printable-context";
import lightTheme from "@/shared/styles/light-theme.module.css";
import styles from "./app-toolbar.module.css";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Render the persistent toolbar at the top of the viewport.
 *
 * Authenticated users see the full set of controls (org menu, print, logout).
 * Public document routes show only a "Home" link and print button so
 * customers get a minimal chrome-free experience.
 */
export function AppToolbar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { token, organization, isSuperuser } = useSharedSessionAuth();
  const { isPrintable } = usePrintable();
  const hasSession = Boolean(token);
  const isPublicDocument = isPublicDocumentRoute(pathname);
  const allBusinessRoutes = isDebugMode ? [...businessMenuRoutes, ...debugBusinessMenuRoutes] : businessMenuRoutes;
  const hasActiveBusinessMenu = allBusinessRoutes.some((route) => isRouteActive(pathname, route));
  const opsMetaMenuRef = useRef<HTMLDetailsElement>(null);

  /** Close all open `<details>` menus. */
  function closeMenus() {
    opsMetaMenuRef.current?.removeAttribute("open");
  }

  /** Clear the session and redirect to the login page. */
  function logout() {
    clearClientSession();
    router.push("/login");
    router.refresh();
  }

  /** Trigger the browser print dialog for the current page. */
  function printPage() {
    window.print();
  }

  // Close open menus on route change so the user starts fresh.
  useEffect(() => {
    closeMenus();
  }, [pathname]);

  // Close menus when the user clicks outside of them.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (opsMetaMenuRef.current?.contains(target)) {
        return;
      }
      closeMenus();
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <div className={`${styles.controls} ${isPublicDocument ? lightTheme.lightTheme : ""}`}>
      {hasSession && isPublicDocument ? (
        <Link href="/projects" className={styles.publicButton}>
          Home
        </Link>
      ) : null}
      {hasSession && !isPublicDocument && organization ? (
        <details ref={opsMetaMenuRef} className={styles.menu} data-onboarding-target="organization">
          <summary className={`${styles.orgTrigger} ${hasActiveBusinessMenu ? styles.orgTriggerActive : ""}`}>
            {organization.displayName} <span className={styles.chevron}>&#9662;</span>
          </summary>
          <div className={styles.menuList} role="menu" aria-label="Business setup and management">
            {businessMenuRoutes.map((route, index) => {
              const showSection =
                route.section && (index === 0 || businessMenuRoutes[index - 1].section !== route.section);
              return (
                <Fragment key={route.href}>
                  {showSection ? (
                    <span className={styles.menuSectionLabel}>{route.section}</span>
                  ) : null}
                  <Link
                    href={route.href}
                    className={`${styles.menuItem} ${isRouteActive(pathname, route) ? styles.menuItemActive : ""}`}
                    role="menuitem"
                    onClick={closeMenus}
                    {...(route.href === "/ops/organization"
                      ? { "data-onboarding-target": "organization-item" }
                      : route.href === "/onboarding"
                        ? { "data-onboarding-target": "get-started-item" }
                        : {})}
                  >
                    {route.label}
                  </Link>
                </Fragment>
              );
            })}
            {isDebugMode ? (
              <>
                <span className={styles.menuSectionLabel}>Dev</span>
                {debugBusinessMenuRoutes.map((route) => (
                  <Link
                    key={route.href}
                    href={route.href}
                    className={`${styles.menuItem} ${isRouteActive(pathname, route) ? styles.menuItemActive : ""}`}
                    role="menuitem"
                    onClick={closeMenus}
                  >
                    {route.label}
                  </Link>
                ))}
              </>
            ) : null}
          </div>
        </details>
      ) : null}
      {hasSession && !isPublicDocument && isSuperuser ? (
        <Link href="/admin/impersonate" className={styles.button}>
          Impersonate
        </Link>
      ) : null}
      {isPublicDocument || (hasSession && isPrintable) ? (
        <button type="button" className={isPublicDocument ? styles.publicButton : styles.button} onClick={printPage}>
          Print
        </button>
      ) : null}
      {hasSession ? (
        <button
          type="button"
          className={isPublicDocument ? styles.publicButtonSecondary : styles.logout}
          onClick={logout}
        >
          Logout
        </button>
      ) : null}
    </div>
  );
}
