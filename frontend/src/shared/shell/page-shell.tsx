/**
 * Shared layout primitives for route pages.
 *
 * Provides `PageShell` (the outer page + main wrapper) and `PageCard`
 * (a content card section). Every authenticated page route composes
 * these to get consistent max-width, padding, and spacing.
 */
import type { ReactNode } from "react";
import { joinClassNames } from "../utils/class-names";
import { OnboardingBanner } from "./onboarding-banner";
import shell from "./page-shell.module.css";

type PageShellProps = {
  children: ReactNode;
  narrow?: boolean;
  className?: string;
  mainClassName?: string;
};

type PageCardProps = {
  children: ReactNode;
  muted?: boolean;
  className?: string;
};

/**
 * Outer page wrapper providing the `div.page > main.main` structure.
 *
 * Accepts a `narrow` flag for single-column layouts (settings, help)
 * and optional class overrides for page-specific styling.
 */
export function PageShell({ children, narrow = false, className = "", mainClassName = "" }: PageShellProps) {
  return (
    <div className={joinClassNames(shell.page, className)}>
      <main className={joinClassNames(shell.main, narrow && shell.mainNarrow, mainClassName)}>
        <OnboardingBanner />
        {children}
      </main>
    </div>
  );
}

/**
 * Content card section within a `PageShell`.
 *
 * Use `muted` for secondary/background cards that should recede visually.
 */
export function PageCard({ children, muted = false, className = "" }: PageCardProps) {
  return (
    <section className={joinClassNames(shell.card, muted && shell.cardMuted, className)}>
      {children}
    </section>
  );
}
