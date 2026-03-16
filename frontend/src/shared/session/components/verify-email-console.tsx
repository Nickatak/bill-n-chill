"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  saveClientSession,
  type SessionOrganization,
  type SessionRole,
} from "../client-session";
import styles from "./home-auth-console.module.css";

type VerifyResponse = {
  data?: {
    token?: string;
    user?: {
      email?: string;
      role?: SessionRole;
    };
    organization?: {
      id?: number;
      display_name?: string;
    };
    capabilities?: Record<string, string[]>;
  };
  error?: {
    code?: string;
    message?: string;
  };
};

type VerifyEmailConsoleProps = {
  token?: string;
};

import { defaultApiBaseUrl } from "@/shared/api/base";

function toSessionOrganization(
  raw: { id?: number; display_name?: string; onboarding_completed?: boolean } | undefined,
): SessionOrganization | undefined {
  if (!raw?.id || !raw.display_name) return undefined;
  return { id: raw.id, displayName: raw.display_name, onboardingCompleted: raw.onboarding_completed ?? false };
}

/**
 * Handles the email verification callback. POSTs the token from the verification
 * link to the backend, saves the resulting session, and redirects to the dashboard.
 */
export function VerifyEmailConsole({ token }: VerifyEmailConsoleProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error"); // eslint-disable-line react-hooks/set-state-in-effect -- early return guard
      setErrorMessage("No verification token provided.");
      return;
    }

    let ignore = false;

    async function verify() {
      try {
        const response = await fetch(`${defaultApiBaseUrl}/auth/verify-email/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        if (ignore) return;

        const payload: VerifyResponse = await response.json();

        if (response.ok && payload.data?.token) {
          const nextEmail = payload.data.user?.email ?? "";
          const nextRole = payload.data.user?.role ?? "owner";

          saveClientSession({
            token: payload.data.token,
            email: nextEmail,
            role: nextRole,
            organization: toSessionOrganization(payload.data.organization),
            capabilities: payload.data.capabilities,
          });

          setStatus("success");
          setTimeout(() => { if (!ignore) router.push("/customers"); }, 2500);
          return;
        }

        setStatus("error");
        setErrorMessage(payload.error?.message ?? "Verification failed.");
      } catch {
        if (!ignore) {
          setStatus("error");
          setErrorMessage("Could not reach the server.");
        }
      }
    }

    verify();
    return () => { ignore = true; };
  }, [token, router]);

  if (status === "verifying") {
    return (
      <section className={styles.shell}>
        <div className={styles.card}>
          <p className={styles.message}>Verifying your email...</p>
        </div>
      </section>
    );
  }

  if (status === "success") {
    return (
      <section className={styles.shell}>
        <div className={`${styles.card} ${styles.cardCentered}`}>
          <p className={styles.message}>Email confirmed! Welcome to Bill n&apos; Chill.</p>
          <p className={styles.message}>Redirecting to your dashboard&hellip;</p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.warning} role="alert">
          <p className={styles.warningTitle}>Verification Failed</p>
          <p className={styles.warningText}>{errorMessage}</p>
        </div>
        <p className={styles.formHint}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    </section>
  );
}
