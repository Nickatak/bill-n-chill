/**
 * Session authorization provider and hook.
 *
 * Wraps the app in a React context that tracks auth status. On mount
 * (and when the token changes), it verifies the token against
 * `GET /auth/me/`. The provider stays in "checking" until verification
 * completes — AuthGate renders nothing during this phase, so there is
 * no flash of protected content before the backend confirms the session.
 *
 * Once a token has been verified, subsequent renders with the same token
 * skip the network call and remain "authorized". If the token is revoked
 * server-side (401/403), the session is cleared and the user is redirected
 * to /login via AuthGate.
 */
"use client";

import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { buildAuthHeaders } from "./auth-headers";
import {
  clearClientSession,
  loadClientSession,
  saveClientSession,
  type Capabilities,
  type SessionOrganization,
  type SessionRole,
} from "./client-session";
import { useSharedSessionAuth } from "./use-shared-session";

import { defaultApiBaseUrl } from "@/shared/api/base";
const AUTH_FAILURE_STATUSES = new Set([401, 403]);

type AuthorizationStatus = "checking" | "authorized" | "unauthorized";

type SessionAuthorizationContextValue = {
  token: string;
  role: SessionRole;
  capabilities: Capabilities | undefined;
  organization: SessionOrganization | null;
  authMessage: string;
  status: AuthorizationStatus;
  isAuthorized: boolean;
  isChecking: boolean;
  isRefreshing: boolean;
};

const SessionAuthorizationContext = createContext<SessionAuthorizationContextValue | null>(null);

type SessionAuthorizationProviderProps = {
  children: ReactNode;
};

/**
 * Top-level provider that verifies the session token on mount and
 * exposes auth state to all descendants via context.
 */
export function SessionAuthorizationProvider({ children }: SessionAuthorizationProviderProps) {
  const { token, role, organization, authMessage, capabilities } = useSharedSessionAuth();
  const [status, setStatus] = useState<AuthorizationStatus>("checking");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const verifiedTokenRef = useRef("");

  // Verify the token against the backend whenever it changes.
  useEffect(() => {
    let cancelled = false;

    /**
     * Call GET /auth/me/ with the candidate token. On 401/403, clear
     * the session and mark unauthorized. On transient network errors,
     * mark unauthorized — if the backend is unreachable the app is
     * unusable anyway, and masking failures causes confusing state.
     */
    async function verifyToken(candidateToken: string) {
      setIsRefreshing(true);

      try {
        const response = await fetch(`${defaultApiBaseUrl}/auth/me/`, {
          headers: buildAuthHeaders(candidateToken, { organization }),
        });
        const mePayload = await response.json();

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          if (AUTH_FAILURE_STATUSES.has(response.status)) {
            clearClientSession();
          }
          verifiedTokenRef.current = "";
          setStatus("unauthorized");
          setIsRefreshing(false);
          return;
        }

        // Refresh capabilities from the /me response so they stay current.
        const freshCapabilities = mePayload?.data?.capabilities;
        if (freshCapabilities) {
          const current = loadClientSession();
          if (current) {
            saveClientSession({ ...current, capabilities: freshCapabilities });
          }
        }

        verifiedTokenRef.current = candidateToken;
        setStatus("authorized");
      } catch {
        if (cancelled) {
          return;
        }
        verifiedTokenRef.current = "";
        setStatus("unauthorized");
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }

    if (!token) {
      verifiedTokenRef.current = "";
      setIsRefreshing(false);
      setStatus("unauthorized");
      return () => {
        cancelled = true;
      };
    }

    // Skip re-verification if we already verified this exact token.
    if (verifiedTokenRef.current === token) {
      setStatus("authorized");
      return () => {
        cancelled = true;
      };
    }

    // Stay in "checking" while verification is in flight.
    setStatus("checking");
    void verifyToken(token);

    return () => {
      cancelled = true;
    };
  }, [organization, token]);

  const value = useMemo<SessionAuthorizationContextValue>(
    () => ({
      token,
      role,
      capabilities,
      organization,
      authMessage,
      status,
      isAuthorized: status === "authorized",
      isChecking: status === "checking",
      isRefreshing,
    }),
    [authMessage, capabilities, isRefreshing, organization, role, status, token],
  );

  return (
    <SessionAuthorizationContext.Provider value={value}>
      {children}
    </SessionAuthorizationContext.Provider>
  );
}

/** Consume the session authorization context. Must be used within SessionAuthorizationProvider. */
export function useSessionAuthorization() {
  const context = useContext(SessionAuthorizationContext);
  if (!context) {
    throw new Error("useSessionAuthorization must be used within SessionAuthorizationProvider.");
  }
  return context;
}
