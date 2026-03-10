/**
 * Superuser impersonation page — lists all impersonatable users
 * and lets the superuser start an impersonation session.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { defaultApiBaseUrl } from "@/shared/api/base";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { startImpersonation, type SessionRole } from "@/shared/session/client-session";
import { useSessionAuthorization } from "@/shared/session/session-authorization";

import styles from "./page.module.css";

type ImpersonatableUser = {
  id: number;
  email: string;
  organization?: {
    id: number;
    display_name: string;
  };
  role?: string;
};

export default function ImpersonatePage() {
  const { token, isSuperuser } = useSessionAuthorization();
  const router = useRouter();
  const [users, setUsers] = useState<ImpersonatableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [startingId, setStartingId] = useState<number | null>(null);

  useEffect(() => {
    if (!token || !isSuperuser) {
      setLoading(false);
      return;
    }

    async function fetchUsers() {
      try {
        const response = await fetch(`${defaultApiBaseUrl}/admin/impersonate/users/`, {
          headers: buildAuthHeaders(token),
        });
        const payload = await response.json();
        if (response.ok) {
          setUsers(payload.data ?? []);
        } else {
          setError(payload.error?.message ?? "Failed to load users.");
        }
      } catch {
        setError("Could not reach the server.");
      } finally {
        setLoading(false);
      }
    }

    void fetchUsers();
  }, [token, isSuperuser]);

  const handleImpersonate = useCallback(
    async (userId: number) => {
      if (startingId) return;
      setStartingId(userId);
      setError("");

      try {
        const response = await fetch(`${defaultApiBaseUrl}/admin/impersonate/`, {
          method: "POST",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({ user_id: userId }),
        });
        const payload = await response.json();

        if (!response.ok) {
          setError(payload.error?.message ?? "Failed to start impersonation.");
          setStartingId(null);
          return;
        }

        const data = payload.data;
        startImpersonation({
          token: data.token,
          email: data.user?.email ?? "",
          role: (data.user?.role ?? "owner") as SessionRole,
          organization: data.organization
            ? {
                id: data.organization.id,
                displayName: data.organization.display_name,
                onboardingCompleted: data.organization.onboarding_completed ?? false,
              }
            : undefined,
          capabilities: data.capabilities,
          isSuperuser: false,
          impersonation: {
            active: true,
            realEmail: data.impersonation?.real_email ?? "",
          },
        });

        // Full reload so all state reinitializes.
        window.location.href = "/dashboard";
      } catch {
        setError("Could not reach the server.");
        setStartingId(null);
      }
    },
    [startingId, token],
  );

  if (!isSuperuser) {
    return <p className={styles.forbidden}>Superuser access required.</p>;
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Impersonate User</h1>

      {loading ? <p>Loading users...</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      {!loading && users.length === 0 && !error ? (
        <p className={styles.empty}>No users available for impersonation.</p>
      ) : null}

      <div className={styles.userList}>
        {users.map((user) => (
          <div key={user.id} className={styles.userCard}>
            <div className={styles.userInfo}>
              <span className={styles.email}>{user.email}</span>
              <span className={styles.meta}>
                {user.organization?.display_name ?? "No org"}
                {user.role ? ` — ${user.role}` : ""}
              </span>
            </div>
            <button
              type="button"
              className={styles.impersonateButton}
              onClick={() => handleImpersonate(user.id)}
              disabled={startingId !== null}
            >
              {startingId === user.id ? "Starting..." : "Impersonate"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
