"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/features/projects/api";
import {
  AccountingSyncEventRecord,
  ApiResponse,
  ChangeImpactSummary,
  FinancialAuditEventRecord,
  PortfolioSnapshot,
  ProjectFinancialSummary,
  ProjectRecord,
} from "@/features/projects/types";
import { formatDateTimeDisplay } from "@/shared/date-format";

export function FinancialsAuditingConsole() {
  const { token, authMessage } = useSharedSessionAuth();
  const [statusMessage, setStatusMessage] = useState("");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [summary, setSummary] = useState<ProjectFinancialSummary | null>(null);
  const [auditEvents, setAuditEvents] = useState<FinancialAuditEventRecord[]>([]);
  const [syncEvents, setSyncEvents] = useState<AccountingSyncEventRecord[]>([]);
  const [syncProvider, setSyncProvider] = useState<"quickbooks_online">("quickbooks_online");
  const [syncObjectType, setSyncObjectType] = useState("invoice");
  const [syncObjectId, setSyncObjectId] = useState("");
  const [syncDirection, setSyncDirection] = useState<"push" | "pull">("push");
  const [syncStatus, setSyncStatus] = useState<"queued" | "success" | "failed">("queued");
  const [syncErrorMessage, setSyncErrorMessage] = useState("");
  const [retryTargetId, setRetryTargetId] = useState("");
  const [reportDateFrom, setReportDateFrom] = useState("");
  const [reportDateTo, setReportDateTo] = useState("");
  const [portfolioSnapshot, setPortfolioSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [changeImpactSummary, setChangeImpactSummary] = useState<ChangeImpactSummary | null>(null);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const hasSelectedProject = Boolean(selectedProjectId);

  async function loadProjects() {
    if (!token) {
      return;
    }
    setStatusMessage("Loading projects...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: { Authorization: `Token ${token}` },
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
      } else {
        setSelectedProjectId("");
      }
      setStatusMessage(`Loaded ${rows.length} project(s).`);
    } catch {
      setStatusMessage("Could not reach projects endpoint.");
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function loadFinancialSummary() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }
    setStatusMessage("Loading financial summary...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/financial-summary/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Could not load financial summary.");
        return;
      }
      setSummary(payload.data as ProjectFinancialSummary);
      setStatusMessage("Financial summary loaded.");
    } catch {
      setStatusMessage("Could not reach financial summary endpoint.");
    }
  }

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
        {
          headers: { Authorization: `Token ${token}` },
        },
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

  async function loadAuditEvents() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }
    setStatusMessage("Loading audit events...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/audit-events/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load audit events.");
        return;
      }
      const rows = (payload.data as FinancialAuditEventRecord[]) ?? [];
      setAuditEvents(rows);
      setStatusMessage(`Loaded ${rows.length} audit event(s).`);
    } catch {
      setStatusMessage("Could not reach project audit events endpoint.");
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
        {
          headers: { Authorization: `Token ${token}` },
        },
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
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${token}`,
          },
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
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

  async function loadPortfolioSnapshot() {
    setStatusMessage("Loading portfolio snapshot...");
    try {
      const params = new URLSearchParams();
      if (reportDateFrom) {
        params.set("date_from", reportDateFrom);
      }
      if (reportDateTo) {
        params.set("date_to", reportDateTo);
      }
      const response = await fetch(
        `${normalizedBaseUrl}/reports/portfolio/${params.toString() ? `?${params.toString()}` : ""}`,
        {
          headers: { Authorization: `Token ${token}` },
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load portfolio snapshot.");
        return;
      }
      setPortfolioSnapshot(payload.data as PortfolioSnapshot);
      setStatusMessage("Portfolio snapshot loaded.");
    } catch {
      setStatusMessage("Could not reach portfolio snapshot endpoint.");
    }
  }

  async function loadChangeImpactSummary() {
    setStatusMessage("Loading change impact summary...");
    try {
      const params = new URLSearchParams();
      if (reportDateFrom) {
        params.set("date_from", reportDateFrom);
      }
      if (reportDateTo) {
        params.set("date_to", reportDateTo);
      }
      const response = await fetch(
        `${normalizedBaseUrl}/reports/change-impact/${params.toString() ? `?${params.toString()}` : ""}`,
        {
          headers: { Authorization: `Token ${token}` },
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load change impact summary.");
        return;
      }
      setChangeImpactSummary(payload.data as ChangeImpactSummary);
      setStatusMessage("Change impact summary loaded.");
    } catch {
      setStatusMessage("Could not reach change impact summary endpoint.");
    }
  }

  return (
    <section>
      <p>{authMessage}</p>
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
        <h3>Financial Summary (FIN-01)</h3>
        <p>One-screen view for contract, AR, and AP totals on this project.</p>
        <button type="button" onClick={loadFinancialSummary} disabled={!hasSelectedProject}>
          Load Financial Summary
        </button>
        <button type="button" onClick={downloadAccountingExport} disabled={!hasSelectedProject}>
          Download Accounting Export (CSV)
        </button>

        {summary ? (
          <div>
            <p>
              Contract: eyeball/initial {summary.contract_value_original} | accepted total{" "}
              {summary.contract_value_current}
            </p>
            <p>Approved CO total: {summary.approved_change_orders_total}</p>
            <p>
              AR: invoiced {summary.invoiced_to_date} | paid {summary.paid_to_date} | outstanding{" "}
              {summary.ar_outstanding}
            </p>
            <p>
              AP: total {summary.ap_total} | paid {summary.ap_paid} | outstanding{" "}
              {summary.ap_outstanding}
            </p>
            <p>
              Unapplied credit: inbound {summary.inbound_unapplied_credit} | outbound{" "}
              {summary.outbound_unapplied_credit}
            </p>
            <h4>Traceability Links (FIN-02)</h4>
            <p>
              <Link href={summary.traceability.approved_change_orders.ui_route}>Change orders</Link> |{" "}
              <Link href={summary.traceability.ar_invoices.ui_route}>Invoices</Link> |{" "}
              <Link href={summary.traceability.ar_payments.ui_route}>Payments (AR)</Link> |{" "}
              <Link href={summary.traceability.ap_vendor_bills.ui_route}>Vendor bills</Link> |{" "}
              <Link href={summary.traceability.ap_payments.ui_route}>Payments (AP)</Link>
            </p>
            <label>
              AR invoice sources
              <textarea
                readOnly
                rows={Math.min(6, summary.traceability.ar_invoices.records.length + 1)}
                value={summary.traceability.ar_invoices.records
                  .map((row) => `${row.label} (${row.status}) amount ${row.amount} | ${row.detail_endpoint}`)
                  .join("\n")}
              />
            </label>
            <label>
              AR payment allocation sources
              <textarea
                readOnly
                rows={Math.min(6, summary.traceability.ar_payments.records.length + 1)}
                value={summary.traceability.ar_payments.records
                  .map((row) => `${row.label} (${row.status}) amount ${row.amount} | ${row.detail_endpoint}`)
                  .join("\n")}
              />
            </label>
            <label>
              AP vendor bill sources
              <textarea
                readOnly
                rows={Math.min(6, summary.traceability.ap_vendor_bills.records.length + 1)}
                value={summary.traceability.ap_vendor_bills.records
                  .map((row) => `${row.label} (${row.status}) amount ${row.amount} | ${row.detail_endpoint}`)
                  .join("\n")}
              />
            </label>
            <label>
              AP payment allocation sources
              <textarea
                readOnly
                rows={Math.min(6, summary.traceability.ap_payments.records.length + 1)}
                value={summary.traceability.ap_payments.records
                  .map((row) => `${row.label} (${row.status}) amount ${row.amount} | ${row.detail_endpoint}`)
                  .join("\n")}
              />
            </label>
          </div>
        ) : null}
      </section>

      <section>
        <h3>Reporting Pack v1</h3>
        <p>Portfolio snapshot + approved change impact rollup.</p>
        <label>
          Date from
          <input
            type="date"
            value={reportDateFrom}
            onChange={(event) => setReportDateFrom(event.target.value)}
          />
        </label>
        <label>
          Date to
          <input
            type="date"
            value={reportDateTo}
            onChange={(event) => setReportDateTo(event.target.value)}
          />
        </label>
        <p>
          <button type="button" onClick={loadPortfolioSnapshot}>
            Load Portfolio Snapshot
          </button>
          <button type="button" onClick={loadChangeImpactSummary}>
            Load Change Impact Summary
          </button>
        </p>

        {portfolioSnapshot ? (
          <div>
            <p>
              Active projects: {portfolioSnapshot.active_projects_count} | AR outstanding{" "}
              {portfolioSnapshot.ar_total_outstanding} | AP outstanding{" "}
              {portfolioSnapshot.ap_total_outstanding}
            </p>
            <p>
              Overdue invoices: {portfolioSnapshot.overdue_invoice_count} | Overdue vendor bills:{" "}
              {portfolioSnapshot.overdue_vendor_bill_count}
            </p>
          </div>
        ) : null}

        {changeImpactSummary ? (
          <div>
            <p>
              Approved CO count: {changeImpactSummary.approved_change_order_count} | Approved CO total:{" "}
              {changeImpactSummary.approved_change_order_total}
            </p>
            <label>
              Change impact by project
              <textarea
                readOnly
                rows={Math.min(8, changeImpactSummary.projects.length + 1)}
                value={changeImpactSummary.projects
                  .map(
                    (row) =>
                      `${row.project_name} (#${row.project_id}) | count ${row.approved_change_order_count} | total ${row.approved_change_order_total}`,
                  )
                  .join("\n")}
              />
            </label>
          </div>
        ) : null}
      </section>

      <section>
        <h3>Financial Audit Trail (QA-01)</h3>
        <p>Immutable event log for money-impacting transitions.</p>
        <button type="button" onClick={loadAuditEvents} disabled={!hasSelectedProject}>
          Load Audit Events
        </button>
        {auditEvents.length > 0 ? (
          <label>
            Audit event log
            <textarea
              readOnly
              rows={Math.min(10, auditEvents.length + 1)}
              value={auditEvents
                .map((item) => {
                  const amount = item.amount ? ` amount=${item.amount}` : "";
                  const transition =
                    item.from_status || item.to_status
                      ? ` ${item.from_status || "-"} -> ${item.to_status || "-"}`
                      : "";
                  return `#${item.id} ${item.event_type} ${item.object_type}:${item.object_id}${transition}${amount} at ${formatDateTimeDisplay(item.created_at, item.created_at)}`;
                })
                .join("\n")}
            />
          </label>
        ) : null}
      </section>

      <section>
        <h3>Accounting Sync Events (ACC-02)</h3>
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

      <p>{statusMessage}</p>
    </section>
  );
}
