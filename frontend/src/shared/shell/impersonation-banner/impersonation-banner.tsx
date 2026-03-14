/**
 * Persistent banner shown when a superuser is impersonating another user.
 *
 * Displays who is being impersonated and provides an exit button that
 * ends the impersonation session and restores the superuser's real session.
 */
"use client";

import { useCallback, useState } from "react";

import { defaultApiBaseUrl } from "@/shared/api/base";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { exitImpersonation, loadClientSession } from "@/shared/session/client-session";
import { useSessionAuthorization } from "@/shared/session/session-authorization";

import styles from "./impersonation-banner.module.css";

export function ImpersonationBanner() {
  const { token, isImpersonating: impersonating, impersonation } = useSessionAuthorization();
  const [exiting, setExiting] = useState(false);

  const handleExit = useCallback(async () => {
    if (exiting) return;
    setExiting(true);

    try {
      // Tell the backend to delete the impersonation token.
      await fetch(`${defaultApiBaseUrl}/admin/impersonate/exit/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
      });
    } catch {
      // Best-effort — even if the backend call fails, restore the real session.
    }

    exitImpersonation();
    // Force a full page reload so all state reinitializes with the real session.
    window.location.href = "/customers";
  }, [exiting, token]);

  if (!impersonating) {
    return null;
  }

  const session = loadClientSession();
  const targetEmail = session?.email ?? "unknown user";

  return (
    <div className={styles.banner}>
      <span className={styles.label}>
        Viewing as <strong>{targetEmail}</strong>
        {impersonation?.realEmail ? ` (logged in as ${impersonation.realEmail})` : ""}
      </span>
      <button type="button" className={styles.exitButton} onClick={handleExit} disabled={exiting}>
        {exiting ? "Exiting..." : "Exit Impersonation"}
      </button>
    </div>
  );
}
