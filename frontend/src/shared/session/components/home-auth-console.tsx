"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import type { HealthResult } from "@/shared/api/health";
import {
  loadClientSession,
  saveClientSession,
  type SessionOrganization,
  type SessionRole,
} from "../client-session";
import styles from "./home-auth-console.module.css";

type LoginResponse = {
  data?: {
    token?: string;
    user?: {
      email?: string;
      role?: SessionRole;
    };
    organization?: {
      id?: number;
      display_name?: string;
      onboarding_completed?: boolean;
    };
    capabilities?: Record<string, string[]>;
  };
  error?: {
    code?: string;
    message?: string;
  };
};

type HomeAuthConsoleProps = {
  health: HealthResult;
};

import { defaultApiBaseUrl } from "@/shared/api/base";

/**
 * Map the login endpoint's snake_case organization payload to the
 * client-side SessionOrganization shape. Returns undefined if any
 * required field (id, display_name) is missing, so downstream
 * code never sees a partially-populated org.
 */
function toSessionOrganization(
  raw:
    | {
        id?: number;
        display_name?: string;
        onboarding_completed?: boolean;
      }
    | undefined,
): SessionOrganization | undefined {
  if (!raw?.id || !raw.display_name) {
    return undefined;
  }
  return {
    id: raw.id,
    displayName: raw.display_name,
    onboardingCompleted: raw.onboarding_completed ?? false,
  };
}

/**
 * Login form console. Authenticates credentials against the Django auth endpoint,
 * persists the session to localStorage, and navigates to the dashboard on success.
 */
export function HomeAuthConsole({ health }: HomeAuthConsoleProps) {
  const router = useRouter();
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isChecking, setIsChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [isResending, setIsResending] = useState(false);

  /**
   * Rewrite Django's generic login error messages into user-friendly
   * copy. Falls back to a safe default if the message is empty or
   * matches the backend's generic "Login failed." response.
   */
  function normalizeLoginError(message?: string): string {
    const normalized = (message ?? "").trim().toLowerCase();
    if (!normalized || normalized === "login failed." || normalized === "login failed") {
      return "Invalid username/password combination.";
    }
    return message ?? "Invalid username/password combination.";
  }

  // Pre-fill the email field from a previously-saved session in localStorage.
  useEffect(() => {
    function init() {
      const session = loadClientSession();
      if (session?.email) {
        setEmail(session.email);
      }
    }
    void init();
  }, []);

  /**
   * Form submission handler for the login form. POSTs credentials to
   * the Django auth endpoint, persists the session to localStorage on
   * success, and navigates to the dashboard.
   */
  async function handleLogin(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsChecking(true);
    setMessage("Signing in...");
    setMessageTone("neutral");

    try {
      const response = await fetch(`${defaultApiBaseUrl}/auth/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const payload: LoginResponse = await response.json();
      const nextToken = payload.data?.token ?? "";
      const nextEmail = payload.data?.user?.email ?? email;
      const nextRole = payload.data?.user?.role ?? "owner";
      const nextOrganization = toSessionOrganization(payload.data?.organization);

      if (!response.ok || !nextToken) {
        if (payload.error?.code === "email_not_verified") {
          setEmailNotVerified(true);
          setMessage("Please verify your email before signing in.");
          setMessageTone("error");
          setIsChecking(false);
          return;
        }
        setMessage(normalizeLoginError(payload.error?.message));
        setMessageTone("error");
        setIsChecking(false);
        return;
      }

      saveClientSession({
        token: nextToken,
        email: nextEmail,
        role: nextRole,
        organization: nextOrganization,
        capabilities: payload.data?.capabilities,
      });

      router.push("/");
    } catch {
      setMessage("Could not reach login endpoint.");
      setMessageTone("error");
    } finally {
      setIsChecking(false);
    }
  }

  /** Resend verification email for the current email address. */
  async function handleResendVerification() {
    setIsResending(true);
    setMessage("");

    try {
      const response = await fetch(`${defaultApiBaseUrl}/auth/resend-verification/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (response.status === 429) {
        setMessage("Please wait before requesting another email.");
        setMessageTone("error");
        return;
      }

      setMessage("Verification email resent. Check your inbox.");
      setMessageTone("neutral");
    } catch {
      setMessage("Could not reach resend endpoint.");
      setMessageTone("error");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <section className={styles.shell}>
      <div className={styles.card}>
        <h2 className={styles.title}>Sign in</h2>
        <form className={styles.form} onSubmit={handleLogin}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {message && (
            <p className={`${styles.message} ${messageTone === "error" ? styles.messageError : ""}`}>
              {message}
            </p>
          )}
          <div className={styles.buttonRow}>
            <button className={styles.button} type="submit" disabled={isChecking}>
              {isChecking ? "Checking..." : "Sign in"}
            </button>
            {emailNotVerified && (
              <button
                className={styles.buttonSecondary}
                type="button"
                disabled={isResending}
                onClick={handleResendVerification}
              >
                {isResending ? "Sending..." : "Resend verification email"}
              </button>
            )}
          </div>
          <p className={styles.formHint}>
            Need an account? <Link href="/register">Create one</Link>.
          </p>
        </form>
        {!health.ok && (
          <p className={styles.healthBad}>API Health: {health.message}</p>
        )}
      </div>
    </section>
  );
}
