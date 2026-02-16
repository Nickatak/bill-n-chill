"use client";

import { FormEvent, useEffect, useState } from "react";

import {
  clearClientSession,
  loadClientSession,
  saveClientSession,
} from "../client-session";

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

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function HomeAuthConsole() {
  const initialSession = typeof window !== "undefined" ? loadClientSession() : null;
  const [email, setEmail] = useState(initialSession?.email ?? "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(initialSession?.token ?? "");
  const [message, setMessage] = useState(
    initialSession ? `Loaded saved session for ${initialSession.email || "user"}.` : "",
  );

  const normalizedBaseUrl = defaultApiBaseUrl;

  function persistSession(nextToken: string, nextEmail: string) {
    saveClientSession({
      token: nextToken,
      email: nextEmail,
    });
  }

  useEffect(() => {
    async function verifySharedSession() {
      if (!token) {
        return;
      }
      setMessage("Checking shared session...");
      try {
        const response = await fetch(`${normalizedBaseUrl}/auth/me/`, {
          headers: { Authorization: `Token ${token}` },
        });
        const payload: MeResponse = await response.json();
        if (!response.ok) {
          setMessage("Saved session token is invalid. Login again.");
          return;
        }
        const nextEmail = payload.data?.email ?? email;
        if (nextEmail && nextEmail !== email) {
          setEmail(nextEmail);
        }
        persistSession(token, nextEmail);
        setMessage(`Using shared session for ${nextEmail || "user"}.`);
      } catch {
        setMessage("Could not reach auth/me endpoint.");
      }
    }

    void verifySharedSession();
    // Intentionally runs once on initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Logging in...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/auth/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload: LoginResponse = await response.json();
      const nextToken = payload.data?.token ?? "";
      const nextEmail = payload.data?.user?.email ?? email;
      if (!response.ok || !nextToken) {
        setMessage(payload.error?.message ?? "Login failed.");
        return;
      }
      setToken(nextToken);
      persistSession(nextToken, nextEmail);
      setMessage(`Logged in as ${nextEmail}. Session saved for all routes.`);
    } catch {
      setMessage("Could not reach login endpoint.");
    }
  }

  function handleSaveManualToken() {
    if (!token) {
      setMessage("Token is empty.");
      return;
    }
    persistSession(token, email);
    setMessage("Manual token saved to shared session.");
  }

  function handleClearSession() {
    clearClientSession();
    setToken("");
    setPassword("");
    setMessage("Session cleared.");
  }

  return (
    <section>
      <h2>Global Login</h2>
      <p>Login once here. All route consoles reuse this session.</p>

      <form onSubmit={handleLogin}>
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
        <button type="submit">Login + Save Session</button>
      </form>

      <label>
        Auth token
        <input value={token} onChange={(event) => setToken(event.target.value)} />
      </label>
      <div>
        <button type="button" onClick={handleSaveManualToken}>
          Save Token
        </button>
        <button type="button" onClick={handleClearSession}>
          Clear Session
        </button>
      </div>
      <p>{message}</p>
    </section>
  );
}
