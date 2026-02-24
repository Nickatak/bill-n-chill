"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { hasAnyRole } from "../../session/rbac";
import { ApiResponse, CostCode, InvoiceLineInput, InvoiceRecord, ProjectRecord } from "../types";
import { CostCodeCombobox } from "@/shared/components/cost-code-combobox";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function dueDateIsoDate(daysFromNow = 30) {
  const current = new Date();
  current.setDate(current.getDate() + daysFromNow);
  return current.toISOString().slice(0, 10);
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

export function InvoicesConsole() {
  const { token, authMessage, role } = useSharedSessionAuth();
  const [statusMessage, setStatusMessage] = useState("");

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

  const searchParams = useSearchParams();
  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const canMutateInvoices = hasAnyRole(role, ["owner", "pm", "bookkeeping"]);
  const scopedProjectIdParam = searchParams.get("project");
  const scopedProjectId =
    scopedProjectIdParam && /^\d+$/.test(scopedProjectIdParam) ? Number(scopedProjectIdParam) : null;
  async function loadDependencies() {
    setStatusMessage("Loading projects and cost codes...");
    try {
      const [projectsRes, codesRes] = await Promise.all([
        fetch(`${normalizedBaseUrl}/projects/`, {
          headers: buildAuthHeaders(token),
        }),
        fetch(`${normalizedBaseUrl}/cost-codes/`, {
          headers: buildAuthHeaders(token),
        }),
      ]);
      const projectsJson: ApiResponse = await projectsRes.json();
      const codesJson: ApiResponse = await codesRes.json();

      if (!projectsRes.ok || !codesRes.ok) {
        setStatusMessage("Failed loading dependencies.");
        return;
      }

      const projectRows = (projectsJson.data as ProjectRecord[]) ?? [];
      const codeRows = (codesJson.data as CostCode[]) ?? [];
      setProjects(projectRows);
      setCostCodes(codeRows);

      if (projectRows[0]) {
        const scopedProject = scopedProjectId
          ? projectRows.find((project) => project.id === scopedProjectId)
          : null;
        setSelectedProjectId(String((scopedProject ?? projectRows[0]).id));
      }
      if (codeRows[0]) {
        const defaultCostCodeId = String(codeRows[0].id);
        setLineItems((current) =>
          current.map((line) =>
            line.costCodeId ? line : { ...line, costCodeId: defaultCostCodeId },
          ),
        );
      }
      setStatusMessage(
        `Loaded ${projectRows.length} project(s) and ${codeRows.length} cost code(s).`,
      );
    } catch {
      setStatusMessage("Could not reach dependency endpoints.");
    }
  }

  async function loadInvoices() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading invoices...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/invoices/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Failed loading invoices.");
        return;
      }
      const rows = (payload.data as InvoiceRecord[]) ?? [];
      setInvoices(rows);
      if (rows[0]) {
        setSelectedInvoiceId(String(rows[0].id));
        setSelectedStatus(rows[0].status);
      }
      setStatusMessage(`Loaded ${rows.length} invoice(s).`);
    } catch {
      setStatusMessage("Could not reach invoice endpoint.");
    }
  }

  function addLineItem() {
    const defaultCostCodeId = costCodes[0] ? String(costCodes[0].id) : "";
    setLineItems((current) => [...current, emptyLine(nextLineId, defaultCostCodeId)]);
    setNextLineId((value) => value + 1);
  }

  function removeLineItem(localId: number) {
    setLineItems((current) => {
      if (current.length <= 1) return current;
      return current.filter((line) => line.localId !== localId);
    });
  }

  function updateLineItem(localId: number, key: keyof Omit<InvoiceLineInput, "localId">, value: string) {
    setLineItems((current) =>
      current.map((line) => (line.localId === localId ? { ...line, [key]: value } : line)),
    );
  }

  async function handleCreateInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateInvoices) {
      setStatusMessage(`Role ${role} is read-only for invoice mutations.`);
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Creating invoice...");
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
        setStatusMessage(payload.error?.message ?? "Create invoice failed.");
        return;
      }
      const created = payload.data as InvoiceRecord;
      setInvoices((current) => [created, ...current]);
      setSelectedInvoiceId(String(created.id));
      setSelectedStatus(created.status);
      setStatusMessage(`Created invoice ${created.invoice_number}.`);
    } catch {
      setStatusMessage("Could not reach invoice create endpoint.");
    }
  }

  async function handleUpdateInvoiceStatus() {
    if (!canMutateInvoices) {
      setStatusMessage(`Role ${role} is read-only for invoice mutations.`);
      return;
    }
    const invoiceId = Number(selectedInvoiceId);
    if (!invoiceId) {
      setStatusMessage("Select an invoice first.");
      return;
    }

    setStatusMessage("Updating invoice status...");
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
        setStatusMessage(payload.error?.message ?? "Status update failed.");
        return;
      }
      const updated = payload.data as InvoiceRecord;
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setStatusMessage(`Updated invoice ${updated.invoice_number} to ${updated.status}.`);
    } catch {
      setStatusMessage("Could not reach invoice status endpoint.");
    }
  }

  async function handleSendInvoice() {
    if (!canMutateInvoices) {
      setStatusMessage(`Role ${role} is read-only for invoice mutations.`);
      return;
    }
    const invoiceId = Number(selectedInvoiceId);
    if (!invoiceId) {
      setStatusMessage("Select an invoice first.");
      return;
    }

    setStatusMessage("Sending invoice...");
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
        setStatusMessage(payload.error?.message ?? "Send invoice failed.");
        return;
      }
      const updated = payload.data as InvoiceRecord;
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelectedStatus(updated.status);
      setStatusMessage(`Sent invoice ${updated.invoice_number}.`);
    } catch {
      setStatusMessage("Could not reach invoice send endpoint.");
    }
  }

  async function handleQuickInvoiceStatus(status: string) {
    if (!canMutateInvoices) {
      setStatusMessage(`Role ${role} is read-only for invoice mutations.`);
      return;
    }
    const invoiceId = Number(selectedInvoiceId);
    if (!invoiceId) {
      setStatusMessage("Select an invoice first.");
      return;
    }

    setStatusMessage(`Updating invoice to ${status}...`);
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
        setStatusMessage(payload.error?.message ?? "Quick status update failed.");
        return;
      }
      const updated = payload.data as InvoiceRecord;
      setInvoices((current) =>
        current.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
      );
      setSelectedStatus(updated.status);
      setStatusMessage(`Updated invoice ${updated.invoice_number} to ${updated.status}.`);
    } catch {
      setStatusMessage("Could not reach invoice quick status endpoint.");
    }
  }

  return (
    <section>
      <h2>Invoice Composition and Send</h2>
      <p>Create invoice lines, calculate totals, and move invoices through lifecycle states.</p>

      <p>{authMessage}</p>
      {!canMutateInvoices ? <p>Role `{role}` can view invoices but cannot create, update, or send.</p> : null}

      <button type="button" onClick={loadDependencies}>
        Load Projects + Cost Codes
      </button>

      {projects.length > 0 ? (
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
      ) : null}

      <form onSubmit={handleCreateInvoice}>
        <h3>Create Invoice</h3>
        <label>
          Issue date
          <input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required />
        </label>
        <label>
          Due date
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
        </label>
        <label>
          Tax %
          <input value={taxPercent} onChange={(event) => setTaxPercent(event.target.value)} inputMode="decimal" required />
        </label>

        <h3>Invoice Line Items</h3>
        {lineItems.map((line, index) => (
          <div key={line.localId}>
            <p>Line {index + 1}</p>
            <label>
              Cost code
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
            <label>
              Description
              <input
                value={line.description}
                onChange={(event) => updateLineItem(line.localId, "description", event.target.value)}
                required
              />
            </label>
            <label>
              Quantity
              <input
                value={line.quantity}
                onChange={(event) => updateLineItem(line.localId, "quantity", event.target.value)}
                inputMode="decimal"
                required
              />
            </label>
            <label>
              Unit
              <input
                value={line.unit}
                onChange={(event) => updateLineItem(line.localId, "unit", event.target.value)}
                required
              />
            </label>
            <label>
              Unit price
              <input
                value={line.unitPrice}
                onChange={(event) => updateLineItem(line.localId, "unitPrice", event.target.value)}
                inputMode="decimal"
                required
              />
            </label>
            <button type="button" onClick={() => removeLineItem(line.localId)}>
              Remove Line
            </button>
          </div>
        ))}

        <button type="button" onClick={addLineItem} disabled={!canMutateInvoices}>
          Add Line Item
        </button>
        <button type="submit" disabled={!selectedProjectId || !canMutateInvoices}>
          Create Invoice
        </button>
      </form>

      <button type="button" onClick={loadInvoices} disabled={!selectedProjectId}>
        Load Invoices for Selected Project
      </button>

      {invoices.length > 0 ? (
        <label>
          Invoice
          <select
            value={selectedInvoiceId}
            onChange={(event) => {
              const nextId = event.target.value;
              setSelectedInvoiceId(nextId);
              const selected = invoices.find((invoice) => String(invoice.id) === nextId);
              if (selected) setSelectedStatus(selected.status);
            }}
          >
            {invoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.invoice_number} ({invoice.status}) - total ${invoice.total} - due ${invoice.balance_due}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>No invoices yet for this project. Create one from line items above.</p>
      )}

      {selectedInvoiceId ? (
        <p>
          Selected invoice hint:{" "}
          {invoiceNextActionHint(
            invoices.find((invoice) => String(invoice.id) === selectedInvoiceId)?.status || selectedStatus,
          )}
        </p>
      ) : null}

      <h3>Invoice Status</h3>
      <label>
        Allow unapproved scope billing
        <input
          type="checkbox"
          checked={scopeOverride}
          onChange={(event) => setScopeOverride(event.target.checked)}
        />
      </label>
      <label>
        Override audit note
        <textarea
          value={scopeOverrideNote}
          onChange={(event) => setScopeOverrideNote(event.target.value)}
          placeholder="Required when override is enabled and invoice exceeds approved scope."
        />
      </label>
      <label>
        Next status
        <select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}>
          <option value="draft">draft</option>
          <option value="sent">sent</option>
          <option value="partially_paid">partially_paid</option>
          <option value="paid">paid</option>
          <option value="overdue">overdue</option>
          <option value="void">void</option>
        </select>
      </label>
      <button
        type="button"
        onClick={handleUpdateInvoiceStatus}
        disabled={!selectedInvoiceId || !canMutateInvoices}
      >
        Update Invoice Status
      </button>
      <button type="button" onClick={handleSendInvoice} disabled={!selectedInvoiceId || !canMutateInvoices}>
        Send Invoice
      </button>
      <p>Mobile quick actions:</p>
      <p>
        <button type="button" onClick={() => handleQuickInvoiceStatus("sent")} disabled={!selectedInvoiceId || !canMutateInvoices}>
          Mark Sent
        </button>
        <button type="button" onClick={() => handleQuickInvoiceStatus("paid")} disabled={!selectedInvoiceId || !canMutateInvoices}>
          Mark Paid
        </button>
        <button type="button" onClick={() => handleQuickInvoiceStatus("void")} disabled={!selectedInvoiceId || !canMutateInvoices}>
          Void
        </button>
      </p>

      <p>{statusMessage}</p>
    </section>
  );
}
