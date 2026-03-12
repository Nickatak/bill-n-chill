"use client";

/**
 * Bottom navigation bar for mobile viewports (≤700px).
 *
 * Renders the primary workflow routes as a fixed bottom tab bar,
 * plus a "More" tab that opens a menu for secondary actions
 * (org settings, cost codes, vendors, print, logout).
 *
 * Hidden on desktop, public document routes, and when not authenticated.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearClientSession } from "@/shared/session/client-session";
import { isPublicDocumentRoute } from "@/shared/session/public-routes";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { isRouteActive, workflowRoutes, businessMenuRoutes } from "../nav-routes";
import { usePrintable } from "../printable-context";
import styles from "./mobile-bottom-nav.module.css";

export function MobileBottomNav() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { token, organization } = useSharedSessionAuth();
  const { isPrintable } = usePrintable();
  const hasSession = Boolean(token);
  const isPublicDocument = isPublicDocumentRoute(pathname);
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the "More" menu on route change.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Close on Escape.
  useEffect(() => {
    if (!moreOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [moreOpen]);

  if (!hasSession || isPublicDocument) {
    return null;
  }

  // Check if any business menu route is active (to highlight "More" tab).
  const moreIsActive = businessMenuRoutes.some((route) => isRouteActive(pathname, route));

  function logout() {
    setMoreOpen(false);
    clearClientSession();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {moreOpen ? (
        <div className={styles.backdrop} onClick={() => setMoreOpen(false)} />
      ) : null}

      {moreOpen ? (
        <div className={styles.moreMenu}>
          {organization ? (
            <div className={styles.moreHeader}>
              <span className={styles.orgLabel}>{organization.displayName}</span>
            </div>
          ) : null}

          <div className={styles.moreSection}>
            {businessMenuRoutes.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className={`${styles.moreLink} ${isRouteActive(pathname, route) ? styles.moreLinkActive : ""}`}
                onClick={() => setMoreOpen(false)}
              >
                {route.label}
              </Link>
            ))}
          </div>

          <div className={styles.moreDivider} />

          <div className={styles.moreSection}>
            {isPrintable ? (
              <button
                type="button"
                className={styles.moreAction}
                onClick={() => {
                  setMoreOpen(false);
                  window.print();
                }}
              >
                Print
              </button>
            ) : null}
            <button type="button" className={styles.moreAction} onClick={logout}>
              Logout
            </button>
          </div>
        </div>
      ) : null}

      <nav className={styles.nav} aria-label="Mobile workflow navigation">
        {workflowRoutes.map((route) => {
          const isActive = isRouteActive(pathname, route);
          return (
            <Link
              key={route.href}
              href={route.href}
              className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
            >
              <span className={styles.label}>{route.shortLabel ?? route.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`${styles.tab} ${moreIsActive || moreOpen ? styles.tabActive : ""}`}
          onClick={() => setMoreOpen((prev) => !prev)}
          aria-expanded={moreOpen}
          aria-label="More options"
        >
          <span className={styles.moreIcon}>•••</span>
          <span className={styles.label}>More</span>
        </button>
      </nav>
    </>
  );
}
