"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { hasAnyRole } from "../../session/rbac";
import { ApiResponse, CostCode, InvoiceLineInput, InvoiceRecord, ProjectRecord } from "../types";
import { CostCodeCombobox } from "@/shared/components/cost-code-combobox";
import styles from "./invoices-console.module.css";

type StatusTone = "neutral" | "success" | "error";

const INVOICE_STATUSES = ["draft", "sent", "partially_paid", "paid", "overdue", "void"] as const;

const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function dueDateIsoDate(daysFromNow = 30) {
  const current = new Date();
  current.setDate(current.getDate() + daysFromNow);
  return current.toISOString().slice(0, 10);
}

function parseAmount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function emptyLine(localId: number, defaultCostCodeId = ""): InvoiceLineInput {
  return {
    localId,
    costCodeId: defaultCostCodeId,
    description: "Invoice scope item",
    quantity: "1",
    unit: "ea",
    unitPrice: "0",
  };
}

function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABELS[status] ?? status;
}

function invoiceNextActionHint(status: string): string {
  if (status === "draft") {
    return "Next: send the invoice to move it into billable AR tracking.";
  }
  if (status === "sent") {
    return "Next: record payments to move invoice to partially paid or paid.";
  }
  if (status === "partially_paid") {
    return "Next: allocate remaining payment and close the outstanding balance.";
  }
  if (status === "overdue") {
    return "Next: follow up with customer and record payment once received.";
  }
  if (status === "paid") {
    return "Invoice is fully settled.";
  }
  if (status === "void") {
    return "Invoice is void and no longer billable.";
  }
  return "Select a status transition as needed.";
}

function invoiceStatusClass(status: string): string {
  if (status === "draft") {
    return styles.statusDraft;
  }
  if (status === "sent") {
    return styles.statusSent;
  }
  if (status === "partially_paid") {
    return styles.statusPartial;
  }
  if (status === "paid") {
    return styles.statusPaid;
  }
  if (status === "overdue") {
    return styles.statusOverdue;
  }
  if (status === "void") {
    return styles.statusVoid;
  }
  return "";
}

function readApiError(payload: ApiResponse | undefined, fallback: string): string {
  const message = payload?.error?.message?.trim();
  return message || fallback;
}

export function InvoicesConsole() {
  const { token, authMessage, role } = useSharedSessionAuth();
  const canMutateInvoices = hasAnyRole(role, ["owner", "pm", "bookkeeping"]);

  const searchParams = useSearchParams();
  const scopedProjectIdParam = searchParams.get("project");
  const scopedProjectId =
    scopedProjectIdParam && /^\d+$/.test(scopedProjectIdParam) ? Number(scopedProjectIdParam) : null;

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);

  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("draft");
  const [scopeOverride, setScopeOverride] = useState(false);
  const [scopeOverrideNote, setScopeOverrideNote] = useState("");

  const [issueDate, setIssueDate] = useState(todayIsoDate());
  const [dueDate, setDueDate] = useState(dueDateIsoDate());
  const [taxPercent, setTaxPercent] = useState("0");
  const [lineItems, setLineItems] = useState<InvoiceLineInput[]>([emptyLine(1)]);
  const [nextLineId, setNextLineId] = useState(2);

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => String(invoice.id) === selectedInvoiceId) ?? null,
    [invoices, selectedInvoiceId],
  );

  const invoiceCounts = useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const row of invoices) {
      byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
    }
    return {
      total: invoices.length,
      draft: byStatus.get("draft") ?? 0,
      sent: byStatus.get("sent") ?? 0,
      overdue: byStatus.get("overdue") ?? 0,
      paid: byStatus.get("paid") ?? 0,
    };
  }, [invoices]);

  const balanceSummary = useMemo(() => {
    return invoices.reduce(
      (acc, row) => {
        acc.total += parseAmount(row.total);
        acc.balanceDue += parseAmount(row.balance_due);
        return acc;
      },
      { total: 0, balanceDue: 0 },
    );
  }, [invoices]);

  const draftLineSubtotal = useMemo(() => {
    return lineItems.reduce((sum, line) => sum + parseAmount(line.quantity) * parseAmount(line.unitPrice), 0);
  }, [lineItems]);

  const draftTaxTotal = useMemo(() => {
    return draftLineSubtotal * (parseAmount(taxPercent) / 100);
  }, [draftLineSubtotal, taxPercent]);

  const draftTotal = useMemo(() => draftLineSubtotal + draftTaxTotal, [draftLineSubtotal, draftTaxTotal]);

  const setNeutralStatus = useCallback((message: string) => {
    setStatusTone("neutral");
    setStatusMessage(message);
  }, []);

  const setSuccessStatus = useCallback((message: string) => {
    setStatusTone("success");
    setStatusMessage(message);
  }, []);

  const setErrorStatus = useCallback((message: string) => {
    setStatusTone("error");
    setStatusMessage(message);
  }, []);

  const loadDependencies = useCallback(
    async (options?: { keepStatusOnSuccess?: boolean }) => {
      if (!token) {
        return;
      }

      setNeutralStatus("Loading projects and cost codes...");
      try {
        const [projectsRes, codesRes] = await Promise.all([
          fetch(`${normalizedBaseUrl}/projects/`, { headers: buildAuthHeaders(token) }),
          fetch(`${normalizedBaseUrl}/cost-codes/`, { headers: buildAuthHeaders(token) }),
        ]);
        const projectsPayload: ApiResponse = await projectsRes.json();
        const codesPayload: ApiResponse = await codesRes.json();

        if (!projectsRes.ok || !codesRes.ok) {
          setErrorStatus("Failed loading dependencies.");
          return;
        }

        const projectRows = (projectsPayload.data as ProjectRecord[]) ?? [];
        const codeRows = (codesPayload.data as CostCode[]) ?? [];

        setProjects(projectRows);
        setCostCodes(codeRows);

        setSelectedProjectId((current) => {
          if (current && projectRows.some((row) => String(row.id) === current)) {
            return current;
          }
          if (scopedProjectId) {
            const scoped = projectRows.find((row) => row.id === scopedProjectId);
            if (scoped) {
              return String(scoped.id);
            }
          }
          return projectRows[0] ? String(projectRows[0].id) : "";
        });

        const defaultCostCodeId = codeRows[0] ? String(codeRows[0].id) : "";
        setLineItems((current) =>
          current.map((line) => (line.costCodeId ? line : { ...line, costCodeId: defaultCostCodeId })),
        );

        if (!options?.keepStatusOnSuccess) {
          setStatusMessage("");
        }
      } catch {
        setErrorStatus("Could not reach dependency endpoints.");
      }
    },
    [normalizedBaseUrl, scopedProjectId, setErrorStatus, setNeutralStatus, token],
  );

  const loadInvoices = useCallback(
    async (projectIdArg?: number) => {
      const resolvedProjectId = projectIdArg ?? Number(selectedProjectId);
      if (!token || !resolvedProjectId) {
        return;
      }

      setNeutralStatus("Loading invoices...");
      try {
        const response = await fetch(`${normalizedBaseUrl}/projects/${resolvedProjectId}/invoices/`, {
          headers: buildAuthHeaders(token),
        });
        const payload: ApiResponse = await response.json();

        if (!response.ok) {
          setErrorStatus(readApiError(payload, "Failed loading invoices."));
          return;
        }

        const rows = (payload.data as InvoiceRecord[]) ?? [];
        setInvoices(rows);

        setSelectedInvoiceId((current) => {
          if (current && rows.some((row) => String(row.id) === current)) {
            return current;
          }
          return rows[0] ? String(rows[0].id) : "";
        });
        setStatusMessage("");
      } catch {
        setErrorStatus("Could not reach invoice endpoint.");
      }
    },
    [normalizedBaseUrl, selectedProjectId, setErrorStatus, setNeutralStatus, token],
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadDependencies();
  }, [loadDependencies, token]);

  useEffect(() => {
    const projectId = Number(selectedProjectId);
    if (!token || !projectId) {
      setInvoices([]);
      setSelectedInvoiceId("");
      return;
    }
    void loadInvoices(projectId);
  }, [loadInvoices, selectedProjectId, token]);

  useEffect(() => {
    if (!selectedInvoice) {
      setSelectedStatus("draft");
      return;
    }
    setSelectedStatus(selectedInvoice.status);
  }, [selectedInvoice]);

  function addLineItem() {
    const defaultCostCodeId = costCodes[0] ? String(costCodes[0].id) : "";
    setLineItems((current) => [...current, emptyLine(nextLineId, defaultCostCodeId)]);
    setNextLineId((value) => value + 1);
  }

  function removeLineItem(localId: number) {
    setLineItems((current) => {
      if (current.length <= 1) {
        return current;
      }
      return current.filter((line) => line.localId !== localId);
    });
  }

  function updateLineItem(localId: number, key: keyof Omit<InvoiceLineInput, "localId">, value: string) {
    setLineItems((current) =>
      current.map((line) => (line.localId === localId ? { ...line, [key]: value } : line)),
    );
  }

  function resetCreateDraft() {
    const defaultCostCodeId = costCodes[0] ? String(costCodes[0].id) : "";
    setIssueDate(todayIsoDate());
    setDueDate(dueDateIsoDate());
    setTaxPercent("0");
    setLineItems([emptyLine(1, defaultCostCodeId)]);
    setNextLineId(2);
  }

  async function handleCreateInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateInvoices) {
      setErrorStatus(`Role ${role} is read-only for invoice mutations.`);
      return;
    }

    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setErrorStatus("Select a project first.");
      return;
    }

    setNeutralStatus("Creating invoice...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/invoices/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          issue_date: issueDate,
          due_date: dueDate,
          tax_percent: taxPercent,
          line_items: lineItems.map((line) => ({
            cost_code: line.costCodeId ? Number(line.costCodeId) : null,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unit_price: line.unitPrice,
          })),
        }),
      });
      const payload: ApiResponse = await response.json();

      if (!response.ok) {
        setErrorStatus(readApiError(payload, "Create invoice failed."));
        return;
      }

      const created = payload.data as InvoiceRecord;
      await loadInvoices(projectId);
      setSelectedInvoiceId(String(created.id));
      setSelectedStatus(created.status);
      resetCreateDraft();
      setSuccessStatus(`Created ${created.invoice_number} (${invoiceStatusLabel(created.status)}).`);
    } catch {
      setErrorStatus("Could not reach invoice create endpoint.");
    }
  }

  async function handleUpdateInvoiceStatus() {
    if (!canMutateInvoices) {
      setErrorStatus(`Role ${role} is read-only for invoice mutations.`);
      return;
    }

    const invoiceId = Number(selectedInvoiceId);
    if (!invoiceId) {
      setErrorStatus("Select an invoice first.");
      return;
    }

    setNeutralStatus("Updating invoice status...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/invoices/${invoiceId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          status: selectedStatus,
          scope_override: scopeOverride,
          scope_override_note: scopeOverrideNote,
        }),
      });
      const payload: ApiResponse = await response.json();

      if (!response.ok) {
        setErrorStatus(readApiError(payload, "Status update failed."));
        return;
      }

      const updated = payload.data as InvoiceRecord;
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelectedStatus(updated.status);
      setSuccessStatus(`Updated ${updated.invoice_number} to ${invoiceStatusLabel(updated.status)}.`);
    } catch {
      setErrorStatus("Could not reach invoice status endpoint.");
    }
  }

  async function handleSendInvoice() {
    if (!canMutateInvoices) {
      setErrorStatus(`Role ${role} is read-only for invoice mutations.`);
      return;
    }

    const invoiceId = Number(selectedInvoiceId);
    if (!invoiceId) {
      setErrorStatus("Select an invoice first.");
      return;
    }

    setNeutralStatus("Sending invoice...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/invoices/${invoiceId}/send/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          scope_override: scopeOverride,
          scope_override_note: scopeOverrideNote,
        }),
      });
      const payload: ApiResponse = await response.json();

      if (!response.ok) {
        setErrorStatus(readApiError(payload, "Send invoice failed."));
        return;
      }

      const updated = payload.data as InvoiceRecord;
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelectedStatus(updated.status);
      setSuccessStatus(`Sent ${updated.invoice_number}.`);
    } catch {
      setErrorStatus("Could not reach invoice send endpoint.");
    }
  }

  async function handleQuickInvoiceStatus(status: string) {
    if (!canMutateInvoices) {
      setErrorStatus(`Role ${role} is read-only for invoice mutations.`);
      return;
    }

    const invoiceId = Number(selectedInvoiceId);
    if (!invoiceId) {
      setErrorStatus("Select an invoice first.");
      return;
    }

    setNeutralStatus(`Updating invoice to ${invoiceStatusLabel(status)}...`);
    try {
      const response = await fetch(`${normalizedBaseUrl}/invoices/${invoiceId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          status,
          scope_override: scopeOverride,
          scope_override_note: scopeOverrideNote,
        }),
      });
      const payload: ApiResponse = await response.json();

      if (!response.ok) {
        setErrorStatus(readApiError(payload, "Quick status update failed."));
        return;
      }

      const updated = payload.data as InvoiceRecord;
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelectedStatus(updated.status);
      setSuccessStatus(`Updated ${updated.invoice_number} to ${invoiceStatusLabel(updated.status)}.`);
    } catch {
      setErrorStatus("Could not reach invoice quick status endpoint.");
    }
  }

  const selectedProject = projects.find((project) => String(project.id) === selectedProjectId) ?? null;

  return (
    <section className={styles.console}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Billing</p>
          <h2 className={styles.heading}>Invoice Workspace</h2>
          <p className={styles.copy}>
            Draft invoice scope, send AR requests, and keep payment readiness visible per project.
          </p>
        </div>
        <div className={styles.statsGrid}>
          <article className={styles.statCard}>
            <span>Total invoices</span>
            <strong>{invoiceCounts.total}</strong>
          </article>
          <article className={styles.statCard}>
            <span>Awaiting action</span>
            <strong>{invoiceCounts.draft + invoiceCounts.sent + invoiceCounts.overdue}</strong>
          </article>
          <article className={styles.statCard}>
            <span>Total invoiced</span>
            <strong>${formatMoney(balanceSummary.total)}</strong>
          </article>
          <article className={styles.statCard}>
            <span>Balance due</span>
            <strong>${formatMoney(balanceSummary.balanceDue)}</strong>
          </article>
        </div>
      </header>

      {!token ? <p className={styles.authNotice}>{authMessage}</p> : null}

      {statusMessage ? (
        <p
          className={`${styles.statusBanner} ${
            statusTone === "success"
              ? styles.statusSuccess
              : statusTone === "error"
                ? styles.statusError
                : ""
          }`}
        >
          {statusMessage}
        </p>
      ) : null}

      {token ? (
        <>
          {!canMutateInvoices ? (
            <p className={styles.readOnlyNotice}>Role `{role}` can view invoices but cannot create, update, or send.</p>
          ) : null}

          <section className={styles.controlBar}>
            <label className={styles.controlField}>
              <span>Project</span>
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
              >
                {projects.length ? (
                  projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      #{project.id} - {project.name} ({project.customer_display_name})
                    </option>
                  ))
                ) : (
                  <option value="">No projects loaded</option>
                )}
              </select>
            </label>

            <div className={styles.controlActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => void loadDependencies()}>
                Reload Dependencies
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void loadInvoices()}
                disabled={!selectedProjectId}
              >
                Reload Invoices
              </button>
            </div>
          </section>

          <div className={styles.layout}>
            <aside className={styles.panel}>
              <div className={styles.panelHeader}>
                <h3>Project Invoices</h3>
                <span className={styles.countBadge}>{invoices.length}</span>
              </div>

              {selectedProject ? (
                <p className={styles.inlineHint}>
                  {selectedProject.name} · {selectedProject.customer_display_name}
                </p>
              ) : null}

              <div className={styles.invoiceRail}>
                {invoices.length ? (
                  invoices.map((invoice) => {
                    const isSelected = String(invoice.id) === selectedInvoiceId;
                    return (
                      <button
                        key={invoice.id}
                        type="button"
                        className={`${styles.invoiceCard} ${isSelected ? styles.invoiceCardSelected : ""}`}
                        onClick={() => {
                          setSelectedInvoiceId(String(invoice.id));
                          setSelectedStatus(invoice.status);
                        }}
                      >
                        <div className={styles.invoiceCardRow}>
                          <strong>{invoice.invoice_number}</strong>
                          <span className={`${styles.statusBadge} ${invoiceStatusClass(invoice.status)}`}>
                            {invoiceStatusLabel(invoice.status)}
                          </span>
                        </div>
                        <div className={styles.invoiceMetaGrid}>
                          <span>Total ${invoice.total}</span>
                          <span>Due ${invoice.balance_due}</span>
                          <span>Issue {invoice.issue_date}</span>
                          <span>Due {invoice.due_date}</span>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <p className={styles.emptyState}>No invoices yet for this project.</p>
                )}
              </div>
            </aside>

            <div className={styles.workspace}>
              <form className={styles.panel} onSubmit={handleCreateInvoice}>
                <div className={styles.panelHeader}>
                  <h3>Create Invoice</h3>
                  <span className={styles.countBadge}>Draft</span>
                </div>

                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span>Issue date</span>
                    <input
                      type="date"
                      value={issueDate}
                      onChange={(event) => setIssueDate(event.target.value)}
                      required
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Due date</span>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                      required
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Tax percent</span>
                    <input
                      value={taxPercent}
                      onChange={(event) => setTaxPercent(event.target.value)}
                      inputMode="decimal"
                      required
                    />
                  </label>
                </div>

                <div className={styles.lineSection}>
                  <div className={styles.lineHeaderRow}>
                    <h4>Line Items</h4>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={addLineItem}
                      disabled={!canMutateInvoices}
                    >
                      Add Line
                    </button>
                  </div>

                  <div className={styles.lineList}>
                    {lineItems.map((line, index) => (
                      <article key={line.localId} className={styles.lineCard}>
                        <div className={styles.lineTopRow}>
                          <strong>Line {index + 1}</strong>
                          <button
                            type="button"
                            className={styles.ghostDangerButton}
                            onClick={() => removeLineItem(line.localId)}
                            disabled={lineItems.length <= 1}
                          >
                            Remove
                          </button>
                        </div>

                        <label className={styles.field}>
                          <span>Cost code</span>
                          <CostCodeCombobox
                            costCodes={costCodes}
                            value={line.costCodeId}
                            onChange={(nextValue) => updateLineItem(line.localId, "costCodeId", nextValue)}
                            ariaLabel="Cost code"
                            allowEmptySelection
                            emptySelectionLabel="No cost code"
                            placeholder="Search cost code"
                          />
                        </label>

                        <div className={styles.lineGrid}>
                          <label className={`${styles.field} ${styles.lineDescription}`}>
                            <span>Description</span>
                            <input
                              value={line.description}
                              onChange={(event) =>
                                updateLineItem(line.localId, "description", event.target.value)
                              }
                              required
                            />
                          </label>
                          <label className={styles.field}>
                            <span>Quantity</span>
                            <input
                              value={line.quantity}
                              onChange={(event) =>
                                updateLineItem(line.localId, "quantity", event.target.value)
                              }
                              inputMode="decimal"
                              required
                            />
                          </label>
                          <label className={styles.field}>
                            <span>Unit</span>
                            <input
                              value={line.unit}
                              onChange={(event) => updateLineItem(line.localId, "unit", event.target.value)}
                              required
                            />
                          </label>
                          <label className={styles.field}>
                            <span>Unit price</span>
                            <input
                              value={line.unitPrice}
                              onChange={(event) =>
                                updateLineItem(line.localId, "unitPrice", event.target.value)
                              }
                              inputMode="decimal"
                              required
                            />
                          </label>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>

                <div className={styles.formFooter}>
                  <div className={styles.summaryCard}>
                    <div>
                      <span>Subtotal</span>
                      <strong>${formatMoney(draftLineSubtotal)}</strong>
                    </div>
                    <div>
                      <span>Tax</span>
                      <strong>${formatMoney(draftTaxTotal)}</strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>${formatMoney(draftTotal)}</strong>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className={styles.primaryButton}
                    disabled={!selectedProjectId || !canMutateInvoices}
                  >
                    Create Invoice
                  </button>
                </div>
              </form>

              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h3>Status & Send</h3>
                  <span className={styles.countBadge}>
                    {selectedInvoice ? selectedInvoice.invoice_number : "No selection"}
                  </span>
                </div>

                {selectedInvoice ? (
                  <>
                    <div className={styles.selectedInvoiceSummary}>
                      <span className={`${styles.statusBadge} ${invoiceStatusClass(selectedInvoice.status)}`}>
                        {invoiceStatusLabel(selectedInvoice.status)}
                      </span>
                      <p>{invoiceNextActionHint(selectedInvoice.status)}</p>
                    </div>

                    <div className={styles.formGrid}>
                      <label className={styles.field}>
                        <span>Next status</span>
                        <select
                          value={selectedStatus}
                          onChange={(event) => setSelectedStatus(event.target.value)}
                        >
                          {INVOICE_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {invoiceStatusLabel(status)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className={styles.toggleRow}>
                      <input
                        type="checkbox"
                        checked={scopeOverride}
                        onChange={(event) => setScopeOverride(event.target.checked)}
                      />
                      <span>Allow unapproved scope billing</span>
                    </label>

                    {scopeOverride ? (
                      <label className={styles.field}>
                        <span>Override audit note</span>
                        <textarea
                          value={scopeOverrideNote}
                          onChange={(event) => setScopeOverrideNote(event.target.value)}
                          placeholder="Required when override is enabled and invoice exceeds approved scope."
                        />
                      </label>
                    ) : null}

                    <div className={styles.buttonRow}>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={handleUpdateInvoiceStatus}
                        disabled={!canMutateInvoices}
                      >
                        Save Status
                      </button>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={handleSendInvoice}
                        disabled={!canMutateInvoices}
                      >
                        Send Invoice
                      </button>
                    </div>

                    <div className={styles.quickStatusRow}>
                      {INVOICE_STATUSES.map((status) => {
                        const isActive = selectedStatus === status;
                        return (
                          <button
                            key={status}
                            type="button"
                            className={`${styles.quickStatusButton} ${invoiceStatusClass(status)} ${
                              isActive ? styles.quickStatusButtonActive : ""
                            }`}
                            onClick={() => void handleQuickInvoiceStatus(status)}
                            disabled={!canMutateInvoices}
                          >
                            {invoiceStatusLabel(status)}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className={styles.emptyState}>Select an invoice from the project rail to manage status and send operations.</p>
                )}
              </section>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
