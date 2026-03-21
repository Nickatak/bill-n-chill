"use client";

import { DashboardConsole } from "@/features/dashboard";

import shell from "@/shared/shell/page-shell.module.css";
import { PageCard, PageShell } from "@/shared/shell";

/** Dashboard route content — portfolio overview for authenticated users. */
export function DashboardRouteContent() {
  return (
    <PageShell>
      <header className={shell.hero}>
        <div className={shell.heroTop}>
          <p className={shell.eyebrow}>Dashboard</p>
          <h1 className={shell.title}>Dashboard</h1>
          <p className={shell.copy}>
            Portfolio health, items that need attention, and contract impact at a glance.
          </p>
        </div>
      </header>
      <PageCard>
        <DashboardConsole />
      </PageCard>
    </PageShell>
  );
}
