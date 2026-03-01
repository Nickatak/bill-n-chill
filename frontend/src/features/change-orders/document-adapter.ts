/**
 * Document-creator adapter for change orders.
 *
 * Bridges the domain-specific change-order data model to the generic
 * {@link DocumentCreatorAdapter} interface so the shared creator UI can
 * render, create, and update change orders without knowing their schema.
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
  ChangeOrderPolicyContract,
  ChangeOrderRecord,
} from "./types";

type ChangeOrderLineInput = {
  localId: number;
  lineType: "scope" | "adjustment";
  adjustmentReason: string;
  budgetLineId: string;
  description: string;
  amountDelta: string;
  daysDelta: string;
};

type ChangeOrderStatusEvent = {
  id: number | string;
  from_status: string | null;
  to_status: string;
  note?: string;
  actor_email?: string | null;
  created_at: string;
};

type ChangeOrderFormState = {
  title: string;
  reason: string;
  amountDelta: string;
  daysDelta: string;
  lineItems: ChangeOrderLineInput[];
};

/**
 * Convert the backend policy contract (snake_case) to the creator's
 * status policy shape (camelCase).
 */
export function toChangeOrderStatusPolicy(
  contract: ChangeOrderPolicyContract,
): CreatorStatusPolicy {
  return {
    statuses: contract.statuses,
    statusLabels: contract.status_labels,
    defaultCreateStatus: contract.default_create_status,
    defaultStatusFilters: contract.statuses,
    allowedTransitions: contract.allowed_status_transitions,
    terminalStatuses: contract.terminal_statuses,
  };
}

/**
 * Convert backend status event records to the creator's status event
 * shape, renaming snake_case fields to camelCase.
 */
export function toChangeOrderStatusEvents(
  events: ChangeOrderStatusEvent[],
): CreatorStatusEvent[] {
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
 * Build a fully configured document-creator adapter for change orders.
 *
 * The adapter tells the creator how to extract IDs, titles, meta fields,
 * line items, and totals from a change order, and how to serialize form
 * state back into create/update API payloads.
 */
export function createChangeOrderDocumentAdapter(
  statusPolicy: CreatorStatusPolicy,
  statusEvents: ChangeOrderStatusEvent[],
): DocumentCreatorAdapter<ChangeOrderRecord, CreatorLineDraft, ChangeOrderFormState> {
  return {
    kind: "change_order",
    statusPolicy,

    // --- Identity & display ---

    getDocumentId: (document) => (document ? String(document.id) : null),
    getDocumentTitle: (document) => document?.title ?? "Untitled change order",
    getDocumentStatus: (document) => document?.status ?? statusPolicy.defaultCreateStatus,

    getMetaFields: (document): CreatorMetaField[] => [
      { key: "co_id", label: "Change Order #", value: document ? `CO-${document.id}` : "Draft" },
      {
        key: "revision",
        label: "Revision",
        value: document ? `v${document.revision_number}` : "v1",
      },
      {
        key: "origin_estimate",
        label: "Original Estimate",
        value: document?.origin_estimate ? `#${document.origin_estimate}` : "Not set",
      },
      {
        key: "line_delta_total",
        label: "Line Delta Total",
        value: document?.line_total_delta ? `$${document.line_total_delta}` : "$0.00",
      },
    ],

    getStatusEvents: () => toChangeOrderStatusEvents(statusEvents),

    // --- Form state → creator lines / totals ---

    getDraftLines: (form) =>
      form.lineItems.map((line) => ({
        localId: line.localId,
        description: line.description,
        quantity: "1",
        unit: "ea",
        unitPrice: line.amountDelta,
        amountDelta: line.amountDelta,
        daysDelta: line.daysDelta,
      })),

    getTotals: (form) => ({
      subtotal: Number(form.amountDelta || "0"),
      total: Number(form.amountDelta || "0"),
      metadata: {
        days_delta: Number(form.daysDelta || "0"),
      },
    }),

    // --- Form state → API payloads ---

    toCreatePayload: (form) => ({
      title: form.title,
      reason: form.reason,
      amount_delta: form.amountDelta,
      days_delta: Number(form.daysDelta || "0"),
      line_items: form.lineItems.map((line) => ({
        line_type: line.lineType,
        budget_line: Number(line.budgetLineId),
        description: line.description,
        adjustment_reason: line.adjustmentReason,
        amount_delta: line.amountDelta,
        days_delta: Number(line.daysDelta || "0"),
      })),
    }),

    toUpdatePayload: (form) => ({
      title: form.title,
      reason: form.reason,
      amount_delta: form.amountDelta,
      days_delta: Number(form.daysDelta || "0"),
      line_items: form.lineItems.map((line) => ({
        line_type: line.lineType,
        budget_line: Number(line.budgetLineId),
        description: line.description,
        adjustment_reason: line.adjustmentReason,
        amount_delta: line.amountDelta,
        days_delta: Number(line.daysDelta || "0"),
      })),
    }),
  };
}

export type { ChangeOrderFormState, ChangeOrderStatusEvent };
