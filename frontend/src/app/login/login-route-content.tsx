"use client";

import type { HealthResult } from "@/shared/api/health";
import { HomeAuthConsole } from "@/shared/session/components/home-auth-console";
import { useSessionAuthorization } from "@/shared/session/session-authorization";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import homeStyles from "../page.module.css";

type LoginRouteContentProps = {
  health: HealthResult;
};

/** Login route content — shows login form, redirects to dashboard if already authenticated. */
export function LoginRouteContent({ health }: LoginRouteContentProps) {
  const { isAuthorized } = useSessionAuthorization();
  const router = useRouter();

  // Redirect authenticated users away from the login page.
  useEffect(() => {
    if (isAuthorized) {
      router.replace("/customers");
    }
  }, [isAuthorized, router]);

  if (isAuthorized) {
    return null;
  }

  return (
    <div className={homeStyles.page}>
      <main className={homeStyles.main}>
        <HomeAuthConsole health={health} />
      </main>
    </div>
  );
}
