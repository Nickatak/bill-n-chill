import {
  ComposerLineDraft,
  ComposerMetaField,
  ComposerStatusEvent,
  ComposerStatusPolicy,
  DocumentComposerAdapter,
} from "@/shared/document-composer/types";
import {
  EstimateLineInput,
  EstimatePolicyContract,
  EstimateRecord,
  EstimateStatusEventRecord,
} from "./types";

type EstimateFormState = {
  title: string;
  validThrough: string;
  taxPercent: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  lineItems: EstimateLineInput[];
};

export function toEstimateStatusPolicy(contract: EstimatePolicyContract): ComposerStatusPolicy {
  return {
    statuses: contract.statuses,
    statusLabels: contract.status_labels,
    defaultCreateStatus: contract.default_create_status,
    defaultStatusFilters: contract.default_status_filters,
    allowedTransitions: contract.allowed_status_transitions,
    terminalStatuses: contract.terminal_statuses,
  };
}

export function toEstimateStatusEvents(
  events: EstimateStatusEventRecord[],
): ComposerStatusEvent[] {
  return events.map((event) => ({
    id: event.id,
    fromStatus: event.from_status,
    toStatus: event.to_status,
    note: event.note,
    actorEmail: event.changed_by_email,
    occurredAt: event.changed_at,
  }));
}

export function createEstimateDocumentAdapter(
  statusPolicy: ComposerStatusPolicy,
  statusEvents: EstimateStatusEventRecord[],
): DocumentComposerAdapter<EstimateRecord, ComposerLineDraft, EstimateFormState> {
  return {
    kind: "estimate",
    statusPolicy,
    getDocumentId: (document) => (document ? String(document.id) : null),
    getDocumentTitle: (document) => document?.title ?? "Untitled estimate",
    getDocumentStatus: (document) => document?.status ?? statusPolicy.defaultCreateStatus,
    getMetaFields: (document): ComposerMetaField[] => [
      { key: "estimate_id", label: "Estimate #", value: document ? `#${document.id}` : "Draft" },
      { key: "version", label: "Version", value: document ? `v${document.version}` : "v1" },
      { key: "valid_through", label: "Valid Through", value: document?.valid_through || "Not set" },
    ],
    getStatusEvents: () => toEstimateStatusEvents(statusEvents),
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
    toCreatePayload: (form) => ({
      title: form.title,
      valid_through: form.validThrough,
      tax_percent: form.taxPercent,
      line_items: form.lineItems.map((line) => ({
        cost_code: Number(line.costCodeId),
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_cost: line.unitCost,
        markup_percent: line.markupPercent,
      })),
    }),
    toUpdatePayload: (form) => ({
      title: form.title,
      valid_through: form.validThrough,
      tax_percent: form.taxPercent,
      line_items: form.lineItems.map((line) => ({
        cost_code: Number(line.costCodeId),
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_cost: line.unitCost,
        markup_percent: line.markupPercent,
      })),
    }),
  };
}

export type { EstimateFormState };
