"use client";

import { DashboardConsole } from "@/features/dashboard";
import { useSessionAuthorization } from "@/features/session/session-authorization";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import shell from "@/shared/shell/page-shell.module.css";
import { PageCard, PageShell } from "@/shared/shell";

/** Root route content — dashboard for authenticated users, redirects fresh orgs to onboarding. */
export function HomeRouteContent() {
  const { organization } = useSessionAuthorization();
  const router = useRouter();

  // Redirect to onboarding if the org hasn't completed it yet.
  useEffect(() => {
    if (organization && !organization.onboardingCompleted) {
      router.replace("/onboarding");
    }
  }, [organization, router]);

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
