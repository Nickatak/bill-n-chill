import {
  ComposerLineDraft,
  ComposerMetaField,
  ComposerStatusEvent,
  ComposerStatusPolicy,
  DocumentComposerAdapter,
} from "@/shared/document-composer/types";
import {
  ChangeOrderPolicyContract,
  ChangeOrderRecord,
} from "./types";

type ChangeOrderLineInput = {
  localId: number;
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

export function toChangeOrderStatusPolicy(
  contract: ChangeOrderPolicyContract,
): ComposerStatusPolicy {
  return {
    statuses: contract.statuses,
    statusLabels: contract.status_labels,
    defaultCreateStatus: contract.default_create_status,
    defaultStatusFilters: contract.statuses,
    allowedTransitions: contract.allowed_status_transitions,
    terminalStatuses: contract.terminal_statuses,
  };
}

export function toChangeOrderStatusEvents(
  events: ChangeOrderStatusEvent[],
): ComposerStatusEvent[] {
  return events.map((event) => ({
    id: event.id,
    fromStatus: event.from_status,
    toStatus: event.to_status,
    note: event.note,
    actorEmail: event.actor_email,
    occurredAt: event.created_at,
  }));
}

export function createChangeOrderDocumentAdapter(
  statusPolicy: ComposerStatusPolicy,
  statusEvents: ChangeOrderStatusEvent[],
): DocumentComposerAdapter<ChangeOrderRecord, ComposerLineDraft, ChangeOrderFormState> {
  return {
    kind: "change_order",
    statusPolicy,
    getDocumentId: (document) => (document ? String(document.id) : null),
    getDocumentTitle: (document) => document?.title ?? "Untitled change order",
    getDocumentStatus: (document) => document?.status ?? statusPolicy.defaultCreateStatus,
    getMetaFields: (document): ComposerMetaField[] => [
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
    toCreatePayload: (form) => ({
      title: form.title,
      reason: form.reason,
      amount_delta: form.amountDelta,
      days_delta: Number(form.daysDelta || "0"),
      line_items: form.lineItems.map((line) => ({
        budget_line: Number(line.budgetLineId),
        description: line.description,
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
        budget_line: Number(line.budgetLineId),
        description: line.description,
        amount_delta: line.amountDelta,
        days_delta: Number(line.daysDelta || "0"),
      })),
    }),
  };
}

export type { ChangeOrderFormState, ChangeOrderStatusEvent };
