/**
 * Pure helper functions for the estimates feature.
 *
 * Extracted from component files so they can be unit-tested directly.
 * None of these touch React state or DOM — they're plain data transforms.
 */

import { readApiErrorMessage } from "@/shared/api/error";
import type {
  ApiResponse,
  CostCode,
  EstimateLineInput,
  EstimateLineItemRecord,
  EstimatePolicyContract,
  EstimateRecord,
  EstimateStatusEventRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ESTIMATE_VALIDATION_DELTA_DAYS_FALLBACK = 30;

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
  archived: "Archived",
  void: "Void",
};

// ---------------------------------------------------------------------------
// Policy contract normalization
// ---------------------------------------------------------------------------

export type NormalizedEstimatePolicy = {
  statuses: string[];
  statusLabels: Record<string, string>;
  allowedTransitions: Record<string, string[]>;
  quickActionByStatus: Record<string, "change_order" | "revision">;
  defaultCreateStatus: string;
  defaultStatusFilters: string[];
};

export function normalizeEstimatePolicy(
  contract: EstimatePolicyContract,
  fallbacks: {
    statuses: string[];
    statusLabels: Record<string, string>;
    defaultStatusFilters: string[];
    quickActionByStatus: Record<string, "change_order" | "revision">;
  },
): NormalizedEstimatePolicy | null {
  if (
    !Array.isArray(contract.statuses) ||
    !contract.statuses.length ||
    !contract.allowed_status_transitions
  ) {
    return null;
  }

  const allowedTransitions: Record<string, string[]> = {};
  for (const status of contract.statuses) {
    const next = contract.allowed_status_transitions[status];
    allowedTransitions[status] = Array.isArray(next) ? next : [];
  }

  const defaultCreateStatus =
    contract.default_create_status || contract.statuses[0] || fallbacks.statuses[0];

  const candidateFilters =
    Array.isArray(contract.default_status_filters) && contract.default_status_filters.length
      ? contract.default_status_filters
      : fallbacks.defaultStatusFilters;
  const validFilters = candidateFilters.filter((v) => contract.statuses.includes(v));
  const defaultStatusFilters = validFilters.length ? validFilters : contract.statuses;

  return {
    statuses: contract.statuses,
    statusLabels: { ...fallbacks.statusLabels, ...(contract.status_labels || {}) },
    allowedTransitions,
    quickActionByStatus: { ...fallbacks.quickActionByStatus, ...(contract.quick_action_by_status || {}) },
    defaultCreateStatus,
    defaultStatusFilters,
  };
}

// ---------------------------------------------------------------------------
// Estimate auto-selection
// ---------------------------------------------------------------------------

/**
 * Pick the best estimate to auto-select after a list load.
 *
 * Priority cascade (first visible match wins):
 *  1. `preferredId` — explicitly requested (e.g. just-created or preserving selection)
 *  2. `scopedId`    — deep-linked from URL or cross-page navigation
 *  3. Active financial baseline
 *  4. First visible estimate in the list
 *
 * "Visible" means the estimate's status is included in the current filter set.
 */
export function resolveAutoSelectEstimate(
  rows: EstimateRecord[],
  activeFilters: string[],
  hints: {
    preferredId?: number | null;
    scopedId?: number | null;
  },
): EstimateRecord | null {
  const isVisible = (e: EstimateRecord) => activeFilters.includes(e.status);

  if (hints.preferredId) {
    const match = rows.find((e) => e.id === hints.preferredId);
    if (match && isVisible(match)) return match;
  }

  if (hints.scopedId) {
    const match = rows.find((e) => e.id === hints.scopedId);
    if (match && isVisible(match)) return match;
  }

  const activeBaseline = rows.find((e) => e.is_active_financial_baseline && isVisible(e));
  if (activeBaseline) return activeBaseline;

  return rows.find(isVisible) ?? null;
}

// ---------------------------------------------------------------------------
// Console helpers
// ---------------------------------------------------------------------------

/** Resolve the organization's configured validity window, clamped to 1–365 days. */
export function resolveEstimateValidationDeltaDays(
  defaults?: { default_estimate_valid_delta?: number } | null,
): number {
  const parsed = Number(defaults?.default_estimate_valid_delta);
  if (!Number.isFinite(parsed)) {
    return ESTIMATE_VALIDATION_DELTA_DAYS_FALLBACK;
  }
  return Math.max(1, Math.min(365, Math.round(parsed)));
}

/** Create a blank estimate line item with sensible defaults. */
export function emptyLine(localId: number, defaultCostCodeId = ""): EstimateLineInput {
  return {
    localId,
    costCodeId: defaultCostCodeId,
    description: "Scope item",
    quantity: "1",
    unit: "ea",
    unitCost: "0",
    markupPercent: "0",
  };
}

/** Map API line-item records into form-compatible input shapes. */
export function mapEstimateLineItemsToInputs(
  items: EstimateLineItemRecord[] = [],
): EstimateLineInput[] {
  if (!items.length) {
    return [emptyLine(1)];
  }
  return items.map((item, index) => ({
    localId: index + 1,
    costCodeId: String(item.cost_code ?? ""),
    description: item.description || "",
    quantity: String(item.quantity ?? ""),
    unit: item.unit || "ea",
    unitCost: String(item.unit_cost ?? ""),
    markupPercent: String(item.markup_percent ?? ""),
  }));
}

/** Enrich API error messages with estimate-specific context for status transition failures. */
export function readEstimateApiError(
  payload: ApiResponse | undefined,
  fallback: string,
): string {
  const message = readApiErrorMessage(payload, fallback);
  if (/invalid .*status transition/i.test(message) && !/refresh/i.test(message)) {
    return `${message} This estimate may have changed from a client action on the public page. Refresh to load the latest status.`;
  }
  return message;
}

/** Normalize an estimate title for case-insensitive family matching. */
export function normalizeFamilyTitle(value: string): string {
  return value.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Public preview helpers
// ---------------------------------------------------------------------------

/** Convert an estimate record's line items into form-compatible input shapes. */
export function mapPublicEstimateLineItems(
  estimate: EstimateRecord | null,
): EstimateLineInput[] {
  const items = estimate?.line_items ?? [];
  if (!items.length) {
    return [];
  }
  return items.map((item, index) => ({
    localId: index + 1,
    costCodeId: String(item.cost_code ?? ""),
    description: item.description || "",
    quantity: String(item.quantity ?? ""),
    unit: item.unit || "ea",
    unitCost: String(item.unit_cost ?? ""),
    markupPercent: String(item.markup_percent ?? ""),
  }));
}

/** Extract a deduplicated cost-code lookup list from inline line-item data. */
export function mapLineCostCodes(estimate: EstimateRecord | null): CostCode[] {
  const items = estimate?.line_items ?? [];
  const byId = new Map<number, CostCode>();
  for (const item of items) {
    const costCodeId = Number(item.cost_code);
    if (!Number.isFinite(costCodeId)) {
      continue;
    }
    byId.set(costCodeId, {
      id: costCodeId,
      code: item.cost_code_code || `CC-${costCodeId}`,
      name: item.cost_code_name || "Cost code",
      is_active: true,
    });
  }
  return Array.from(byId.values());
}

/** Resolve a status value to its human-readable label, falling back gracefully. */
export function estimateStatusLabel(status?: string): string {
  const normalized = (status || "").trim();
  return STATUS_LABELS[normalized] || normalized || "Unknown";
}

// ---------------------------------------------------------------------------
// Financial baseline helpers (re-exported from shared)
// ---------------------------------------------------------------------------

export {
  financialBaselineStatus as estimateFinancialBaselineStatus,
  formatFinancialBaselineStatus,
} from "@/shared/financial-baseline";

// ---------------------------------------------------------------------------
// Status event helpers
// ---------------------------------------------------------------------------

/** Derive a past-tense action label from a status-event record. */
export function formatStatusAction(event: EstimateStatusEventRecord): string {
  if (event.action_type === "notate") {
    return "Notated";
  }
  if (event.action_type === "resend") {
    return "Re-sent";
  }
  if (event.from_status === "sent" && event.to_status === "sent" && !(event.note || "").trim()) {
    return "Re-sent";
  }
  if (event.from_status === event.to_status && (event.note || "").trim()) {
    return "Notated";
  }
  const actionByStatus: Record<string, string> = {
    draft: "Created as Draft",
    sent: "Sent",
    approved: "Approved",
    rejected: "Rejected",
    void: "Voided",
    archived: "Archived",
  };
  return actionByStatus[event.to_status] ?? estimateStatusLabel(event.to_status);
}

/** Check whether a status event is a notation rather than a transition. */
export function isNotatedStatusEvent(event: EstimateStatusEventRecord): boolean {
  if (event.action_type === "notate") {
    return true;
  }
  return event.from_status === event.to_status && (event.note || "").trim().length > 0;
}
