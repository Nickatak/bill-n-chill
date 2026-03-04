"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { HealthResult } from "@/shared/api/health";
import {
  clearClientSession,
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
    };
    capabilities?: Record<string, string[]>;
  };
  error?: {
    message?: string;
  };
};

type HomeAuthConsoleProps = {
  health: HealthResult;
};

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

/**
 * Format an ISO timestamp string for display in the health banner.
 * Returns "unknown" if the value is absent, or the raw string if it
 * can't be parsed as a valid date.
 */
function formatTimestamp(value?: string): string {
  if (!value) {
    return "unknown";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

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
      }
    | undefined,
): SessionOrganization | undefined {
  if (!raw?.id || !raw.display_name) {
    return undefined;
  }
  return {
    id: raw.id,
    displayName: raw.display_name,
  };
}

export function HomeAuthConsole({ health }: HomeAuthConsoleProps) {
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [message, setMessage] = useState("");

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
   * the Django auth endpoint, persists the session (token, email, role,
   * org) to localStorage on success, and updates component state to
   * reflect the outcome.
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

      setPassword("");
      setIsAuthenticated(true);
      setMessage(
        `Using shared session for ${nextEmail || "user"} (${nextRole})${
          nextOrganization ? ` in ${nextOrganization.displayName}` : ""
        }.`,
      );
      setMessageTone("neutral");
    } catch {
      setMessage("Could not reach login endpoint.");
      setMessageTone("error");
    } finally {
      setIsChecking(false);
    }
  }

  /** Clear the persisted session from localStorage and reset to the login view. */
  function handleSignOut() {
    clearClientSession();

    setPassword("");
    setIsAuthenticated(false);
    setMessage("Signed out.");
    setMessageTone("neutral");
  }

  if (!isAuthenticated) {
    return (
      <section className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.warning} role="note" aria-label="Environment warning">
            <p className={styles.warningTitle}>Under Construction</p>
            <p className={styles.warningText}>
              This environment is still in active development. Data may be reset, changed, or removed at any
              time.
            </p>
            <p className={styles.warningMeta}>Last data reset: {formatTimestamp(health.dataResetAt)}</p>
            <p className={styles.warningMeta}>Last build: {formatTimestamp(health.appBuildAt)}</p>
            <p className={styles.warningMeta}>
              Deployed commit: {health.appRevision?.slice(0, 12) || "unknown"}
            </p>
          </div>
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

  return (
    <section className={styles.shell}>
      <div className={styles.card}>
        <h2 className={styles.title}>Session ready</h2>
        <p className={styles.text}>Signed in as {email || "user"}. Redirecting to Intake...</p>
        {message && (
          <p className={`${styles.message} ${messageTone === "error" ? styles.messageError : ""}`}>
            {message}
          </p>
        )}
        {!health.ok && (
          <p className={styles.healthBad}>API Health: {health.message}</p>
        )}
        <div className={styles.buttonRow}>
          <button className={styles.buttonSecondary} type="button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </section>
  );
}
