"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { HealthResult } from "@/shared/api/health";
import {
  saveClientSession,
  type SessionOrganization,
  type SessionRole,
} from "../client-session";
import styles from "./home-auth-console.module.css";

type RegisterResponse = {
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
  email?: string[];
  password?: string[];
  non_field_errors?: string[];
};

type HomeRegisterConsoleProps = {
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
 * Map the register endpoint's snake_case organization payload to the
 * client-side SessionOrganization shape. Returns undefined if any
 * required field (id, display_name) is missing.
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

export function HomeRegisterConsole({ health }: HomeRegisterConsoleProps) {
  const router = useRouter();
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  /**
   * Extract the most relevant error message from Django's register
   * response. Checks structured error, field-level errors (email,
   * password), and non-field errors in priority order.
   */
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

  /**
   * Form submission handler for registration. POSTs credentials to
   * the Django register endpoint, persists the new session to
   * localStorage on success, and redirects to home.
   */
  async function handleRegister(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSubmitting(true);
    setMessage("Creating account...");
    setMessageTone("neutral");

    try {
      const response = await fetch(`${defaultApiBaseUrl}/auth/register/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const payload: RegisterResponse = await response.json();
      const token = payload.data?.token ?? "";
      const nextEmail = payload.data?.user?.email ?? email;
      const nextRole = payload.data?.user?.role ?? "owner";
      const nextOrganization = toSessionOrganization(payload.data?.organization);

      if (!response.ok || !token) {
        setMessage(normalizeRegisterError(payload));
        setMessageTone("error");
        setIsSubmitting(false);
        return;
      }

      saveClientSession({
        token,
        email: nextEmail,
        role: nextRole,
        organization: nextOrganization,
        capabilities: payload.data?.capabilities,
      });

      setMessage("Account created. Redirecting...");
      setMessageTone("neutral");
      router.push("/");
    } catch {
      setMessage("Could not reach register endpoint.");
      setMessageTone("error");
    } finally {
      setIsSubmitting(false);
    }
  }

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
          {message && (
            <p className={`${styles.message} ${messageTone === "error" ? styles.messageError : ""}`}>
              {message}
            </p>
          )}
          <div className={styles.buttonRow}>
            <button className={styles.button} type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create account"}
            </button>
          </div>
          <p className={styles.formHint}>
            Already have an account? <Link href="/">Sign in</Link>.
          </p>
        </form>
        {!health.ok && (
          <p className={styles.healthBad}>API Health: {health.message}</p>
        )}
      </div>
    </section>
  );
}
