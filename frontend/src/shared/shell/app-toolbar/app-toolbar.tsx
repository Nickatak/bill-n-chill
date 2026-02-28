/**
 * Top-level application toolbar rendered at the very top of every page.
 *
 * Contains the organization link, quick-jump search, ops/meta dropdown,
 * print button, theme toggle, and logout. Visibility of individual
 * controls depends on session state and whether the current route is a
 * public document view.
 */
"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { isPublicDocumentRoute } from "@/features/session/public-routes";
import { useEffect, useMemo, useRef, useState } from "react";
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
const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

/** Shape of a single result returned by the quick-jump search API. */
type QuickJumpItem = {
  kind: string;
  record_id: number;
  label: string;
  sub_label: string;
  project_id: number | null;
  project_name: string;
  ui_href: string;
  detail_endpoint: string;
};

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
 * quick-jump, ops/meta, print, theme, logout). Public document
 * routes show only a "Home" link, print, and theme toggle so
 * customers get a minimal chrome-free experience.
 */
export function AppToolbar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { token, organization } = useSharedSessionAuth();
  const hasSession = Boolean(token);
  const isPublicDocument = isPublicDocumentRoute(pathname);
  const isOrganizationPath = pathname === "/ops/organization";
  const hasActiveOpsMeta = opsMetaRoutes.some((route) => isRouteActive(pathname, route));
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<QuickJumpItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const quickJumpMenuRef = useRef<HTMLDetailsElement>(null);
  const opsMetaMenuRef = useRef<HTMLDetailsElement>(null);
  const normalizedBaseUrl = useMemo(() => defaultApiBaseUrl.trim().replace(/\/$/, ""), []);

  /** Close all open `<details>` menus (quick-jump and ops/meta). */
  function closeMenus() {
    quickJumpMenuRef.current?.removeAttribute("open");
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

  // Debounced quick-jump search: fires 180ms after the user stops typing
  // so we avoid flooding the API with per-keystroke requests.
  useEffect(() => {
    let cancelled = false;

    async function loadQuickJump() {
      if (!hasSession || !token || searchQuery.trim().length < 2) {
        setSearchResults([]);
        return;
      }
      setSearchLoading(true);
      try {
        const response = await fetch(
          `${normalizedBaseUrl}/search/quick-jump/?q=${encodeURIComponent(searchQuery.trim())}`,
          {
            headers: buildAuthHeaders(token),
          },
        );
        const payload = await response.json();
        if (!response.ok) {
          if (!cancelled) {
            setSearchResults([]);
          }
          return;
        }
        if (!cancelled) {
          setSearchResults((payload?.data?.items as QuickJumpItem[]) ?? []);
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }

    const timer = window.setTimeout(() => {
      void loadQuickJump();
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasSession, normalizedBaseUrl, searchQuery, token]);

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
      if (
        quickJumpMenuRef.current?.contains(target) ||
        opsMetaMenuRef.current?.contains(target)
      ) {
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
          {organization.displayName} Organization
        </Link>
      ) : null}
      {hasSession && isPublicDocument ? (
        <Link href="/" className={styles.button}>
          Home
        </Link>
      ) : null}
      {hasSession && !isPublicDocument ? (
        <details ref={quickJumpMenuRef} className={styles.menu}>
          <summary className={`${styles.button} ${styles.quickJumpButton}`}>Quick Jump</summary>
          <div className={`${styles.menuList} ${styles.quickJumpList}`} role="menu" aria-label="Global quick jump">
            <label className={styles.quickJumpInputWrap}>
              <span className={styles.quickJumpLabel}>Search</span>
              <input
                className={styles.quickJumpInput}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Project, CO, invoice, bill, payment..."
              />
            </label>
            {searchLoading ? <p className={styles.quickJumpHint}>Searching...</p> : null}
            {!searchLoading && searchQuery.trim().length >= 2 && searchResults.length === 0 ? (
              <p className={styles.quickJumpHint}>No matches.</p>
            ) : null}
            {searchResults.map((item) => (
              <Link
                key={`${item.kind}-${item.record_id}`}
                href={item.ui_href}
                className={styles.menuItem}
                role="menuitem"
                onClick={closeMenus}
              >
                <strong>{item.label}</strong>
                <span className={styles.quickJumpSubLabel}>{item.sub_label}</span>
              </Link>
            ))}
          </div>
        </details>
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
      {hasSession || isPublicDocument ? (
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
