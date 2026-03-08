"use client";

import type { HealthResult } from "@/shared/api/health";
import { DashboardConsole } from "@/features/dashboard";
import { buildAuthHeaders } from "@/features/session/auth-headers";
import { HomeAuthConsole } from "@/features/session/components/home-auth-console";
import { useSessionAuthorization } from "@/features/session/session-authorization";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import homeStyles from "./page.module.css";
import shell from "@/shared/shell/page-shell.module.css";
import { PageCard, PageShell } from "@/shared/shell";

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

type HomeRouteContentProps = {
  health: HealthResult;
};

/** Root route content — shows login form for guests, dashboard for authenticated users, and redirects fresh orgs to onboarding. */
export function HomeRouteContent({ health }: HomeRouteContentProps) {
  const { token, isAuthorized, isChecking } = useSessionAuthorization();
  const router = useRouter();
  const [freshOrgChecked, setFreshOrgChecked] = useState(false);

  // Update page title based on auth state.
  useEffect(() => {
    document.title = isAuthorized ? "Dashboard | Bill n Chill" : "Sign In | Bill n Chill";
  }, [isAuthorized]);

  // Redirect fresh orgs (no customers yet) to the onboarding checklist.
  // The `cancelled` flag only guards React state updates (setFreshOrgChecked),
  // NOT the hard redirect — window.location.href is safe to call from a
  // "stale" effect since it triggers a full page reload regardless.
  // This is critical because React Strict Mode cancels the first effect run,
  // but the redirect must still fire when the fetch completes.
  useEffect(() => {
    if (!isAuthorized || !token) {
      setFreshOrgChecked(false);
      return;
    }

    if (localStorage.getItem("onboarding:seen")) {
      setFreshOrgChecked(true);
      return;
    }

    let cancelled = false;

    async function checkFreshOrg() {
      try {
        const res = await fetch(`${defaultApiBaseUrl}/customers/`, {
          headers: buildAuthHeaders(token),
        });
        const payload = await res.json();

        if (res.ok && Array.isArray(payload.data) && payload.data.length === 0) {
          if (!localStorage.getItem("onboarding:seen")) {
            localStorage.setItem("onboarding:seen", "1");
            window.location.href = "/onboarding";
            return;
          }
        }
      } catch {
        // Network error — don't redirect, show normal home
      }

      if (!cancelled) {
        setFreshOrgChecked(true);
      }
    }

    void checkFreshOrg();
    return () => {
      cancelled = true;
    };
  }, [isAuthorized, token, router]);

  if (isAuthorized) {
    if (!freshOrgChecked) {
      return (
        <div className={homeStyles.page}>
          <main className={homeStyles.main}>
            <h1 className={homeStyles.title}>Bill n&apos; Chill</h1>
            <p className={homeStyles.subtitle}>Loading&hellip;</p>
          </main>
        </div>
      );
    }

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

  if (token && isChecking) {
    return (
      <div className={homeStyles.page}>
        <main className={homeStyles.main}>
          <h1 className={homeStyles.title}>Bill n&apos; Chill</h1>
          <p className={homeStyles.subtitle}>Checking session...</p>
        </main>
      </div>
    );
  }

  return (
    <div className={homeStyles.page}>
      <main className={homeStyles.main}>
        <h1 className={homeStyles.title}>Bill n&apos; Chill</h1>
        <HomeAuthConsole health={health} />
      </main>
    </div>
  );
}
