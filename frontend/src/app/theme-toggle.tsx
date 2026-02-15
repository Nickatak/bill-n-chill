"use client";

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
  function toggleTheme() {
    const current =
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next: ThemeMode = current === "dark" ? "light" : "dark";
    applyTheme(next);
  }

  return (
    <button type="button" className="themeToggle" onClick={toggleTheme} aria-label="Toggle theme">
      Toggle theme
    </button>
  );
}
