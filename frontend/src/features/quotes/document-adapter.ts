/**
 * Document-creator adapter for quotes.
 *
 * Bridges the domain-specific quote data model to the generic
 * {@link DocumentCreatorAdapter} interface so the shared creator UI can
 * render, create, and update quotes without knowing their schema.
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
  QuoteLineInput,
  QuotePolicyContract,
  QuoteRecord,
  QuoteStatusEventRecord,
} from "./types";

type QuoteFormState = {
  title: string;
  validThrough: string;
  termsText: string;
  notesText: string;
  taxPercent: string;
  contingencyPercent?: string;
  overheadProfitPercent?: string;
  insurancePercent?: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  lineItems: QuoteLineInput[];
};

/**
 * Convert the backend policy contract (snake_case) to the creator's
 * status policy shape (camelCase).
 */
export function toQuoteStatusPolicy(contract: QuotePolicyContract): CreatorStatusPolicy {
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
export function toQuoteStatusEvents(
  events: QuoteStatusEventRecord[],
): CreatorStatusEvent[] {
  return events.map((event) => ({
    id: event.id,
    fromStatus: event.from_status,
    toStatus: event.to_status,
    note: event.note,
    actorEmail: event.changed_by_email,
    occurredAt: event.changed_at,
  }));
}

/**
 * Build a fully configured document-creator adapter for quotes.
 *
 * The adapter tells the creator how to extract IDs, titles, meta fields,
 * line items, and totals from an quote, and how to serialize form
 * state back into create/update API payloads.
 */
export function createQuoteDocumentAdapter(
  statusPolicy: CreatorStatusPolicy,
  statusEvents: QuoteStatusEventRecord[],
): DocumentCreatorAdapter<QuoteRecord, CreatorLineDraft, QuoteFormState> {
  return {
    kind: "quote",
    statusPolicy,

    // --- Identity & display ---

    getDocumentId: (document) => (document ? String(document.id) : null),
    getDocumentTitle: (document) => document?.title ?? "Untitled quote",
    getDocumentStatus: (document) => document?.status ?? statusPolicy.defaultCreateStatus,

    getMetaFields: (document): CreatorMetaField[] => [
      { key: "version", label: "Version", value: document ? `v${document.version}` : "v1" },
      { key: "valid_through", label: "Valid Through", value: document?.valid_through || "Not set" },
    ],

    getStatusEvents: () => toQuoteStatusEvents(statusEvents),

    // --- Form state → creator lines / totals ---

    getDraftLines: (form) =>
      form.lineItems.map((line) => ({
        localId: line.localId,
        costCodeId: line.costCodeId,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitCost,
        markupPercent: line.markupPercent,
      })),

    getTotals: (form) => ({
      subtotal: form.subtotal,
      taxPercent: Number(form.taxPercent || "0"),
      taxAmount: form.taxAmount,
      total: form.totalAmount,
    }),

    // --- Form state → API payloads ---

    toCreatePayload: (form) => ({
      title: form.title,
      valid_through: form.validThrough,
      tax_percent: form.taxPercent,
      contingency_percent: form.contingencyPercent ?? "0",
      overhead_profit_percent: form.overheadProfitPercent ?? "0",
      insurance_percent: form.insurancePercent ?? "0",
      notes_text: form.notesText,
      line_items: form.lineItems.map((line) => ({
        cost_code: Number(line.costCodeId),
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unitCost,
        markup_percent: line.markupPercent,
      })),
    }),

    toUpdatePayload: (form) => ({
      title: form.title,
      valid_through: form.validThrough,
      tax_percent: form.taxPercent,
      contingency_percent: form.contingencyPercent ?? "0",
      overhead_profit_percent: form.overheadProfitPercent ?? "0",
      insurance_percent: form.insurancePercent ?? "0",
      notes_text: form.notesText,
      line_items: form.lineItems.map((line) => ({
        cost_code: Number(line.costCodeId),
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unitCost,
        markup_percent: line.markupPercent,
      })),
    }),
  };
}

export type { QuoteFormState };
