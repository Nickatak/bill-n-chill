"use client";

import { QuickAddConsole } from "@/features/intake";
import { HomeAuthConsole } from "@/features/session/components/home-auth-console";
import { useSessionAuthorization } from "@/features/session/session-authorization";
import homeStyles from "./page.module.css";
import quickAddStyles from "./intake/quick-add/page.module.css";

type HomeRouteContentProps = {
  health: {
    ok: boolean;
    message: string;
    appRevision?: string;
    appBuildAt?: string;
    dataResetAt?: string;
  };
};

export function HomeRouteContent({ health }: HomeRouteContentProps) {
  const { token, isAuthorized, isChecking } = useSessionAuthorization();

  if (isAuthorized) {
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
          <h1 className={homeStyles.title}>bill-n-chill</h1>
          <p className={homeStyles.subtitle}>Checking session...</p>
        </main>
      </div>
    );
  }

  return (
    <div className={homeStyles.page}>
      <main className={homeStyles.main}>
        <h1 className={homeStyles.title}>bill-n-chill</h1>
        <p className={homeStyles.subtitle}>Sign in to continue.</p>
        <HomeAuthConsole health={health} />
      </main>
    </div>
  );
}
