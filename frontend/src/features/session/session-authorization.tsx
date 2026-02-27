"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";

import { buildAuthHeaders } from "./auth-headers";
import {
  clearClientSession,
  SESSION_STORAGE_KEY,
  type SessionOrganization,
  type SessionRole,
} from "./client-session";
import { useSharedSessionAuth } from "./use-shared-session";

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
const AUTH_FAILURE_STATUSES = new Set([401, 403]);

type AuthorizationStatus = "checking" | "authorized" | "unauthorized";

type SessionAuthorizationContextValue = {
  token: string;
  role: SessionRole;
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

export function SessionAuthorizationProvider({ children }: SessionAuthorizationProviderProps) {
  const { token, role, organization, authMessage } = useSharedSessionAuth();
  const [status, setStatus] = useState<AuthorizationStatus>("checking");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const verifiedTokenRef = useRef("");
  const statusRef = useRef<AuthorizationStatus>(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    let cancelled = false;

    async function verifyToken(candidateToken: string) {
      setIsRefreshing(true);

      try {
        const response = await fetch(`${defaultApiBaseUrl}/auth/me/`, {
          headers: buildAuthHeaders(candidateToken, { organization }),
        });
        await response.json();
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          if (AUTH_FAILURE_STATUSES.has(response.status)) {
            clearClientSession();
            verifiedTokenRef.current = "";
            setStatus("unauthorized");
            setIsRefreshing(false);
            return;
          }
          // Preserve authorized UI on transient upstream/CDN failures.
          setStatus("authorized");
          return;
        }
        verifiedTokenRef.current = candidateToken;
        setStatus("authorized");
      } catch {
        if (cancelled) {
          return;
        }
        // Network/transient errors should not force logout.
        setStatus("authorized");
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }

    if (!token) {
      let hasPendingToken = false;
      if (typeof window !== "undefined") {
        const rawSnapshot = window.localStorage.getItem(SESSION_STORAGE_KEY);
        if (rawSnapshot) {
          try {
            const parsed = JSON.parse(rawSnapshot) as { token?: string };
            hasPendingToken = Boolean(parsed?.token);
          } catch {
            hasPendingToken = false;
          }
        }
      }
      if (hasPendingToken) {
        setStatus("checking");
        return () => {
          cancelled = true;
        };
      }
      verifiedTokenRef.current = "";
      setIsRefreshing(false);
      setStatus("unauthorized");
      return () => {
        cancelled = true;
      };
    }

    if (verifiedTokenRef.current === token) {
      setStatus("authorized");
      return () => {
        cancelled = true;
      };
    }

    if (statusRef.current !== "authorized") {
      setStatus("authorized");
    }
    void verifyToken(token);

    return () => {
      cancelled = true;
    };
  }, [organization, token]);

  const value = useMemo<SessionAuthorizationContextValue>(
    () => ({
      token,
      role,
      organization,
      authMessage,
      status,
      isAuthorized: status === "authorized",
      isChecking: status === "checking",
      isRefreshing,
    }),
    [authMessage, isRefreshing, organization, role, status, token],
  );

  return (
    <SessionAuthorizationContext.Provider value={value}>
      {children}
    </SessionAuthorizationContext.Provider>
  );
}

export function useSessionAuthorization() {
  const context = useContext(SessionAuthorizationContext);
  if (!context) {
    throw new Error("useSessionAuthorization must be used within SessionAuthorizationProvider.");
  }
  return context;
}
