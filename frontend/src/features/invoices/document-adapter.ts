import {
  ComposerLineDraft,
  ComposerMetaField,
  ComposerStatusEvent,
  ComposerStatusPolicy,
  DocumentComposerAdapter,
} from "@/shared/document-composer/types";
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
  senderName: string;
  senderEmail: string;
  senderAddress: string;
  senderLogoUrl: string;
  termsText: string;
  footerText: string;
  notesText: string;
  taxPercent: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  lineItems: InvoiceLineInput[];
};

export function toInvoiceStatusPolicy(contract: InvoicePolicyContract): ComposerStatusPolicy {
  return {
    statuses: contract.statuses,
    statusLabels: contract.status_labels,
    defaultCreateStatus: contract.default_create_status,
    defaultStatusFilters: contract.default_status_filters,
    allowedTransitions: contract.allowed_status_transitions,
    terminalStatuses: contract.terminal_statuses,
  };
}

export function toInvoiceStatusEvents(events: InvoiceStatusEvent[]): ComposerStatusEvent[] {
  return events.map((event) => ({
    id: event.id,
    fromStatus: event.from_status,
    toStatus: event.to_status,
    note: event.note,
    actorEmail: event.actor_email,
    occurredAt: event.created_at,
  }));
}

export function createInvoiceDocumentAdapter(
  statusPolicy: ComposerStatusPolicy,
  statusEvents: InvoiceStatusEvent[],
): DocumentComposerAdapter<InvoiceRecord, ComposerLineDraft, InvoiceFormState> {
  return {
    kind: "invoice",
    statusPolicy,
    getDocumentId: (document) => (document ? String(document.id) : null),
    getDocumentTitle: (document) => document?.invoice_number ?? "Draft invoice",
    getDocumentStatus: (document) => document?.status ?? statusPolicy.defaultCreateStatus,
    getMetaFields: (document): ComposerMetaField[] => [
      { key: "invoice_no", label: "Invoice #", value: document?.invoice_number ?? "Draft" },
      { key: "issue_date", label: "Issue Date", value: document?.issue_date ?? "Not set" },
      { key: "due_date", label: "Due Date", value: document?.due_date ?? "Not set" },
      { key: "balance_due", label: "Balance Due", value: `$${document?.balance_due ?? "0.00"}` },
    ],
    getStatusEvents: () => toInvoiceStatusEvents(statusEvents),
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
    toCreatePayload: (form) => ({
      issue_date: form.issueDate,
      due_date: form.dueDate,
      sender_name: form.senderName,
      sender_email: form.senderEmail,
      sender_address: form.senderAddress,
      sender_logo_url: form.senderLogoUrl,
      terms_text: form.termsText,
      footer_text: form.footerText,
      notes_text: form.notesText,
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
      sender_name: form.senderName,
      sender_email: form.senderEmail,
      sender_address: form.senderAddress,
      sender_logo_url: form.senderLogoUrl,
      terms_text: form.termsText,
      footer_text: form.footerText,
      notes_text: form.notesText,
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
