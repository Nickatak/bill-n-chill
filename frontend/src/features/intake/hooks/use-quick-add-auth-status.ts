"use client";

import { useEffect, useState } from "react";

import { fetchIntakeAuthMe } from "../api";
import { ApiResponse } from "../types";
import { clearClientSession } from "../../session/client-session";

type UseQuickAddAuthStatusArgs = {
  token: string;
  baseAuthMessage: string;
  normalizedBaseUrl: string;
};

export function useQuickAddAuthStatus({
  token,
  baseAuthMessage,
  normalizedBaseUrl,
}: UseQuickAddAuthStatusArgs): string {
  const [authVerificationMessage, setAuthVerificationMessage] = useState("");
  const effectiveBaseMessage = baseAuthMessage.startsWith("Using shared session for ")
    ? ""
    : baseAuthMessage;

  useEffect(() => {
    let cancelled = false;

    async function verifySharedSession() {
      if (!token) {
        if (!cancelled) {
          setAuthVerificationMessage("");
        }
        return;
      }
      if (!cancelled) {
        setAuthVerificationMessage("Checking shared session...");
      }
      try {
        const response = await fetchIntakeAuthMe({
          baseUrl: normalizedBaseUrl,
          token,
        });
        await response.json() as ApiResponse;
        if (!response.ok) {
          clearClientSession();
          if (!cancelled) {
            setAuthVerificationMessage("Shared session token is invalid. Go to / and login again.");
          }
          return;
        }
        if (!cancelled) {
          setAuthVerificationMessage("");
        }
      } catch {
        if (!cancelled) {
          setAuthVerificationMessage("Could not reach auth/me endpoint.");
        }
      }
    }

    void verifySharedSession();

    return () => {
      cancelled = true;
    };
  }, [normalizedBaseUrl, token]);

  return authVerificationMessage || effectiveBaseMessage;
}
