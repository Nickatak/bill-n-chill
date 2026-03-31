/**
 * Pure helper functions for the quotes feature.
 *
 * Extracted from component files so they can be unit-tested directly.
 * None of these touch React state or DOM — they're plain data transforms.
 */

import { readApiErrorMessage } from "@/shared/api/error";
import type {
  ApiResponse,
  CostCode,
  QuoteLineInput,
  QuoteLineItemRecord,
  QuotePolicyContract,
  QuoteRecord,
  QuoteStatusEventRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUOTE_VALIDATION_DELTA_DAYS_FALLBACK = 30;

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

export type NormalizedQuotePolicy = {
  statuses: string[];
  statusLabels: Record<string, string>;
  allowedTransitions: Record<string, string[]>;
  quickActionByStatus: Record<string, "change_order" | "revision">;
  defaultCreateStatus: string;
  defaultStatusFilters: string[];
};

export function normalizeQuotePolicy(
  contract: QuotePolicyContract,
  fallbacks: {
    statuses: string[];
    statusLabels: Record<string, string>;
    defaultStatusFilters: string[];
    quickActionByStatus: Record<string, "change_order" | "revision">;
  },
): NormalizedQuotePolicy | null {
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
// Quote auto-selection
// ---------------------------------------------------------------------------

/**
 * Pick the best quote to auto-select after a list load.
 *
 * Priority cascade (first visible match wins):
 *  1. `preferredId` — explicitly requested (e.g. just-created or preserving selection)
 *  2. `scopedId`    — deep-linked from URL or cross-page navigation
 *  3. First visible quote in the list
 *
 * "Visible" means the quote's status is included in the current filter set.
 */
export function resolveAutoSelectQuote(
  rows: QuoteRecord[],
  activeFilters: string[],
  hints: {
    preferredId?: number | null;
    scopedId?: number | null;
  },
): QuoteRecord | null {
  const isVisible = (e: QuoteRecord) => activeFilters.includes(e.status);

  if (hints.preferredId) {
    const match = rows.find((e) => e.id === hints.preferredId);
    if (match && isVisible(match)) return match;
  }

  if (hints.scopedId) {
    const match = rows.find((e) => e.id === hints.scopedId);
    if (match && isVisible(match)) return match;
  }

  return rows.find(isVisible) ?? null;
}

// ---------------------------------------------------------------------------
// Line-item validation
// ---------------------------------------------------------------------------

export type LineValidationIssue = {
  localId: number;
  rowNumber: number;
  message: string;
};

export type LineValidationResult = {
  issues: LineValidationIssue[];
  issuesByLocalId: Map<number, string[]>;
};

/** Validate quote line items for completeness (cost code required). */
export function validateQuoteLineItems(lines: QuoteLineInput[]): LineValidationResult {
  const issues: LineValidationIssue[] = [];
  const issuesByLocalId = new Map<number, string[]>();
  lines.forEach((line, index) => {
    const rowNumber = index + 1;
    const rowIssues: string[] = [];

    if (!line.costCodeId.trim()) {
      rowIssues.push("Select a cost code.");
    }

    if (!rowIssues.length) {
      return;
    }

    issuesByLocalId.set(line.localId, rowIssues);
    for (const message of rowIssues) {
      issues.push({ localId: line.localId, rowNumber, message });
    }
  });

  return { issues, issuesByLocalId };
}

// ---------------------------------------------------------------------------
// Console helpers
// ---------------------------------------------------------------------------

/** Resolve the organization's configured validity window, clamped to 1–365 days. */
export function resolveQuoteValidationDeltaDays(
  defaults?: { default_quote_valid_delta?: number } | null,
): number {
  const parsed = Number(defaults?.default_quote_valid_delta);
  if (!Number.isFinite(parsed)) {
    return QUOTE_VALIDATION_DELTA_DAYS_FALLBACK;
  }
  return Math.max(1, Math.min(365, Math.round(parsed)));
}

/** Create a blank quote line item with sensible defaults. */
export function emptyLine(localId: number, defaultCostCodeId = ""): QuoteLineInput {
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
export function mapQuoteLineItemsToInputs(
  items: QuoteLineItemRecord[] = [],
): QuoteLineInput[] {
  if (!items.length) {
    return [emptyLine(1)];
  }
  return items.map((item, index) => ({
    localId: index + 1,
    costCodeId: String(item.cost_code ?? ""),
    description: item.description || "",
    quantity: String(item.quantity ?? ""),
    unit: item.unit || "ea",
    unitCost: String(item.unit_price ?? ""),
    markupPercent: String(item.markup_percent ?? ""),
  }));
}

/** Enrich API error messages with quote-specific context for status transition failures. */
export function readQuoteApiError(
  payload: ApiResponse | undefined,
  fallback: string,
): string {
  const message = readApiErrorMessage(payload, fallback);
  if (/invalid .*status transition/i.test(message) && !/refresh/i.test(message)) {
    return `${message} This quote may have changed from a client action on the public page. Refresh to load the latest status.`;
  }
  return message;
}

/** Normalize an quote title for case-insensitive family matching. */
export function normalizeFamilyTitle(value: string): string {
  return value.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Public preview helpers
// ---------------------------------------------------------------------------

/** Convert an quote record's line items into form-compatible input shapes. */
export function mapPublicQuoteLineItems(
  quote: QuoteRecord | null,
): QuoteLineInput[] {
  const items = quote?.line_items ?? [];
  if (!items.length) {
    return [];
  }
  return items.map((item, index) => ({
    localId: index + 1,
    costCodeId: String(item.cost_code ?? ""),
    description: item.description || "",
    quantity: String(item.quantity ?? ""),
    unit: item.unit || "ea",
    unitCost: String(item.unit_price ?? ""),
    markupPercent: String(item.markup_percent ?? ""),
  }));
}

/** Extract a deduplicated cost-code lookup list from inline line-item data. */
export function mapLineCostCodes(quote: QuoteRecord | null): CostCode[] {
  const items = quote?.line_items ?? [];
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
      taxable: item.cost_code_taxable !== false,
    });
  }
  return Array.from(byId.values());
}

/** Resolve a status value to its human-readable label, falling back gracefully. */
export function quoteStatusLabel(status?: string): string {
  const normalized = (status || "").trim();
  return STATUS_LABELS[normalized] || normalized || "Unknown";
}

// ---------------------------------------------------------------------------
// Status event helpers
// ---------------------------------------------------------------------------

/** Derive a past-tense action label from a status-event record. */
export function formatStatusAction(event: QuoteStatusEventRecord): string {
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
  return actionByStatus[event.to_status] ?? quoteStatusLabel(event.to_status);
}

/** Check whether a status event is a notation rather than a transition. */
export function isResendStatusEvent(event: QuoteStatusEventRecord): boolean {
  if (event.action_type === "resend") return true;
  if (event.action_type === "notate") return false;
  if (event.from_status === "sent" && event.to_status === "sent" && !(event.note || "").trim()) return true;
  return false;
}

export function isNotatedStatusEvent(event: QuoteStatusEventRecord): boolean {
  if (event.action_type === "notate") {
    return true;
  }
  if (isResendStatusEvent(event)) return false;
  return event.from_status === event.to_status && (event.note || "").trim().length > 0;
}

// ---------------------------------------------------------------------------
// Numeric parsing
// ---------------------------------------------------------------------------

/** Parse a string to a finite number, returning 0 for non-numeric input. */
export function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Compute the total for a single line item (quantity × unitCost × (1 + markup%)). */
export function computeLineTotal(line: QuoteLineInput): number {
  const quantity = toNumber(line.quantity);
  const unitCost = toNumber(line.unitCost);
  const markup = toNumber(line.markupPercent);
  const base = quantity * unitCost;
  return base + base * (markup / 100);
}

// ---------------------------------------------------------------------------
// Family grouping and filtering
// ---------------------------------------------------------------------------

export type QuoteFamily = {
  title: string;
  items: QuoteRecord[];
};

/**
 * Group quotes by title into families, sorted by version within each
 * family and by most-recent activity across families.
 */
export function groupQuoteFamilies(quotes: QuoteRecord[]): QuoteFamily[] {
  const families = new Map<string, QuoteRecord[]>();
  for (const quote of quotes) {
    const title = (quote.title || "").trim() || "Untitled";
    const existing = families.get(title);
    if (existing) {
      existing.push(quote);
    } else {
      families.set(title, [quote]);
    }
  }
  return Array.from(families.entries())
    .map(([title, items]) => ({
      title,
      items: [...items].sort((a, b) => a.version - b.version),
    }))
    .sort((a, b) => {
      const latestA = a.items[a.items.length - 1];
      const latestB = b.items[b.items.length - 1];
      const lastActionA = new Date(latestA?.updated_at || latestA?.created_at || 0).getTime();
      const lastActionB = new Date(latestB?.updated_at || latestB?.created_at || 0).getTime();
      return lastActionB - lastActionA;
    });
}

/**
 * Count how many families have each status as their latest version's status.
 */
export function computeQuoteStatusCounts(families: QuoteFamily[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const family of families) {
    const latest = family.items[family.items.length - 1];
    if (latest?.status) {
      counts[latest.status] = (counts[latest.status] || 0) + 1;
    }
  }
  return counts;
}

/**
 * Filter families to those whose latest version's status is in the active filter set.
 */
export function filterVisibleFamilies(
  families: QuoteFamily[],
  statusFilters: string[],
): QuoteFamily[] {
  if (statusFilters.length === 0) {
    return [];
  }
  return families.filter((family) => {
    const latest = family.items[family.items.length - 1];
    if (!latest?.status) {
      return false;
    }
    return statusFilters.includes(latest.status);
  });
}
