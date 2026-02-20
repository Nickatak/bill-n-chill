"use client";

import { clearClientSession } from "@/features/session/client-session";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { isRouteActive, opsMetaRoutes } from "./nav-routes";

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
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { token } = useSharedSessionAuth();
  const hasSession = Boolean(token);
  const isPublicEstimateRoute = Boolean(pathname && /^\/estimate\/[^/]+\/?$/.test(pathname));
  const hasActiveOpsMeta = opsMetaRoutes.some((route) => isRouteActive(pathname, route));

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
          <summary className={`themeControlButton ${hasActiveOpsMeta ? "isActive" : ""}`}>
            Ops / Meta
          </summary>
          <div className="nonWorkflowList" role="menu" aria-label="Ops and metadata tools">
            {opsMetaRoutes.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className={`nonWorkflowItem ${isRouteActive(pathname, route) ? "isActive" : ""}`}
                role="menuitem"
              >
                {route.label}
              </Link>
            ))}
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
