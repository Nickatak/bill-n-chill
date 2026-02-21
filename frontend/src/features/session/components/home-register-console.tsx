"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { saveClientSession } from "../client-session";
import styles from "./home-auth-console.module.css";

type RegisterResponse = {
  data?: {
    token?: string;
    user?: {
      email?: string;
    };
  };
  error?: {
    message?: string;
  };
  email?: string[];
  password?: string[];
  non_field_errors?: string[];
};

type HomeRegisterConsoleProps = {
  health: {
    ok: boolean;
    message: string;
  };
};

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function HomeRegisterConsole({ health }: HomeRegisterConsoleProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("Create an account to start using the dashboard.");

  function normalizeRegisterError(payload?: RegisterResponse): string {
    if (!payload) {
      return "Registration failed.";
    }
    if (payload.error?.message) {
      return payload.error.message;
    }
    if (payload.email?.length) {
      return payload.email[0];
    }
    if (payload.password?.length) {
      return payload.password[0];
    }
    if (payload.non_field_errors?.length) {
      return payload.non_field_errors[0];
    }
    return "Registration failed.";
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("Creating account...");

    try {
      const response = await fetch(`${defaultApiBaseUrl}/auth/register/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload: RegisterResponse = await response.json();
      const token = payload.data?.token ?? "";
      const nextEmail = payload.data?.user?.email ?? email;

      if (!response.ok || !token) {
        setMessage(normalizeRegisterError(payload));
        setIsSubmitting(false);
        return;
      }

      saveClientSession({ token, email: nextEmail });
      setMessage("Account created. Redirecting...");
      router.push("/");
    } catch {
      setMessage("Could not reach register endpoint.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={styles.shell}>
      <div className={styles.card}>
        <h2 className={styles.title}>Create account</h2>
        <p className={styles.text}>Quick registration for temporary access.</p>
        <div className={styles.warning} role="note" aria-label="Environment warning">
          <p className={styles.warningTitle}>Under Construction</p>
          <p className={styles.warningText}>
            This environment is still in active development. Data may be reset, changed, or removed at any
            time.
          </p>
        </div>
        <form className={styles.form} onSubmit={handleRegister}>
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
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <div className={styles.buttonRow}>
            <button className={styles.button} type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create account"}
            </button>
          </div>
          <p className={styles.formHint}>
            Already have an account? <Link href="/">Sign in</Link>.
          </p>
        </form>
        <p className={styles.message}>{message}</p>
        <p className={health.ok ? styles.healthOk : styles.healthBad}>API Health: {health.message}</p>
      </div>
    </section>
  );
}
