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
  const hasSession =
    pathname !== null && typeof window !== "undefined" && Boolean(loadClientSession()?.token);
  const hasActiveNonWorkflow = pathname === "/contacts";

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
      {hasSession ? (
        <details className="nonWorkflowMenu">
          <summary className={`themeControlButton ${hasActiveNonWorkflow ? "isActive" : ""}`}>
            Non-Workflow
          </summary>
          <div className="nonWorkflowList" role="menu" aria-label="Non-workflow tools">
            <Link
              href="/contacts"
              className={`nonWorkflowItem ${hasActiveNonWorkflow ? "isActive" : ""}`}
              role="menuitem"
            >
              Contacts
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
