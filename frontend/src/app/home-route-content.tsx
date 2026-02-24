"use client";

import { useEffect, useState } from "react";

import { QuickAddConsole } from "@/features/intake";
import { clearClientSession } from "@/features/session/client-session";
import { HomeAuthConsole } from "@/features/session/components/home-auth-console";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import homeStyles from "./page.module.css";
import quickAddStyles from "./intake/quick-add/page.module.css";

type HomeRouteContentProps = {
  health: {
    ok: boolean;
    message: string;
    appRevision?: string;
    dataResetAt?: string;
  };
};

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function HomeRouteContent({ health }: HomeRouteContentProps) {
  const { token } = useSharedSessionAuth();
  const [authState, setAuthState] = useState<"checking" | "authorized" | "unauthorized">("checking");

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      if (!token) {
        if (!cancelled) {
          setAuthState("unauthorized");
        }
        return;
      }

      if (!cancelled) {
        setAuthState("checking");
      }

      try {
        const response = await fetch(`${defaultApiBaseUrl}/auth/me/`, {
          headers: { Authorization: `Token ${token}` },
        });
        await response.json();
        if (!response.ok) {
          clearClientSession();
          if (!cancelled) {
            setAuthState("unauthorized");
          }
          return;
        }
        if (!cancelled) {
          setAuthState("authorized");
        }
      } catch {
        if (!cancelled) {
          setAuthState("unauthorized");
        }
      }
    }

    void verify();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (authState === "authorized") {
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

  if (authState === "checking") {
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
