"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";

import { buildAuthHeaders } from "./auth-headers";
import { clearClientSession, type SessionOrganization, type SessionRole } from "./client-session";
import { useSharedSessionAuth } from "./use-shared-session";

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

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
  const [status, setStatus] = useState<AuthorizationStatus>(token ? "checking" : "unauthorized");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const verifiedTokenRef = useRef("");
  const statusRef = useRef<AuthorizationStatus>(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    let cancelled = false;

    async function verifyToken(candidateToken: string, runAsRefresh: boolean) {
      if (runAsRefresh) {
        setIsRefreshing(true);
      } else {
        setStatus("checking");
      }

      try {
        const response = await fetch(`${defaultApiBaseUrl}/auth/me/`, {
          headers: buildAuthHeaders(candidateToken, { organization }),
        });
        await response.json();
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          clearClientSession();
          verifiedTokenRef.current = "";
          setStatus("unauthorized");
          setIsRefreshing(false);
          return;
        }
        verifiedTokenRef.current = candidateToken;
        setStatus("authorized");
      } catch {
        if (cancelled) {
          return;
        }
        if (!runAsRefresh || statusRef.current !== "authorized") {
          setStatus("unauthorized");
        }
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

    if (verifiedTokenRef.current === token) {
      setStatus("authorized");
      return () => {
        cancelled = true;
      };
    }

    const runAsRefresh = statusRef.current === "authorized";
    void verifyToken(token, runAsRefresh);

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
