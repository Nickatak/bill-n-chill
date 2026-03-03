"use client";

import type { HealthResult } from "@/shared/api/health";
import { QuickAddConsole } from "@/features/intake";
import { buildAuthHeaders } from "@/features/session/auth-headers";
import { HomeAuthConsole } from "@/features/session/components/home-auth-console";
import { useSessionAuthorization } from "@/features/session/session-authorization";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import homeStyles from "./page.module.css";
import quickAddStyles from "./intake/quick-add/page.module.css";

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

type HomeRouteContentProps = {
  health: HealthResult;
};

export function HomeRouteContent({ health }: HomeRouteContentProps) {
  const { token, isAuthorized, isChecking } = useSessionAuthorization();
  const router = useRouter();
  const [freshOrgChecked, setFreshOrgChecked] = useState(false);

  // Redirect fresh orgs (no customers yet) to the onboarding checklist.
  useEffect(() => {
    if (!isAuthorized || !token) {
      setFreshOrgChecked(false);
      return;
    }

    let cancelled = false;

    async function checkFreshOrg() {
      try {
        const res = await fetch(`${defaultApiBaseUrl}/customers/`, {
          headers: buildAuthHeaders(token),
        });
        const payload = await res.json();
        if (cancelled) return;

        if (res.ok && Array.isArray(payload.data) && payload.data.length === 0) {
          router.replace("/ops/meta/help");
          return;
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
      <div className={quickAddStyles.page}>
        <main className={quickAddStyles.main}>
          <section className={quickAddStyles.card}>
            <QuickAddConsole />
          </section>
        </main>
      </div>
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
