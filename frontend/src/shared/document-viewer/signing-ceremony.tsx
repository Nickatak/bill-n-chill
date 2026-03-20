"use client";

/**
 * Shared signing ceremony component for public document decisions.
 *
 * Handles the full OTP verification → signing ceremony flow:
 * 1. If no customer email: shows "email required" message (dead end).
 * 2. Send OTP → enter code → verify identity.
 * 3. Signing ceremony: document summary, type name, consent checkbox.
 * 4. Submit decision via parent callback.
 *
 * Used by estimate, change order, and invoice public preview pages.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./signing-ceremony.module.css";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/shared/api/base";

const API_BASE = normalizeApiBaseUrl(defaultApiBaseUrl);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DecisionOption = {
  label: string;
  value: string;
  variant: "primary" | "secondary";
};

export type CeremonyPayload = {
  session_token: string;
  signer_name: string;
  consent_accepted: true;
  note: string;
};

type SigningCeremonyProps = {
  publicToken: string;
  documentType: "estimate" | "change_order" | "invoice";
  documentSummary: { type: string; title: string; total: string };
  customerEmailAvailable: boolean;
  consentText: string;
  decisions: DecisionOption[];
  onDecision: (decision: string, ceremony: CeremonyPayload) => Promise<void>;
  disabled?: boolean;
};

type Phase = "no_email" | "idle" | "otp_requested" | "ceremony_ready";


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SigningCeremony({
  publicToken,
  documentType,
  documentSummary,
  customerEmailAvailable,
  consentText,
  decisions,
  onDecision,
  disabled = false,
}: SigningCeremonyProps) {

  // Phase state machine.
  const [phase, setPhase] = useState<Phase>(customerEmailAvailable ? "idle" : "no_email");

  // OTP state.
  const [emailHint, setEmailHint] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [sessionToken, setSessionToken] = useState("");

  // Ceremony state.
  const [signerName, setSignerName] = useState("");
  const [signerNote, setSignerNote] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);

  // UI state.
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup cooldown timer.
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  // Start cooldown timer.
  const startCooldown = useCallback((seconds: number) => {
    setCooldown(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  /** Request an OTP code via the backend. */
  async function requestOtp() {
    setLoading(true);
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE}/public/${documentType}/${publicToken}/otp/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          setErrorMessage(payload.error?.message || "Please wait before requesting another code.");
          startCooldown(60);
        } else {
          setErrorMessage(payload.error?.message || "Could not send verification code.");
        }
        return;
      }

      setEmailHint(payload.data?.email_hint || "");
      setPhase("otp_requested");
      setMessage("Verification code sent. Check your email.");
      startCooldown(60);
    } catch {
      setErrorMessage("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  /** Verify the OTP code entered by the customer. */
  async function verifyOtp() {
    if (!otpCode.trim()) {
      setErrorMessage("Please enter the verification code.");
      return;
    }

    setLoading(true);
    setErrorMessage("");
    setMessage("");

    try {
      const response = await fetch(`${API_BASE}/public/${documentType}/${publicToken}/otp/verify/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: otpCode.trim() }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setErrorMessage(payload.error?.message || "Verification failed.");
        return;
      }

      setSessionToken(payload.data?.session_token || "");
      setPhase("ceremony_ready");
      setMessage("");
    } catch {
      setErrorMessage("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  /** Submit a decision through the parent callback with ceremony data. */
  async function submitDecision(decision: string) {
    if (!signerName.trim()) {
      setErrorMessage("Please type your full name.");
      return;
    }
    if (!consentChecked) {
      setErrorMessage("Please check the consent box to continue.");
      return;
    }

    setLoading(true);
    setErrorMessage("");

    try {
      await onDecision(decision, {
        session_token: sessionToken,
        signer_name: signerName.trim(),
        consent_accepted: true,
        note: signerNote.trim(),
      });
    } catch {
      setErrorMessage("Could not submit decision.");
    } finally {
      setLoading(false);
    }
  }

  const isDisabled = disabled || loading;

  // -------------------------------------------------------------------------
  // No customer email — dead end
  // -------------------------------------------------------------------------
  if (phase === "no_email") {
    return (
      <div className={styles.ceremony}>
        <h3>Decision</h3>
        <p className={styles.noEmailNotice}>
          Identity verification is required before you can approve or reject this document.
          A customer email address is not on file — please contact your contractor to update
          your contact information.
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // OTP request phase (idle)
  // -------------------------------------------------------------------------
  if (phase === "idle") {
    return (
      <div className={styles.ceremony}>
        <h3>Verify Your Identity</h3>
        <p className={styles.inlineHint}>
          To make a decision on this document, we need to verify your identity.
          A verification code will be sent to the email address your contractor has on file.
        </p>
        {errorMessage ? <p className={styles.inlineError}>{errorMessage}</p> : null}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void requestOtp()}
            disabled={isDisabled}
          >
            Send Verification Code
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // OTP entry phase
  // -------------------------------------------------------------------------
  if (phase === "otp_requested") {
    return (
      <div className={styles.ceremony}>
        <h3>Enter Verification Code</h3>
        {message ? <p className={styles.inlineHint}>{message}</p> : null}
        {emailHint ? <p className={styles.emailHint}>Code sent to {emailHint}</p> : null}
        {errorMessage ? <p className={styles.inlineError}>{errorMessage}</p> : null}
        <div className={styles.otpRow}>
          <label className={styles.field}>
            6-digit code
            <input
              className={styles.codeInput}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              disabled={isDisabled}
              autoFocus
            />
          </label>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void verifyOtp()}
            disabled={isDisabled || otpCode.length < 6}
          >
            Verify
          </button>
        </div>
        <div className={styles.resendRow}>
          <button
            type="button"
            className={styles.resendButton}
            onClick={() => void requestOtp()}
            disabled={isDisabled || cooldown > 0}
          >
            Resend code
          </button>
          {cooldown > 0 ? (
            <span className={styles.cooldownLabel}>({cooldown}s)</span>
          ) : null}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Signing ceremony phase
  // -------------------------------------------------------------------------
  return (
    <div className={styles.ceremony}>
      <span className={styles.sectionLabel}>Electronic Signature</span>

      <div className={styles.documentSummary}>
        <span className={styles.summaryType}>{documentSummary.type}</span>
        <p className={styles.summaryTitle}>{documentSummary.title}</p>
        {documentSummary.total ? (
          <span className={styles.summaryTotal}>Total: {documentSummary.total}</span>
        ) : null}
      </div>

      <label className={styles.field}>
        Full legal name (required)
        <input
          type="text"
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          placeholder="Type your full name"
          disabled={isDisabled}
        />
      </label>

      <label className={styles.field}>
        Note (optional)
        <textarea
          rows={2}
          value={signerNote}
          onChange={(e) => setSignerNote(e.target.value)}
          placeholder="Optional note"
          disabled={isDisabled}
        />
      </label>

      <div className={styles.consentBox}>
        <span className={styles.draftBanner}>DRAFT — NOT YET LEGALLY REVIEWED</span>
        <p className={styles.consentText}>{consentText.replace("[DRAFT — REQUIRES ATTORNEY REVIEW BEFORE PRODUCTION USE]\n\n", "")}</p>
        <div className={styles.consentCheckRow}>
          <input
            type="checkbox"
            id="ceremony-consent"
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            disabled={isDisabled}
          />
          <label htmlFor="ceremony-consent">
            I agree to the above terms and intend this as my electronic signature.
          </label>
        </div>
      </div>

      {errorMessage ? <p className={styles.inlineError}>{errorMessage}</p> : null}

      <div className={styles.actions}>
        {decisions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.variant === "primary" ? styles.primaryButton : styles.secondaryButton}
            onClick={() => void submitDecision(option.value)}
            disabled={isDisabled || !signerName.trim() || !consentChecked}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
