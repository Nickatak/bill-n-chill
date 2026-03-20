"use client";

import { useRouter } from "next/navigation";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { loadClientSession, saveClientSession } from "@/shared/session/client-session";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { defaultApiBaseUrl } from "@/shared/api/base";
import styles from "./dismiss-guide-button.module.css";

export function DismissGuideButton() {
  const { token } = useSharedSessionAuth();
  const router = useRouter();

  async function handleDismiss() {
    try {
      await fetch(`${defaultApiBaseUrl}/organization/complete-onboarding/`, {
        method: "POST",
        headers: buildAuthHeaders(token),
      });
    } catch {
      // Best-effort — navigate anyway so the user isn't stuck.
    }
    const session = loadClientSession();
    if (session?.organization) {
      saveClientSession({
        ...session,
        organization: { ...session.organization, onboardingCompleted: true },
      });
    }
    router.push("/customers");
  }

  return (
    <button type="button" className={styles.button} onClick={handleDismiss}>
      Dismiss Guide
    </button>
  );
}
