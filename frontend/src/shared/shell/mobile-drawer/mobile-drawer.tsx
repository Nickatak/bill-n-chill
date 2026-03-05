"use client";

/**
 * Mobile navigation drawer, visible only at ≤700px.
 *
 * Renders a fixed header bar (hamburger) and a slide-out drawer containing
 * all workflow routes, business menu routes, and actions.
 * On public document routes it renders a minimal header bar instead.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearClientSession } from "@/features/session/client-session";
import { isPublicDocumentRoute } from "@/features/session/public-routes";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import { isRouteActive, businessMenuRoutes, workflowRoutes } from "../nav-routes";
import styles from "./mobile-drawer.module.css";

export function MobileDrawer() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { token, organization } = useSharedSessionAuth();
  const hasSession = Boolean(token);
  const isPublicDocument = isPublicDocumentRoute(pathname);
  const [isOpen, setIsOpen] = useState(false);

  // Close drawer on Escape.
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Lock body scroll when drawer is open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  function logout() {
    setIsOpen(false);
    clearClientSession();
    router.push("/");
    router.refresh();
  }

  function printPage() {
    setIsOpen(false);
    window.print();
  }

  // Public document routes: minimal header (Home + Print).
  if (isPublicDocument) {
    return (
      <div className={styles.root}>
        <header className={styles.header}>
          <div className={styles.headerActions}>
            {hasSession ? (
              <Link href="/" className={styles.headerButton}>
                Home
              </Link>
            ) : null}
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.headerButton} onClick={() => window.print()}>
              Print
            </button>
          </div>
        </header>
      </div>
    );
  }

  // Unauthenticated: render nothing (auth-hint bar handles this).
  if (!hasSession) {
    return null;
  }

  // Authenticated: full hamburger + drawer.
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button
          type="button"
          className={`${styles.hamburger} ${isOpen ? styles.hamburgerOpen : ""}`}
          aria-label={isOpen ? "Close menu" : "Open menu"}
          aria-expanded={isOpen}
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      {isOpen ? (
        <>
          <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
          <nav className={styles.drawer} aria-label="Mobile navigation">
            {organization ? (
              <div className={styles.drawerHeader}>
                <span className={styles.orgLabel}>{organization.displayName}</span>
              </div>
            ) : null}

            <div className={styles.drawerNav}>
              <span className={styles.sectionLabel}>Workflow</span>
              {workflowRoutes.map((route) => (
                <Link
                  key={route.href}
                  href={route.href}
                  className={`${styles.navLink} ${isRouteActive(pathname, route) ? styles.navLinkActive : ""}`}
                  onClick={() => setIsOpen(false)}
                >
                  {route.label}
                </Link>
              ))}
            </div>

            <div className={styles.divider} />

            <div className={styles.drawerNav}>
              <span className={styles.sectionLabel}>Business</span>
              {businessMenuRoutes.map((route) => (
                <Link
                  key={route.href}
                  href={route.href}
                  className={`${styles.navLink} ${isRouteActive(pathname, route) ? styles.navLinkActive : ""}`}
                  onClick={() => setIsOpen(false)}
                >
                  {route.label}
                </Link>
              ))}
            </div>

            <div className={styles.divider} />

            <div className={styles.drawerNav}>
              <button type="button" className={styles.actionButton} onClick={printPage}>
                Print
              </button>
              <button type="button" className={styles.actionButton} onClick={logout}>
                Logout
              </button>
            </div>
          </nav>
        </>
      ) : null}
    </div>
  );
}
