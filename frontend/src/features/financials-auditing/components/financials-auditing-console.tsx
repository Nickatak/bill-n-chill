"use client";

/**
 * Accounting operations console. Provides audit trail export (JSON/CSV),
 * accounting sync event management (create / retry), and serves as the
 * future home for payments and QBO integration.
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useEffect, useState } from "react";

import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/features/projects/api";
import {
  AccountingSyncEventRecord,
  ApiResponse,
  FinancialAuditEventRecord,
  ProjectRecord,
} from "@/features/projects/types";
import styles from "./financials-auditing-console.module.css";

/** Escapes a value for safe embedding in a CSV cell. */
function escapeCsvCell(value: unknown): string {
  const asString = String(value ?? "");
  return `"${asString.replaceAll('"', '""')}"`;
}

/** Serializes a list of audit event records into a downloadable CSV string. */
function toAuditTrailCsv(rows: FinancialAuditEventRecord[]): string {
  const header = [
    "id",
    "project",
    "event_type",
    "object_type",
    "object_id",
    "from_status",
    "to_status",
    "amount",
    "note",
    "created_by",
    "created_by_email",
    "created_at",
    "metadata_json",
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      row.project,
      row.event_type,
      row.object_type,
      row.object_id,
      row.from_status ?? "",
      row.to_status ?? "",
      row.amount ?? "",
      row.note ?? "",
      row.created_by,
      row.created_by_email ?? "",
      row.created_at,
      JSON.stringify(row.metadata_json ?? {}),
    ]
      .map(escapeCsvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

/** Initiates a browser file download from an in-memory string payload. */
function triggerDownload(filename: string, content: string, contentType: string): void {
  const blob = new Blob([content], { type: contentType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

/** Accounting operations: audit trail export + accounting sync management. */
export function FinancialsAuditingConsole() {
  const { token, authMessage } = useSharedSessionAuth();
  const [statusMessage, setStatusMessage] = useState("");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");

  // Sync event state
  const [syncEvents, setSyncEvents] = useState<AccountingSyncEventRecord[]>([]);
  const [syncProvider, setSyncProvider] = useState<"quickbooks_online">("quickbooks_online");
  const [syncObjectType, setSyncObjectType] = useState("invoice");
  const [syncObjectId, setSyncObjectId] = useState("");
  const [syncDirection, setSyncDirection] = useState<"push" | "pull">("push");
  const [syncStatus, setSyncStatus] = useState<"queued" | "success" | "failed">("queued");
  const [syncErrorMessage, setSyncErrorMessage] = useState("");
  const [retryTargetId, setRetryTargetId] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const hasSelectedProject = Boolean(selectedProjectId);

  async function loadProjects() {
    if (!token) return;
    setStatusMessage("Loading projects...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Could not load projects.");
        return;
      }
      const rows = (payload.data as ProjectRecord[]) ?? [];
      setProjects(rows);
      if (rows[0]) {
        setSelectedProjectId(String(rows[0].id));
      }
      setStatusMessage(`Loaded ${rows.length} project(s).`);
    } catch {
      setStatusMessage("Could not reach projects endpoint.");
    }
  }

  useEffect(() => {
    if (!token) return;
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /** Low-level fetch for audit events. */
  async function fetchAuditEvents(projectId: number): Promise<FinancialAuditEventRecord[] | null> {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/audit-events/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load audit events.");
        return null;
      }
      return (payload.data as FinancialAuditEventRecord[]) ?? [];
    } catch {
      setStatusMessage("Could not reach project audit events endpoint.");
      return null;
    }
  }

  /** Exports the full audit trail for the selected project as a JSON or CSV download. */
  async function downloadAuditTrail(format: "json" | "csv") {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }
    setStatusMessage("Loading full audit trail for export...");
    const rows = await fetchAuditEvents(projectId);
    if (!rows) return;

    const orderedRows = [...rows].sort(
      (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    );
    const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");

    if (format === "json") {
      const payload = JSON.stringify(
        {
          project_id: projectId,
          exported_at: new Date().toISOString(),
          item_count: orderedRows.length,
          events: orderedRows,
        },
        null,
        2,
      );
      triggerDownload(`project-${projectId}-audit-trail-${timestamp}.json`, payload, "application/json");
      setStatusMessage(`Downloaded ${orderedRows.length} audit event(s) as JSON.`);
      return;
    }

    const csvPayload = toAuditTrailCsv(orderedRows);
    triggerDownload(`project-${projectId}-audit-trail-${timestamp}.csv`, csvPayload, "text/csv");
    setStatusMessage(`Downloaded ${orderedRows.length} audit event(s) as CSV.`);
  }

  /** Downloads the project's accounting export as a CSV file. */
  async function downloadAccountingExport() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }
    setStatusMessage("Downloading accounting export...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/accounting-export/?export_format=csv`,
        { headers: buildAuthHeaders(token) },
      );
      if (!response.ok) {
        setStatusMessage("Could not download accounting export.");
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `project-${projectId}-accounting-export.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      setStatusMessage("Accounting export downloaded.");
    } catch {
      setStatusMessage("Could not reach accounting export endpoint.");
    }
  }

  async function loadAccountingSyncEvents() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }
    setStatusMessage("Loading accounting sync events...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/accounting-sync-events/`,
        { headers: buildAuthHeaders(token) },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load sync events.");
        return;
      }
      const rows = (payload.data as AccountingSyncEventRecord[]) ?? [];
      setSyncEvents(rows);
      const failed = rows.find((row) => row.status === "failed");
      setRetryTargetId(failed ? String(failed.id) : "");
      setStatusMessage(`Loaded ${rows.length} sync event(s).`);
    } catch {
      setStatusMessage("Could not reach accounting sync events endpoint.");
    }
  }

  async function createAccountingSyncEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }
    setStatusMessage("Creating accounting sync event...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/accounting-sync-events/`,
        {
          method: "POST",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({
            provider: syncProvider,
            object_type: syncObjectType,
            object_id: syncObjectId ? Number(syncObjectId) : null,
            direction: syncDirection,
            status: syncStatus,
            error_message: syncErrorMessage,
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not create sync event.");
        return;
      }
      const created = payload.data as AccountingSyncEventRecord;
      setSyncEvents((current) => [created, ...current]);
      if (created.status === "failed") {
        setRetryTargetId(String(created.id));
      }
      setSyncErrorMessage("");
      setStatusMessage(`Created sync event #${created.id}.`);
    } catch {
      setStatusMessage("Could not reach sync event create endpoint.");
    }
  }

  async function retryAccountingSyncEvent() {
    const syncEventId = Number(retryTargetId);
    if (!syncEventId) {
      setStatusMessage("Select a failed sync event to retry.");
      return;
    }
    setStatusMessage("Retrying sync event...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/accounting-sync-events/${syncEventId}/retry/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not retry sync event.");
        return;
      }
      const updated = payload.data as AccountingSyncEventRecord;
      setSyncEvents((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setStatusMessage(`Retry result: ${payload.meta?.retry_status ?? "ok"}.`);
    } catch {
      setStatusMessage("Could not reach sync event retry endpoint.");
    }
  }

  return (
    <section className={styles.console}>
      <p className={styles.authMessage}>{authMessage}</p>

      <label>
        Project
        <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              #{project.id} - {project.name} ({project.customer_display_name})
            </option>
          ))}
        </select>
      </label>

      <section>
        <h3>Audit Trail Export</h3>
        <p>Download the full immutable financial audit trail for the selected project.</p>
        <p>
          <button type="button" onClick={() => void downloadAuditTrail("json")} disabled={!hasSelectedProject}>
            Download Audit Trail (JSON)
          </button>
          <button type="button" onClick={() => void downloadAuditTrail("csv")} disabled={!hasSelectedProject}>
            Download Audit Trail (CSV)
          </button>
          <button type="button" onClick={downloadAccountingExport} disabled={!hasSelectedProject}>
            Download Accounting Export (CSV)
          </button>
        </p>
      </section>

      <section>
        <h3>Accounting Sync Events</h3>
        <p>Track sync status and safely retry failed events.</p>
        <button type="button" onClick={loadAccountingSyncEvents} disabled={!hasSelectedProject}>
          Load Sync Events
        </button>

        <form onSubmit={createAccountingSyncEvent}>
          <label>
            Provider
            <select value={syncProvider} onChange={() => setSyncProvider("quickbooks_online")}>
              <option value="quickbooks_online">quickbooks_online</option>
            </select>
          </label>
          <label>
            Object type
            <input value={syncObjectType} onChange={(event) => setSyncObjectType(event.target.value)} required />
          </label>
          <label>
            Object id
            <input value={syncObjectId} onChange={(event) => setSyncObjectId(event.target.value)} />
          </label>
          <label>
            Direction
            <select value={syncDirection} onChange={(event) => setSyncDirection(event.target.value as "push" | "pull")}>
              <option value="push">push</option>
              <option value="pull">pull</option>
            </select>
          </label>
          <label>
            Status
            <select
              value={syncStatus}
              onChange={(event) => setSyncStatus(event.target.value as "queued" | "success" | "failed")}
            >
              <option value="queued">queued</option>
              <option value="success">success</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label>
            Error message
            <input value={syncErrorMessage} onChange={(event) => setSyncErrorMessage(event.target.value)} />
          </label>
          <button type="submit" disabled={!hasSelectedProject}>
            Create Sync Event
          </button>
        </form>

        {syncEvents.length > 0 ? (
          <label>
            Failed event to retry
            <select value={retryTargetId} onChange={(event) => setRetryTargetId(event.target.value)}>
              <option value="">Select failed event</option>
              {syncEvents
                .filter((item) => item.status === "failed" || item.status === "queued")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.id} {item.object_type} ({item.status}) retries:{item.retry_count}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <button type="button" onClick={retryAccountingSyncEvent} disabled={!retryTargetId}>
          Retry Selected Sync Event
        </button>

        {syncEvents.length > 0 ? (
          <label>
            Sync event log
            <textarea
              readOnly
              rows={Math.min(8, syncEvents.length + 1)}
              value={syncEvents
                .map(
                  (item) =>
                    `#${item.id} ${item.provider} ${item.object_type}:${item.object_id ?? "-"} ${item.direction} ${item.status} retries=${item.retry_count} error="${item.error_message}"`,
                )
                .join("\n")}
            />
          </label>
        ) : null}
      </section>

      {statusMessage ? <p className={styles.statusMessage}>{statusMessage}</p> : null}
    </section>
  );
}
