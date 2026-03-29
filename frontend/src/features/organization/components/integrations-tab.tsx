"use client";

/**
 * "Integrations" tab — QuickBooks Online connection management.
 * Only rendered when isDebugMode is true (dev-only gate).
 *
 * Parent: OrganizationConsole
 */

import { useCallback, useEffect, useState } from "react";

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { normalizeApiBaseUrl, defaultApiBaseUrl } from "../api";
import styles from "./organization-console.module.css";

type QBOStatus = {
  connected: boolean;
  realm_id?: string;
  connected_at?: string;
  access_token_expired?: boolean;
  refresh_token_expired?: boolean;
};

type IntegrationsTabProps = {
  authToken: string;
};

export function IntegrationsTab({ authToken }: IntegrationsTabProps) {
  const baseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const [qboStatus, setQboStatus] = useState<QBOStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [disconnecting, setDisconnecting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(`${baseUrl}/qbo/status/`, {
        headers: buildAuthHeaders(authToken),
      });
      if (response.status === 404) {
        // QBO not enabled
        setQboStatus(null);
        setLoading(false);
        return;
      }
      const payload = await response.json();
      if (response.ok) {
        setQboStatus(payload.data as QBOStatus);
      }
    } catch {
      setError("Could not check QuickBooks status.");
    } finally {
      setLoading(false);
    }
  }, [authToken, baseUrl]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function handleConnect() {
    setError("");
    try {
      const response = await fetch(`${baseUrl}/qbo/connect/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload = await response.json();
      if (response.ok && payload.data?.authorization_url) {
        window.location.href = payload.data.authorization_url;
      } else {
        setError(payload.error?.message || "Could not start QuickBooks connection.");
      }
    } catch {
      setError("Could not reach QuickBooks connect endpoint.");
    }
  }

  async function handleDisconnect() {
    setError("");
    setDisconnecting(true);
    try {
      const response = await fetch(`${baseUrl}/qbo/disconnect/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken),
      });
      if (response.ok) {
        setQboStatus({ connected: false });
      } else {
        const payload = await response.json();
        setError(payload.error?.message || "Could not disconnect QuickBooks.");
      }
    } catch {
      setError("Could not reach QuickBooks disconnect endpoint.");
    } finally {
      setDisconnecting(false);
    }
  }

  if (loading) {
    return <p className={styles.loadingText}>Checking integrations&hellip;</p>;
  }

  // QBO feature not enabled
  if (qboStatus === null) {
    return (
      <div className={styles.integrationSection}>
        <h4 className={styles.integrationHeading}>QuickBooks Online</h4>
        <p className={styles.integrationHint}>
          QuickBooks integration is not enabled in this environment.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.integrationSection}>
      <h4 className={styles.integrationHeading}>QuickBooks Online</h4>

      {error ? <p className={styles.errorText}>{error}</p> : null}

      {qboStatus.connected ? (
        <div className={styles.integrationStatus}>
          <div className={styles.integrationConnected}>
            <span className={styles.integrationDot} />
            <span>Connected</span>
          </div>
          <div className={styles.integrationMeta}>
            <span>Company ID: {qboStatus.realm_id}</span>
            {qboStatus.connected_at ? (
              <span>Since {new Date(qboStatus.connected_at).toLocaleDateString()}</span>
            ) : null}
            {qboStatus.refresh_token_expired ? (
              <span className={styles.integrationWarning}>
                Session expired — reconnect required.
              </span>
            ) : qboStatus.access_token_expired ? (
              <span className={styles.integrationHint}>
                Token will refresh automatically on next sync.
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleDisconnect}
            disabled={disconnecting}
          >
            {disconnecting ? "Disconnecting\u2026" : "Disconnect"}
          </button>
        </div>
      ) : (
        <div className={styles.integrationStatus}>
          <p className={styles.integrationHint}>
            Connect your QuickBooks Online account to push invoices, bills,
            payments, and customer records from Bill n Chill to QuickBooks.
          </p>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleConnect}
          >
            Connect to QuickBooks
          </button>
        </div>
      )}
    </div>
  );
}
