"use client";

/**
 * Mobile navigation drawer, visible only at ≤700px.
 *
 * Renders a fixed header bar (hamburger + theme toggle) and a slide-out
 * drawer containing all workflow routes, ops/meta routes, and actions.
 * On public document routes it renders a minimal header bar instead.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearClientSession } from "@/features/session/client-session";
import { isPublicDocumentRoute } from "@/features/session/public-routes";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import { isRouteActive, opsMetaRoutes, workflowRoutes } from "../nav-routes";
import styles from "./mobile-drawer.module.css";

const THEME_KEY = "bnc-theme";

function toggleTheme() {
  const current =
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch {
    // no-op
  }
}

/**
 * Expand the billing_menu route into its two sub-links (Invoices, Bills).
 * All other routes pass through as-is. Returns a flat list of link items.
 */
function expandedWorkflowLinks(pathname: string) {
  const pathProjectMatch = pathname.match(/^\/projects\/(\d+)(?:\/|$)/);
  const projectId = pathProjectMatch?.[1] ?? null;

  const links: { href: string; label: string; indented?: boolean; active: boolean }[] = [];
  for (const route of workflowRoutes) {
    if (route.kind === "billing_menu") {
      const billsHref = projectId
        ? `/bills?project=${encodeURIComponent(projectId)}`
        : "/bills";
      links.push({
        href: "/invoices",
        label: "Invoices",
        indented: true,
        active: pathname === "/invoices",
      });
      links.push({
        href: billsHref,
        label: "Bills",
        indented: true,
        active: pathname === "/bills",
      });
    } else {
      links.push({
        href: route.href,
        label: route.label,
        active: isRouteActive(pathname, route),
      });
    }
  }
  return links;
}

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

  // Public document routes: minimal header (Home + Print + Theme).
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
            <button type="button" className={styles.headerButton} onClick={toggleTheme}>
              Theme
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
  const workflowLinks = expandedWorkflowLinks(pathname);
  const isOrganizationPath = pathname === "/ops/organization";

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
        <button type="button" className={styles.headerButton} onClick={toggleTheme}>
          Theme
        </button>
      </header>

      {isOpen ? (
        <>
          <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
          <nav className={styles.drawer} aria-label="Mobile navigation">
            {organization ? (
              <div className={styles.drawerHeader}>
                <Link
                  href="/ops/organization"
                  className={`${styles.orgLink} ${isOrganizationPath ? styles.navLinkActive : ""}`}
                  onClick={() => setIsOpen(false)}
                >
                  {organization.displayName} (WIP)
                </Link>
              </div>
            ) : null}

            <div className={styles.drawerNav}>
              <span className={styles.sectionLabel}>Workflow</span>
              {workflowLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`${styles.navLink} ${link.active ? styles.navLinkActive : ""} ${link.indented ? styles.navLinkIndented : ""}`}
                  onClick={() => setIsOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
            </div>

            <div className={styles.divider} />

            <div className={styles.drawerNav}>
              <span className={styles.sectionLabel}>Operations</span>
              {opsMetaRoutes.map((route) => (
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
