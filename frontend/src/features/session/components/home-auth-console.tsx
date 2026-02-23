"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import {
  clearClientSession,
  loadClientSession,
  saveClientSession,
} from "../client-session";
import styles from "./home-auth-console.module.css";

type LoginResponse = {
  data?: {
    token?: string;
    user?: {
      email?: string;
      role?: "owner" | "pm" | "bookkeeping" | "worker" | "viewer";
    };
  };
  error?: {
    message?: string;
  };
};

type MeResponse = {
  data?: {
    email?: string;
    role?: "owner" | "pm" | "bookkeeping" | "worker" | "viewer";
  };
};

type HomeAuthConsoleProps = {
  health: {
    ok: boolean;
    message: string;
    appRevision?: string;
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

export function HomeAuthConsole({ health }: HomeAuthConsoleProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
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

  async function verifySession(
    activeToken: string,
    fallbackEmail: string,
    fallbackRole: "owner" | "pm" | "bookkeeping" | "worker" | "viewer" = "owner",
  ) {
    try {
      const response = await fetch(`${defaultApiBaseUrl}/auth/me/`, {
        headers: { Authorization: `Token ${activeToken}` },
      });
      const payload: MeResponse = await response.json();
      if (!response.ok) {
        clearClientSession();
        setToken("");
        setIsAuthenticated(false);
        setMessage("Session expired. Sign in again.");
        return;
      }
      const nextEmail = payload.data?.email ?? fallbackEmail;
      const nextRole = payload.data?.role ?? fallbackRole;
      if (nextEmail && nextEmail !== email) {
        setEmail(nextEmail);
      }
      saveClientSession({ token: activeToken, email: nextEmail, role: nextRole });
      setIsAuthenticated(true);
      setMessage(`Using shared session for ${nextEmail || "user"} (${nextRole}).`);
    } catch {
      setIsAuthenticated(false);
      setMessage("Could not reach auth/me endpoint.");
    }
  }

  useEffect(() => {
    async function init() {
      const session = loadClientSession();
      if (session?.email) {
        setEmail(session.email);
      }
      if (session?.token) {
        setToken(session.token);
        setMessage("Checking saved session...");
      }
      if (!token) {
        setIsChecking(false);
        return;
      }
      setIsChecking(true);
      await verifySession(token, email);
      setIsChecking(false);
    }

    void init();
    // Intentionally runs once on initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsChecking(true);
    setMessage("Signing in...");
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
      if (!response.ok || !nextToken) {
        setMessage(normalizeLoginError(payload.error?.message));
        setIsChecking(false);
        return;
      }

      setToken(nextToken);
      setPassword("");
      await verifySession(nextToken, nextEmail, nextRole);
    } catch {
      setMessage("Could not reach login endpoint.");
    } finally {
      setIsChecking(false);
    }
  }

  function handleSignOut() {
    clearClientSession();
    setToken("");
    setPassword("");
    setIsAuthenticated(false);
    setMessage("Signed out.");
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
          <p className={styles.message}>{message}</p>
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
        <p className={styles.message}>{message}</p>
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
