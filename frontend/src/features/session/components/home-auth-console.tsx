"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

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
      slug?: string;
    };
  };
  error?: {
    message?: string;
  };
};

type HomeAuthConsoleProps = {
  health: {
    ok: boolean;
    message: string;
    appRevision?: string;
    appBuildAt?: string;
    dataResetAt?: string;
  };
};

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

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

function toSessionOrganization(
  raw:
    | {
        id?: number;
        display_name?: string;
        slug?: string;
      }
    | undefined,
): SessionOrganization | undefined {
  if (!raw?.id || !raw.display_name || !raw.slug) {
    return undefined;
  }
  return {
    id: raw.id,
    displayName: raw.display_name,
    slug: raw.slug,
  };
}

export function HomeAuthConsole({ health }: HomeAuthConsoleProps) {
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [message, setMessage] = useState("Sign in to open your dashboard.");

  function normalizeLoginError(message?: string): string {
    const normalized = (message ?? "").trim().toLowerCase();
    if (!normalized || normalized === "login failed." || normalized === "login failed") {
      return "Invalid username/password combination.";
    }
    return message ?? "Invalid username/password combination.";
  }

  useEffect(() => {
    function init() {
      const session = loadClientSession();
      if (session?.email) {
        setEmail(session.email);
      }
    }
    void init();
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
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
          <h2 className={styles.title}>Sign in</h2>
          <p className={styles.text}>Home doubles as your dashboard once authenticated.</p>
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
            <div className={styles.buttonRow}>
              <button className={styles.button} type="submit" disabled={isChecking}>
                {isChecking ? "Checking..." : "Sign in"}
              </button>
            </div>
            <p className={styles.formHint}>
              Need an account? <Link href="/register">Create one</Link>.
            </p>
          </form>
          <p className={`${styles.message} ${messageTone === "error" ? styles.messageError : ""}`}>
            {message}
          </p>
          <p className={health.ok ? styles.healthOk : styles.healthBad}>API Health: {health.message}</p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.shell}>
      <div className={styles.card}>
        <h2 className={styles.title}>Session ready</h2>
        <p className={styles.text}>Signed in as {email || "user"}. Redirecting to Intake...</p>
        <p className={`${styles.message} ${messageTone === "error" ? styles.messageError : ""}`}>
          {message}
        </p>
        <p className={health.ok ? styles.healthOk : styles.healthBad}>API Health: {health.message}</p>
        <div className={styles.buttonRow}>
          <button className={styles.buttonSecondary} type="button" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </section>
  );
}
