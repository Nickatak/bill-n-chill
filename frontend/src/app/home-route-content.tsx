"use client";

import { DashboardConsole } from "@/features/dashboard";
import { useSessionAuthorization } from "@/features/session/session-authorization";
import Link from "next/link";
import shell from "@/shared/shell/page-shell.module.css";
import { PageCard, PageShell } from "@/shared/shell";
import styles from "./home-route-content.module.css";

/** Root route content — dashboard for authenticated users. */
export function HomeRouteContent() {
  const { organization } = useSessionAuthorization();

  return (
    <PageShell>
      {organization && !organization.onboardingCompleted && (
        <div className={styles.onboardingBanner}>
          <span className={styles.bannerText}>
            New here? Follow the getting started guide to set up your workspace.
          </span>
          <Link href="/onboarding" className={styles.bannerLink}>
            Get Started
          </Link>
        </div>
      )}
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
