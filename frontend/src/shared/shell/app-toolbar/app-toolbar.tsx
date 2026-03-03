/**
 * Top-level application toolbar rendered at the very top of every page.
 *
 * Contains the organization link, ops/meta dropdown, print button,
 * theme toggle, and logout. Visibility of individual controls depends
 * on session state and whether the current route is a public document view.
 */
"use client";

import { isPublicDocumentRoute } from "@/features/session/public-routes";
import { useEffect, useRef, useState } from "react";
import { clearClientSession } from "@/features/session/client-session";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isRouteActive, opsMetaRoutes } from "../nav-routes";
import styles from "./app-toolbar.module.css";

// ---------------------------------------------------------------------------
// Constants and types
// ---------------------------------------------------------------------------

const THEME_KEY = "bnc-theme";
type ThemeMode = "light" | "dark";

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
// Theme persistence
// ---------------------------------------------------------------------------

/** Write the chosen theme to the DOM and persist it to localStorage. */
function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // no-op: localStorage can be unavailable in restricted environments
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Render the persistent toolbar at the top of the viewport.
 *
 * Authenticated users see the full set of controls (org link,
 * ops/meta, print, theme, logout). Public document routes show
 * only a "Home" link, print, and theme toggle so customers get
 * a minimal chrome-free experience.
 */
export function AppToolbar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { token, organization } = useSharedSessionAuth();
  const hasSession = Boolean(token);
  const isPublicDocument = isPublicDocumentRoute(pathname);
  const isOrganizationPath = pathname === "/ops/organization";
  const hasActiveOpsMeta = opsMetaRoutes.some((route) => isRouteActive(pathname, route));
  const opsMetaMenuRef = useRef<HTMLDetailsElement>(null);

  /** Close all open `<details>` menus. */
  function closeMenus() {
    opsMetaMenuRef.current?.removeAttribute("open");
  }

  /** Toggle between light and dark themes. */
  function toggleTheme() {
    const current =
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next: ThemeMode = current === "dark" ? "light" : "dark";
    applyTheme(next);
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
      {hasSession && !isPublicDocument && organization ? (
        <Link
          href="/ops/organization"
          className={`${styles.button} ${isOrganizationPath ? styles.buttonActive : ""}`}
          title={`Organization slug: ${organization.slug}`}
        >
          {organization.displayName} Organization (WIP)
        </Link>
      ) : null}
      {hasSession && isPublicDocument ? (
        <Link href="/" className={styles.button}>
          Home
        </Link>
      ) : null}
      {hasSession && !isPublicDocument ? (
        <details ref={opsMetaMenuRef} className={styles.menu}>
          <summary className={`${styles.button} ${hasActiveOpsMeta ? styles.buttonActive : ""}`}>
            Ops / Meta
          </summary>
          <div className={styles.menuList} role="menu" aria-label="Ops and metadata tools">
            {opsMetaRoutes.map((route) => (
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
          </div>
        </details>
      ) : null}
      {isPublicDocument || (hasSession && isPrintableRoute(pathname)) ? (
        <button type="button" className={styles.button} onClick={printPage}>
          Print
        </button>
      ) : null}
      <button type="button" className={styles.themeToggle} onClick={toggleTheme} aria-label="Toggle theme">
        Toggle theme
      </button>
      {hasSession ? (
        <button type="button" className={styles.logout} onClick={logout}>
          Logout
        </button>
      ) : null}
    </div>
  );
}
