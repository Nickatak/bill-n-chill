"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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

type VerifyInviteData = {
  organization_name: string;
  email: string;
  role: string;
  is_existing_user: boolean;
};

type DetectedInvite = {
  organization_name: string;
  role: string;
  invite_token: string;
};

type InviteFlowState = "none" | "verifying" | "flow-b" | "flow-c" | "error";

type HomeRegisterConsoleProps = {
  health: HealthResult;
  inviteToken?: string;
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

export function HomeRegisterConsole({ health, inviteToken }: HomeRegisterConsoleProps) {
  const router = useRouter();
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  // Invite flow state
  const [inviteFlow, setInviteFlow] = useState<InviteFlowState>(inviteToken ? "verifying" : "none");
  const [inviteData, setInviteData] = useState<VerifyInviteData | null>(null);

  // Auto-detected invite (user registered directly without invite link)
  const [detectedInvite, setDetectedInvite] = useState<DetectedInvite | null>(null);

  // The effective invite token — prop (from URL) or auto-detected
  const effectiveInviteToken = inviteToken ?? detectedInvite?.invite_token;

  // Check for pending invites when user types their email (no invite token in URL).
  const checkForPendingInvite = useCallback(async () => {
    if (inviteToken || !email.trim()) return;

    try {
      const response = await fetch(
        `${defaultApiBaseUrl}/auth/check-invite/?email=${encodeURIComponent(email.trim())}`,
      );
      if (response.ok) {
        const body = await response.json();
        setDetectedInvite(body.data as DetectedInvite);
      } else {
        setDetectedInvite(null);
      }
    } catch {
      // Silently fail — this is a convenience check, not critical
    }
  }, [inviteToken, email]);

  // Verify invite token on mount
  useEffect(() => {
    if (!inviteToken) return;

    let ignore = false;
    async function verify() {
      try {
        const response = await fetch(
          `${defaultApiBaseUrl}/auth/verify-invite/${inviteToken}/`,
        );
        if (ignore) return;

        if (response.status === 410) {
          const body = await response.json();
          setMessage(body?.error?.message ?? "This invite has expired or been used.");
          setMessageTone("error");
          setInviteFlow("error");
          return;
        }
        if (!response.ok) {
          setMessage("This invite link is not valid.");
          setMessageTone("error");
          setInviteFlow("error");
          return;
        }

        const body = await response.json();
        const data = body?.data as VerifyInviteData | undefined;
        if (!data) {
          setMessage("Could not read invite details.");
          setMessageTone("error");
          setInviteFlow("error");
          return;
        }

        setInviteData(data);
        setEmail(data.email);
        if (data.is_existing_user) {
          setInviteFlow("flow-c");
        } else {
          setInviteFlow("flow-b");
        }
      } catch {
        if (!ignore) {
          setMessage("Could not reach the server to verify this invite.");
          setMessageTone("error");
          setInviteFlow("error");
        }
      }
    }

    verify();
    return () => { ignore = true; };
  }, [inviteToken]);

  /**
   * Extract the most relevant error message from Django's register
   * response.
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

  /** Save auth response and redirect to home. */
  function completeAuth(payload: RegisterResponse) {
    const token = payload.data?.token ?? "";
    const nextEmail = payload.data?.user?.email ?? email;
    const nextRole = payload.data?.user?.role ?? "owner";
    const nextOrganization = toSessionOrganization(payload.data?.organization);

    saveClientSession({
      token,
      email: nextEmail,
      role: nextRole,
      organization: nextOrganization,
      capabilities: payload.data?.capabilities,
    });

    setMessage("Success! Redirecting...");
    setMessageTone("neutral");
    router.push("/");
  }

  /** Flow A (standard) and Flow B (new user with invite). */
  async function handleRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSubmitting(true);
    setMessage(inviteFlow === "flow-b" ? "Joining organization..." : "Creating account...");
    setMessageTone("neutral");

    try {
      const body: Record<string, string> = { email, password };
      if (effectiveInviteToken) {
        body.invite_token = effectiveInviteToken;
      }

      const response = await fetch(`${defaultApiBaseUrl}/auth/register/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload: RegisterResponse = await response.json();

      if (!response.ok || !payload.data?.token) {
        setMessage(normalizeRegisterError(payload));
        setMessageTone("error");
        setIsSubmitting(false);
        return;
      }

      completeAuth(payload);
    } catch {
      setMessage("Could not reach register endpoint.");
      setMessageTone("error");
    } finally {
      setIsSubmitting(false);
    }
  }

  /** Flow C: existing user accepting invite via password confirmation. */
  async function handleAcceptInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setIsSubmitting(true);
    setMessage("Confirming and switching organization...");
    setMessageTone("neutral");

    try {
      const response = await fetch(`${defaultApiBaseUrl}/auth/accept-invite/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_token: inviteToken, password }),
      });

      const payload: RegisterResponse = await response.json();

      if (!response.ok || !payload.data?.token) {
        setMessage(payload.error?.message ?? "Could not accept invite.");
        setMessageTone("error");
        setIsSubmitting(false);
        return;
      }

      completeAuth(payload);
    } catch {
      setMessage("Could not reach accept-invite endpoint.");
      setMessageTone("error");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Verifying state — show loading
  if (inviteFlow === "verifying") {
    return (
      <section className={styles.shell}>
        <div className={styles.card}>
          <p className={styles.message}>Verifying invite link...</p>
        </div>
      </section>
    );
  }

  // Flow C: existing user — password confirmation only
  if (inviteFlow === "flow-c" && inviteData) {
    return (
      <section className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.warning} role="note" aria-label="Organization switch warning">
            <p className={styles.warningTitle}>Organization Switch</p>
            <p className={styles.warningText}>
              You&apos;ve been invited to join <strong>{inviteData.organization_name}</strong> as{" "}
              <strong>{inviteData.role}</strong>. Accepting will move you from your current
              organization. You will lose access to your current org&apos;s data.
            </p>
          </div>
          <form className={styles.form} onSubmit={handleAcceptInvite}>
            <label>
              Email
              <input type="email" value={email} disabled />
            </label>
            <label>
              Confirm Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
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
                {isSubmitting ? "Accepting..." : "Accept Invite"}
              </button>
            </div>
            <p className={styles.formHint}>
              Not your account? <Link href="/register">Register a new account</Link>.
            </p>
          </form>
        </div>
      </section>
    );
  }

  // Flow A (no token) or Flow B (new user with invite) or error fallback
  return (
    <section className={styles.shell}>
      <div className={styles.card}>
        {inviteFlow === "flow-b" && (inviteData || detectedInvite) ? (
          <div className={styles.warning} role="note" aria-label="Invite context">
            <p className={styles.warningTitle}>You&apos;re Invited</p>
            <p className={styles.warningText}>
              Create an account to join{" "}
              <strong>{inviteData?.organization_name ?? detectedInvite?.organization_name}</strong> as{" "}
              <strong>{inviteData?.role ?? detectedInvite?.role}</strong>.
            </p>
          </div>
        ) : (
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
        )}
        {detectedInvite && inviteFlow === "none" ? (
          <div className={styles.inviteDetected} role="note" aria-label="Pending invite detected">
            <p className={styles.inviteDetectedText}>
              You&apos;ve been invited to join <strong>{detectedInvite.organization_name}</strong> as{" "}
              <strong>{detectedInvite.role}</strong>. Complete registration below to join.
            </p>
          </div>
        ) : null}
        <form className={styles.form} onSubmit={handleRegister}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onBlur={checkForPendingInvite}
              autoComplete="email"
              required
              readOnly={inviteFlow === "flow-b"}
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
              {isSubmitting
                ? "Creating..."
                : inviteFlow === "flow-b"
                  ? "Create Account & Join"
                  : "Create account"}
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
