"use client";

import { clearClientSession, loadClientSession } from "@/features/session/client-session";
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
