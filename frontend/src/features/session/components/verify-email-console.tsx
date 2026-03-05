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

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

function toSessionOrganization(
  raw: { id?: number; display_name?: string } | undefined,
): SessionOrganization | undefined {
  if (!raw?.id || !raw.display_name) return undefined;
  return { id: raw.id, displayName: raw.display_name };
}

export function VerifyEmailConsole({ token }: VerifyEmailConsoleProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [errorMessage, setErrorMessage] = useState("");
  const [showResend, setShowResend] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const [resendTone, setResendTone] = useState<"neutral" | "error">("neutral");

  useEffect(() => {
    if (!token) {
      setStatus("error");
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
          router.push("/");
          return;
        }

        setStatus("error");
        setErrorMessage(payload.error?.message ?? "Verification failed.");
        if (response.status === 410) {
          setShowResend(true);
        }
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

  async function handleResend() {
    if (!resendEmail.trim()) return;

    setIsResending(true);
    setResendMessage("");

    try {
      const response = await fetch(`${defaultApiBaseUrl}/auth/resend-verification/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resendEmail }),
      });

      if (response.status === 429) {
        setResendMessage("Please wait before requesting another email.");
        setResendTone("error");
        return;
      }

      setResendMessage("If that email is registered, a new verification link has been sent.");
      setResendTone("neutral");
    } catch {
      setResendMessage("Could not reach resend endpoint.");
      setResendTone("error");
    } finally {
      setIsResending(false);
    }
  }

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
        <div className={styles.card}>
          <p className={styles.message}>Email verified! Redirecting...</p>
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
        {showResend && (
          <div className={styles.form}>
            <label>
              Email address
              <input
                type="email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </label>
            {resendMessage && (
              <p className={`${styles.message} ${resendTone === "error" ? styles.messageError : ""}`}>
                {resendMessage}
              </p>
            )}
            <div className={styles.buttonRow}>
              <button
                className={styles.button}
                type="button"
                disabled={isResending || !resendEmail.trim()}
                onClick={handleResend}
              >
                {isResending ? "Sending..." : "Send new verification link"}
              </button>
            </div>
          </div>
        )}
        <p className={styles.formHint}>
          <Link href="/">Back to sign in</Link>
        </p>
      </div>
    </section>
  );
}
