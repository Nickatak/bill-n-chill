/**
 * Document-creator adapter for invoices.
 *
 * Bridges the domain-specific invoice data model to the generic
 * {@link DocumentCreatorAdapter} interface so the shared creator UI can
 * render, create, and update invoices without knowing their schema.
 *
 * Also provides converters for the backend policy contract and status
 * event records into their creator-compatible shapes.
 */

import {
  CreatorLineDraft,
  CreatorMetaField,
  CreatorStatusEvent,
  CreatorStatusPolicy,
  DocumentCreatorAdapter,
} from "@/shared/document-creator/types";
import {
  InvoiceLineInput,
  InvoicePolicyContract,
  InvoiceRecord,
} from "./types";

type InvoiceStatusEvent = {
  id: number | string;
  from_status: string | null;
  to_status: string;
  note?: string;
  actor_email?: string | null;
  created_at: string;
};

type InvoiceFormState = {
  issueDate: string;
  dueDate: string;
  taxPercent: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  lineItems: InvoiceLineInput[];
};

/**
 * Convert the backend policy contract (snake_case) to the creator's
 * status policy shape (camelCase).
 */
export function toInvoiceStatusPolicy(contract: InvoicePolicyContract): CreatorStatusPolicy {
  return {
    statuses: contract.statuses,
    statusLabels: contract.status_labels,
    defaultCreateStatus: contract.default_create_status,
    defaultStatusFilters: contract.default_status_filters,
    allowedTransitions: contract.allowed_status_transitions,
    terminalStatuses: contract.terminal_statuses,
  };
}

/**
 * Convert backend status event records to the creator's status event
 * shape, renaming snake_case fields to camelCase.
 */
export function toInvoiceStatusEvents(events: InvoiceStatusEvent[]): CreatorStatusEvent[] {
  return events.map((event) => ({
    id: event.id,
    fromStatus: event.from_status,
    toStatus: event.to_status,
    note: event.note,
    actorEmail: event.actor_email,
    occurredAt: event.created_at,
  }));
}

/**
 * Build a fully configured document-creator adapter for invoices.
 *
 * The adapter tells the creator how to extract IDs, titles, meta fields,
 * line items, and totals from an invoice, and how to serialize form
 * state back into create/update API payloads.
 */
export function createInvoiceDocumentAdapter(
  statusPolicy: CreatorStatusPolicy,
  statusEvents: InvoiceStatusEvent[],
): DocumentCreatorAdapter<InvoiceRecord, CreatorLineDraft, InvoiceFormState> {
  return {
    kind: "invoice",
    statusPolicy,

    // --- Identity & display ---

    getDocumentId: (document) => (document ? String(document.id) : null),
    getDocumentTitle: (document) => document?.invoice_number ?? "Draft invoice",
    getDocumentStatus: (document) => document?.status ?? statusPolicy.defaultCreateStatus,

    getMetaFields: (document): CreatorMetaField[] => [
      { key: "invoice_no", label: "Invoice #", value: document?.invoice_number ?? "Draft" },
      { key: "issue_date", label: "Issue Date", value: document?.issue_date ?? "Not set" },
      { key: "due_date", label: "Due Date", value: document?.due_date ?? "Not set" },
      { key: "balance_due", label: "Balance Due", value: `$${document?.balance_due ?? "0.00"}` },
    ],

    getStatusEvents: () => toInvoiceStatusEvents(statusEvents),

    // --- Form state → creator lines / totals ---

    getDraftLines: (form) =>
      form.lineItems.map((line) => ({
        localId: line.localId,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
      })),

    getTotals: (form) => ({
      subtotal: form.subtotal,
      taxPercent: Number(form.taxPercent || "0"),
      taxAmount: form.taxAmount,
      total: form.totalAmount,
    }),

    // --- Form state → API payloads ---

    toCreatePayload: (form) => ({
      issue_date: form.issueDate,
      due_date: form.dueDate,
      tax_percent: form.taxPercent,
      line_items: form.lineItems.map((line) => ({
        line_type: line.lineType,
        budget_line: line.budgetLineId ? Number(line.budgetLineId) : null,
        adjustment_reason: line.adjustmentReason,
        internal_note: line.internalNote,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unitPrice,
      })),
    }),

    toUpdatePayload: (form) => ({
      issue_date: form.issueDate,
      due_date: form.dueDate,
      tax_percent: form.taxPercent,
      line_items: form.lineItems.map((line) => ({
        line_type: line.lineType,
        budget_line: line.budgetLineId ? Number(line.budgetLineId) : null,
        adjustment_reason: line.adjustmentReason,
        internal_note: line.internalNote,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unitPrice,
      })),
    }),
  };
}

export type { InvoiceFormState, InvoiceStatusEvent };
