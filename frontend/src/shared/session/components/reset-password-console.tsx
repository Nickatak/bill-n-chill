"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  saveClientSession,
  type SessionOrganization,
  type SessionRole,
} from "../client-session";
import styles from "./home-auth-console.module.css";

import { defaultApiBaseUrl } from "@/shared/api/base";

type ResetResponse = {
  data?: {
    token?: string;
    message?: string;
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

function toSessionOrganization(
  raw: { id?: number; display_name?: string; onboarding_completed?: boolean } | undefined,
): SessionOrganization | undefined {
  if (!raw?.id || !raw.display_name) return undefined;
  return { id: raw.id, displayName: raw.display_name, onboardingCompleted: raw.onboarding_completed ?? false };
}

type ResetPasswordConsoleProps = {
  token?: string;
};

/**
 * Password reset flow. Two modes:
 * - No token: "forgot password" form — enter email to request a reset link.
 * - With token: "reset password" form — enter new password, auto-login on success.
 */
export function ResetPasswordConsole({ token }: ResetPasswordConsoleProps) {
  if (token) {
    return <ResetForm token={token} />;
  }
  return <ForgotForm />;
}

// ---------------------------------------------------------------------------
// Forgot password (request reset link)
// ---------------------------------------------------------------------------

function ForgotForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      setMessage("Email is required.");
      setMessageTone("error");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await fetch(`${defaultApiBaseUrl}/auth/forgot-password/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (response.status === 429) {
        setMessage("Please wait before requesting another email.");
        setMessageTone("error");
        return;
      }

      setSent(true);
    } catch {
      setMessage("Could not reach the server.");
      setMessageTone("error");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sent) {
    return (
      <section className={styles.shell}>
        <div className={`${styles.card} ${styles.cardCentered}`}>
          <h2 className={styles.title}>Check your email</h2>
          <p className={styles.text}>
            If <strong>{email}</strong> is registered, we sent a password reset link.
          </p>
          <div className={styles.formHintStack} style={{ width: "100%" }}>
            <p className={styles.formHintRight}>
              <Link href="/login">Back to sign in</Link>
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.shell}>
      <div className={styles.card}>
        <h2 className={styles.title}>Forgot your password?</h2>
        <p className={styles.text}>
          Enter your email and we&apos;ll send you a reset link.
        </p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          {message && (
            <p className={`${styles.message} ${messageTone === "error" ? styles.messageError : ""}`}>
              {message}
            </p>
          )}
          <div className={styles.formHintRow}>
            <div className={styles.buttonRow}>
              <button className={styles.button} type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Send reset link"}
              </button>
            </div>
            <div className={styles.formHintStack}>
              <p className={styles.formHintRight}>
                <Link href="/login">Back to sign in</Link>
              </p>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Reset password (consume token + set new password)
// ---------------------------------------------------------------------------

function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <section className={styles.shell}>
        <div className={`${styles.card} ${styles.cardCentered}`}>
          <p className={styles.message}>Password updated! Redirecting&hellip;</p>
        </div>
      </section>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!newPassword || !confirmPassword) {
      setMessage("Both password fields are required.");
      setMessageTone("error");
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage("Passwords do not match.");
      setMessageTone("error");
      return;
    }

    if (newPassword.length < 8) {
      setMessage("Password must be at least 8 characters.");
      setMessageTone("error");
      return;
    }

    setIsSubmitting(true);
    setMessage("Resetting password...");
    setMessageTone("neutral");

    try {
      const response = await fetch(`${defaultApiBaseUrl}/auth/reset-password/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: newPassword }),
      });

      const payload: ResetResponse = await response.json();

      if (response.ok && payload.data?.token) {
        saveClientSession({
          token: payload.data.token,
          email: payload.data.user?.email ?? "",
          role: payload.data.user?.role ?? "owner",
          organization: toSessionOrganization(payload.data.organization),
          capabilities: payload.data.capabilities,
        });

        setDone(true);
        setTimeout(() => router.push("/dashboard"), 2000);
        return;
      }

      setMessage(payload.error?.message ?? "Reset failed.");
      setMessageTone("error");
    } catch {
      setMessage("Could not reach the server.");
      setMessageTone("error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={styles.shell}>
      <div className={styles.card}>
        <h2 className={styles.title}>Reset your password</h2>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          {message && (
            <p className={`${styles.message} ${messageTone === "error" ? styles.messageError : ""}`}>
              {message}
            </p>
          )}
          <div className={styles.formHintRow}>
            <div className={styles.buttonRow}>
              <button className={styles.button} type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Resetting..." : "Reset password"}
              </button>
            </div>
            <div className={styles.formHintStack}>
              <p className={styles.formHintRight}>
                <Link href="/login">Back to sign in</Link>
              </p>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
