"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { HealthResult } from "@/shared/api/health";
import {
  loadClientSession,
  saveClientSession,
  type SessionOrganization,
  type SessionRole,
} from "../client-session";
import styles from "./home-auth-console.module.css";
import animStyles from "@/shared/styles/animations.module.css";

type RegisterResponse = {
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

type InviteFlowState = "none" | "verifying" | "flow-b" | "flow-c" | "error";

type HomeRegisterConsoleProps = {
  health: HealthResult;
  inviteToken?: string;
};

import { defaultApiBaseUrl } from "@/shared/api/base";

function TermsConsent(): ReactNode {
  return (
    <p className={styles.termsConsent}>
      By creating an account, you agree to our{" "}
      <Link href="/terms" target="_blank">Terms of Service</Link> and{" "}
      <Link href="/privacy" target="_blank">Privacy Policy</Link>.
    </p>
  );
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
 * Registration console supporting three flows: standard signup (Flow A),
 * new-user invite acceptance (Flow B), and existing-user org switch (Flow C).
 * Verifies invite tokens on mount and routes to the appropriate form.
 */
export function HomeRegisterConsole({ health, inviteToken }: HomeRegisterConsoleProps) {
  const router = useRouter();
  const [messageTone, setMessageTone] = useState<"neutral" | "error">("neutral");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [checkEmailSent, setCheckEmailSent] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Redirect authenticated users to home (unless they're accepting an invite).
  useEffect(() => {
    if (inviteToken) return;
    const session = loadClientSession();
    if (session?.token) {
      router.replace("/customers");
    }
  }, [inviteToken, router]);

  // Invite flow state
  const [inviteFlow, setInviteFlow] = useState<InviteFlowState>(inviteToken ? "verifying" : "none");
  const [inviteData, setInviteData] = useState<VerifyInviteData | null>(null);

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
    router.push("/customers");
  }

  /** Flow A (standard) and Flow B (new user with invite). */
  async function handleRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.trim()) {
      setMessage("Email is required.");
      setMessageTone("error");
      return;
    }
    if (!password) {
      setMessage("Password is required.");
      setMessageTone("error");
      return;
    }
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      setMessageTone("error");
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    setMessageTone("neutral");

    try {
      const body: Record<string, string> = { email, password };
      if (inviteToken) {
        body.invite_token = inviteToken;
      }

      const response = await fetch(`${defaultApiBaseUrl}/auth/register/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload: RegisterResponse = await response.json();

      // Flow A: "check your email" response (no token, has message).
      if (response.ok && payload.data?.message && !payload.data?.token) {
        setMessage("");
        setCheckEmailSent(true);
        setIsSubmitting(false);
        return;
      }

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

  /** Start a visual countdown that disables the resend button. */
  function startCooldown(seconds: number) {
    setResendCooldown(seconds);
    const id = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) { clearInterval(id); return 0; }
        return prev - 1;
      });
    }, 1000);
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
        const body = await response.json();
        const match = body?.error?.message?.match(/(\d+) seconds/);
        const wait = match ? parseInt(match[1], 10) : 60;
        startCooldown(wait);
        setMessage("");
        return;
      }

      setMessage("Verification email resent.");
      setMessageTone("neutral");
      startCooldown(60);
    } catch {
      setMessage("Could not reach resend endpoint.");
      setMessageTone("error");
    } finally {
      setIsResending(false);
    }
  }

  /** Flow C: existing user accepting invite via password confirmation. */
  async function handleAcceptInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!password) {
      setMessage("Password is required.");
      setMessageTone("error");
      return;
    }

    setIsSubmitting(true);
    setMessage("");
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

  // Flow A success — "check your email" screen
  if (checkEmailSent) {
    return (
      <section className={styles.shell}>
        <div className={`${styles.card} ${styles.cardCentered}`}>
          <div className={styles.warning} role="note" aria-label="Verification email sent">
            <p className={styles.warningTitle}>Check your email</p>
            <p className={styles.warningText}>
              We sent a verification link to <strong>{email}</strong>. Click the link to activate your
              account. The link expires in 24 hours.
            </p>
          </div>
          {message && (
            <p className={`${styles.message} ${messageTone === "error" ? styles.messageError : ""}`}>
              {message}
            </p>
          )}
          <button
            className={styles.button}
            type="button"
            disabled={isResending || resendCooldown > 0}
            onClick={handleResendVerification}
          >
            {isResending
              ? <span className={animStyles.sendingDots}>Sending</span>
              : resendCooldown > 0
                ? `Wait ${resendCooldown}s`
                : "Didn\u2019t get it? Resend"}
          </button>
          <p className={styles.formHintRight}>
            <Link href="/login">Back to sign in</Link>
          </p>
        </div>
      </section>
    );
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
                  {isSubmitting ? <span className={animStyles.sendingDots}>Accepting</span> : "Accept Invite"}
                </button>
              </div>
              <div className={styles.formHintStack}>
                <p className={styles.formHintRight}>
                  Not your account? <Link href="/register">Register a new account</Link>.
                </p>
              </div>
            </div>
          </form>
        </div>
      </section>
    );
  }

  // Flow A (no token) or Flow B (new user with invite) or error fallback
  return (
    <section className={styles.shell}>
      <div className={styles.card}>
        {inviteFlow === "flow-b" && inviteData ? (
          <div className={styles.warning} role="note" aria-label="Invite context">
            <p className={styles.warningTitle}>You&apos;re Invited</p>
            <p className={styles.warningText}>
              Create an account to join{" "}
              <strong>{inviteData.organization_name}</strong> as{" "}
              <strong>{inviteData.role}</strong>.
            </p>
          </div>
        ) : null}
        <h2 className={styles.title}>Create account</h2>
        <form className={styles.form} onSubmit={handleRegister}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              disabled={inviteFlow === "flow-b"}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          {message && (
            <p className={`${styles.message} ${messageTone === "error" ? styles.messageError : ""}`}>
              {message}
            </p>
          )}
          <TermsConsent />
          <div className={styles.formHintRow}>
            <div className={styles.buttonRow}>
              <button className={styles.button} type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? <span className={animStyles.sendingDots}>{inviteFlow === "flow-b" ? "Joining" : "Creating"}</span>
                  : inviteFlow === "flow-b"
                    ? "Create Account & Join"
                    : "Create account"}
              </button>
            </div>
            <div className={styles.formHintStack}>
              <p className={styles.formHintRight}>
                <span className={styles.desktopOnly}>Already have an account? </span>
                <Link href="/login">Sign in</Link>
                <span className={styles.desktopOnly}>.</span>
              </p>
            </div>
          </div>
        </form>
        {!health.ok && (
          <p className={styles.healthBad}>API Health: {health.message}</p>
        )}
      </div>
    </section>
  );
}
