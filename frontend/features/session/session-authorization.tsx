'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { clearClientSession, SESSION_STORAGE_KEY } from './client-session';
import { useSharedSessionAuth } from './use-shared-session';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';
const AUTH_FAILURE_STATUSES = new Set([401, 403]);

type AuthorizationStatus = 'checking' | 'authorized' | 'unauthorized';

type SessionAuthorizationContextValue = {
  token: string;
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
  const { token, authMessage } = useSharedSessionAuth();
  const [status, setStatus] = useState<AuthorizationStatus>('checking');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const verifiedTokenRef = useRef('');
  const statusRef = useRef<AuthorizationStatus>(status);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    let cancelled = false;

    async function verifyToken(candidateToken: string) {
      setIsRefreshing(true);

      try {
        const response = await fetch(`${API_BASE_URL}/auth/profile/`, {
          headers: {
            Authorization: `Bearer ${candidateToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          if (AUTH_FAILURE_STATUSES.has(response.status)) {
            clearClientSession();
            verifiedTokenRef.current = '';
            setStatus('unauthorized');
            setIsRefreshing(false);
            return;
          }
          // Preserve authorized UI on transient upstream/network failures.
          setStatus('authorized');
          return;
        }

        verifiedTokenRef.current = candidateToken;
        setStatus('authorized');
      } catch {
        if (cancelled) {
          return;
        }
        // Network/transient errors should not force logout.
        setStatus('authorized');
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }

    if (!token) {
      let hasPendingToken = false;
      if (typeof window !== 'undefined') {
        const snapshot =
          window.localStorage.getItem(SESSION_STORAGE_KEY) ||
          window.localStorage.getItem('accessToken');
        hasPendingToken = Boolean(snapshot);
      }

      if (hasPendingToken) {
        setStatus('checking');
        return () => {
          cancelled = true;
        };
      }

      verifiedTokenRef.current = '';
      setIsRefreshing(false);
      setStatus('unauthorized');
      return () => {
        cancelled = true;
      };
    }

    if (verifiedTokenRef.current === token) {
      setStatus('authorized');
      return () => {
        cancelled = true;
      };
    }

    if (statusRef.current !== 'authorized') {
      setStatus('authorized');
    }

    void verifyToken(token);

    return () => {
      cancelled = true;
    };
  }, [token]);

  const value = useMemo<SessionAuthorizationContextValue>(
    () => ({
      token,
      authMessage,
      status,
      isAuthorized: status === 'authorized',
      isChecking: status === 'checking',
      isRefreshing,
    }),
    [authMessage, isRefreshing, status, token],
  );

  return <SessionAuthorizationContext.Provider value={value}>{children}</SessionAuthorizationContext.Provider>;
}

export function useSessionAuthorization() {
  const context = useContext(SessionAuthorizationContext);
  if (!context) {
    throw new Error('useSessionAuthorization must be used within SessionAuthorizationProvider.');
  }
  return context;
}
