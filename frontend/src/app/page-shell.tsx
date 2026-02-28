import type { ReactNode } from "react";
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

function joinClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Shared route-shim page wrapper: `div.page > main.main`.
 */
export function PageShell({ children, narrow = false, className = "", mainClassName = "" }: PageShellProps) {
  return (
    <div className={joinClassNames(shell.page, className)}>
      <main className={joinClassNames(shell.main, narrow && shell.mainNarrow, mainClassName)}>
        {children}
      </main>
    </div>
  );
}

/**
 * Shared route-shim content card wrapper.
 */
export function PageCard({ children, muted = false, className = "" }: PageCardProps) {
  return (
    <section className={joinClassNames(shell.card, muted && shell.cardMuted, className)}>
      {children}
    </section>
  );
}
