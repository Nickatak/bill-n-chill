"use client";

import { clearClientSession, loadClientSession } from "@/features/session/client-session";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const THEME_KEY = "bnc-theme";
type ThemeMode = "light" | "dark";

function applyTheme(theme: ThemeMode) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // no-op: localStorage can be unavailable in restricted environments
  }
}

export function ThemeToggle() {
  const pathname = usePathname();
  const router = useRouter();
  const hasSession = Boolean(loadClientSession()?.token);
  const isPublicEstimateRoute = Boolean(pathname && /^\/estimate\/[^/]+\/?$/.test(pathname));
  const hasActiveContacts = pathname === "/contacts";
  const hasActiveVendors = pathname === "/vendors";
  const hasActiveCostCodes = pathname === "/cost-codes";
  const hasActiveSettings = pathname === "/settings/intake";

  function toggleTheme() {
    const current =
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next: ThemeMode = current === "dark" ? "light" : "dark";
    applyTheme(next);
  }

  function logout() {
    clearClientSession();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="themeControls">
      {hasSession && isPublicEstimateRoute ? (
        <Link href="/" className="themeControlButton">
          Home
        </Link>
      ) : null}
      {hasSession && !isPublicEstimateRoute ? (
        <details className="nonWorkflowMenu">
          <summary
            className={`themeControlButton ${
              hasActiveContacts || hasActiveVendors || hasActiveCostCodes ? "isActive" : ""
            }`}
          >
            Non-Workflow
          </summary>
          <div className="nonWorkflowList" role="menu" aria-label="Non-workflow tools">
            <Link
              href="/contacts"
              className={`nonWorkflowItem ${hasActiveContacts ? "isActive" : ""}`}
              role="menuitem"
            >
              Contacts
            </Link>
            <Link
              href="/vendors"
              className={`nonWorkflowItem ${hasActiveVendors ? "isActive" : ""}`}
              role="menuitem"
            >
              Vendors
            </Link>
            <Link
              href="/cost-codes"
              className={`nonWorkflowItem ${hasActiveCostCodes ? "isActive" : ""}`}
              role="menuitem"
            >
              Cost Codes
            </Link>
          </div>
        </details>
      ) : null}
      {hasSession && !isPublicEstimateRoute ? (
        <details className="nonWorkflowMenu">
          <summary className={`themeControlButton ${hasActiveSettings ? "isActive" : ""}`}>
            Settings
          </summary>
          <div className="nonWorkflowList" role="menu" aria-label="Settings">
            <Link
              href="/settings/intake"
              className={`nonWorkflowItem ${hasActiveSettings ? "isActive" : ""}`}
              role="menuitem"
            >
              Intake Form
            </Link>
          </div>
        </details>
      ) : null}
      <button type="button" className="themeToggle" onClick={toggleTheme} aria-label="Toggle theme">
        Toggle theme
      </button>
      {hasSession ? (
        <button type="button" className="themeLogout" onClick={logout}>
          Logout
        </button>
      ) : null}
    </div>
  );
}
