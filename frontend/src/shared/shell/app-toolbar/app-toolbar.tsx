/**
 * Top-level application toolbar rendered at the very top of every page.
 *
 * Contains the organization dropdown menu, print button, and logout.
 * Visibility of individual controls depends on session state and
 * whether the current route is a public document view.
 */
"use client";

import { isPublicDocumentRoute } from "@/features/session/public-routes";
import { Fragment, useEffect, useRef } from "react";
import { clearClientSession } from "@/features/session/client-session";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isRouteActive, businessMenuRoutes } from "../nav-routes";
import styles from "./app-toolbar.module.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Internal routes where the Print button should be visible. */
const PRINTABLE_ROUTE_PATTERNS = [
  /^\/projects\/[^/]+\/estimates\/?$/,
  /^\/projects\/[^/]+\/change-orders\/?$/,
  /^\/invoices\/?$/,
  /^\/change-orders\/?$/,
];

function isPrintableRoute(pathname: string): boolean {
  return PRINTABLE_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));
}

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
  const { token, organization } = useSharedSessionAuth();
  const hasSession = Boolean(token);
  const isPublicDocument = isPublicDocumentRoute(pathname);
  const hasActiveBusinessMenu = businessMenuRoutes.some((route) => isRouteActive(pathname, route));
  const opsMetaMenuRef = useRef<HTMLDetailsElement>(null);

  /** Close all open `<details>` menus. */
  function closeMenus() {
    opsMetaMenuRef.current?.removeAttribute("open");
  }

  /** Clear the session and redirect to the home / login page. */
  function logout() {
    clearClientSession();
    router.push("/");
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
    <div className={styles.controls}>
      {hasSession && isPublicDocument ? (
        <Link href="/" className={styles.button}>
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
                    {...(route.href === "/ops/organization" ? { "data-onboarding-target": "organization-item" } : {})}
                  >
                    {route.label}
                  </Link>
                </Fragment>
              );
            })}
          </div>
        </details>
      ) : null}
      {isPublicDocument || (hasSession && isPrintableRoute(pathname)) ? (
        <button type="button" className={styles.button} onClick={printPage}>
          Print
        </button>
      ) : null}
      {hasSession ? (
        <button type="button" className={styles.logout} onClick={logout}>
          Logout
        </button>
      ) : null}
    </div>
  );
}
