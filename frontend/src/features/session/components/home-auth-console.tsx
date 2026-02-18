"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
    };
  };
  error?: {
    message?: string;
  };
};

type MeResponse = {
  data?: {
    email?: string;
  };
};

type HomeAuthConsoleProps = {
  health: {
    ok: boolean;
    message: string;
  };
};

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function HomeAuthConsole({ health }: HomeAuthConsoleProps) {
  const router = useRouter();
  const initialSession = typeof window !== "undefined" ? loadClientSession() : null;
  const [email, setEmail] = useState(initialSession?.email ?? "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(initialSession?.token ?? "");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(Boolean(initialSession?.token));
  const [message, setMessage] = useState(
    initialSession ? "Checking saved session..." : "Sign in to open your dashboard.",
  );

  function normalizeLoginError(message?: string): string {
    const normalized = (message ?? "").trim().toLowerCase();
    if (!normalized || normalized === "login failed." || normalized === "login failed") {
      return "Invalid username/password combination.";
    }
    return message ?? "Invalid username/password combination.";
  }

  async function verifySession(activeToken: string, fallbackEmail: string) {
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
      if (nextEmail && nextEmail !== email) {
        setEmail(nextEmail);
      }
      saveClientSession({ token: activeToken, email: nextEmail });
      setIsAuthenticated(true);
      setMessage(`Using shared session for ${nextEmail || "user"}.`);
    } catch {
      setIsAuthenticated(false);
      setMessage("Could not reach auth/me endpoint.");
    }
  }

  useEffect(() => {
    async function init() {
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
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/intake/quick-add");
    }
  }, [isAuthenticated, router]);

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
      if (!response.ok || !nextToken) {
        setMessage(normalizeLoginError(payload.error?.message));
        setIsChecking(false);
        return;
      }

      setToken(nextToken);
      setPassword("");
      await verifySession(nextToken, nextEmail);
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
