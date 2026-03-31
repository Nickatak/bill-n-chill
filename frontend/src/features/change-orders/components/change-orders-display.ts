/**
 * Pure display helpers for change order consoles and viewers.
 *
 * Every function in this module is side-effect-free: data in, formatted
 * string/number out. Functions that formerly closed over component state
 * now accept the relevant data as explicit parameters.
 */

import { parseAmount, formatDecimal } from "@/shared/money-format";
import type {
  AuditEventRecord,
  ChangeOrderLineInput,
  ChangeOrderRecord,
  OriginQuoteRecord,
} from "../types";

// ---------------------------------------------------------------------------
// Fallback constants
// ---------------------------------------------------------------------------

/** Fallback human-readable labels for change order statuses when policy contract is unavailable. */
export const CHANGE_ORDER_STATUS_LABELS_FALLBACK: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
  void: "Void",
};

/** Fallback ordered status list when policy contract is unavailable. */
export const CHANGE_ORDER_STATUSES_FALLBACK = ["draft", "sent", "approved", "rejected", "void"];

/** Fallback allowed status transition map when policy contract is unavailable. */
export const CHANGE_ORDER_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, string[]> = {
  draft: ["sent", "void"],
  sent: ["approved", "rejected", "void"],
  approved: [],
  rejected: ["void"],
  void: [],
};

/** Error message shown when the user tries to remove the last remaining line item. */
export const CHANGE_ORDER_MIN_LINE_ITEMS_ERROR = "At least one line item is required.";

// ---------------------------------------------------------------------------
// Status display
// ---------------------------------------------------------------------------

/** Resolve a status value to its human-readable label using the provided labels map. */
export function statusLabel(
  status: string,
  statusLabels: Record<string, string>,
): string {
  const label = statusLabels[status];
  if (label) {
    return label;
  }
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Derive a user-facing control label for a quick-status pill button.
 * Returns action-oriented labels like "Send", "Re-send", "Void", etc.
 */
export function quickStatusControlLabel(
  status: string,
  statusLabels: Record<string, string>,
  currentStatus?: string,
): string {
  if (status === "sent" || status === "sent") {
    return currentStatus === status ? "Re-send" : "Send";
  }
  if (status === "void") {
    return "Void";
  }
  if (status === "approved") {
    return "Approved";
  }
  if (status === "rejected") {
    return "Rejected";
  }
  if (status === "draft") {
    return "Draft";
  }
  return statusLabel(status, statusLabels);
}

/**
 * Resolve a status to its human label, returning "Unset" for empty/falsy values.
 * Used primarily in audit event rendering.
 */
export function statusEventLabel(
  status: string,
  statusLabels: Record<string, string>,
): string {
  if (!status) {
    return "Unset";
  }
  return statusLabel(status, statusLabels);
}

// ---------------------------------------------------------------------------
// Date / time formatting
// ---------------------------------------------------------------------------

/** Format an ISO datetime string into a short human-readable date+time (e.g. "Mar 15, 2026, 3:45 PM"). */
export function formatEventDateTime(dateValue: string): string {
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return "unknown";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

/** Format an ISO date string into a short date label, returning "unknown date" for invalid/null values. */
export function formatApprovedDate(dateValue: string | null): string {
  if (!dateValue) {
    return "unknown date";
  }
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return "unknown date";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

// ---------------------------------------------------------------------------
// Audit event actor helpers
// ---------------------------------------------------------------------------

/** Derive a display name for the actor of an audit event, falling back through display name, email, and user ID. */
export function eventActorLabel(event: AuditEventRecord): string {
  const actorDisplay = (event.created_by_display || "").trim();
  if (actorDisplay) {
    return actorDisplay;
  }
  const actorEmail = (event.created_by_email || "").trim();
  if (actorEmail) {
    return actorEmail;
  }
  if (Number.isFinite(event.created_by)) {
    return `user #${event.created_by}`;
  }
  return "unknown user";
}

/** Build a link path to the customer record if the audit event actor was a customer, otherwise null. */
export function eventActorHref(event: AuditEventRecord): string | null {
  const actorCustomerId = Number(event.created_by_customer_id);
  if (Number.isInteger(actorCustomerId) && actorCustomerId > 0) {
    return `/customers?customer=${actorCustomerId}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Audit event action labels
// ---------------------------------------------------------------------------

/**
 * Derive a past-tense action label from a status audit event.
 * Maps transition patterns (e.g. draft -> sent) to user-friendly
 * labels like "Sent", "Approved", "Re-sent", etc.
 */
export function statusEventActionLabel(
  event: AuditEventRecord,
  statusLabels: Record<string, string>,
): string {
  const fromStatus = event.from_status || "";
  const toStatus = event.to_status || "";
  const statusAction = String(event.metadata_json?.status_action || "").toLowerCase();
  if (statusAction === "notate") {
    return "Notated";
  }
  if (statusAction === "resend") {
    return "Re-sent";
  }
  if (!fromStatus && toStatus === "draft") {
    return "Created";
  }
  if (fromStatus === toStatus && (event.note || "").trim()) {
    return "Notated";
  }
  if (fromStatus === "sent" && toStatus === "sent") {
    return "Re-sent";
  }
  if (fromStatus === "draft" && toStatus === "sent") {
    return "Sent";
  }
  if (toStatus === "approved") {
    return "Approved";
  }
  if (toStatus === "rejected") {
    return "Rejected";
  }
  if (toStatus === "void") {
    return "Voided";
  }
  if (toStatus === "draft" && fromStatus) {
    return "Returned to Draft";
  }
  return `${statusEventLabel(fromStatus, statusLabels)} -> ${statusEventLabel(toStatus, statusLabels)}`;
}

// ---------------------------------------------------------------------------
// Quote / CO financial helpers
// ---------------------------------------------------------------------------

/** Build a human-readable approval summary string for an origin quote (e.g. "approved on Mar 15, 2026 by user@example.com"). */
export function approvalMeta(quote: OriginQuoteRecord): string {
  const dateLabel = formatApprovedDate(quote.approved_at);
  if (quote.approved_by_email) {
    return `approved on ${dateLabel} by ${quote.approved_by_email}`;
  }
  return `approved on ${dateLabel}`;
}

/**
 * Sum approved change order deltas for a given origin quote.
 * Returns a formatted decimal string (e.g. "1500.00").
 */
export function approvedRollingDeltaForQuote(
  quoteId: number,
  changeOrders: ChangeOrderRecord[],
): string {
  const total = changeOrders.reduce((sum, changeOrder) => {
    if (
      changeOrder.origin_quote !== quoteId ||
      changeOrder.status !== "approved"
    ) {
      return sum;
    }
    return sum + parseAmount(changeOrder.amount_delta);
  }, 0);
  return formatDecimal(total);
}

/** Look up the original budget total for a given quote from the precomputed totals map. */
export function originalBudgetTotalForQuote(
  quoteId: number,
  originQuoteOriginalTotals: Record<number, number>,
): string {
  return formatDecimal(originQuoteOriginalTotals[quoteId] ?? 0);
}

/** Compute the current approved budget total (original quote + approved CO deltas) for a given quote. */
export function currentApprovedBudgetTotalForQuote(
  quoteId: number,
  changeOrders: ChangeOrderRecord[],
  originQuoteOriginalTotals: Record<number, number>,
): string {
  return formatDecimal(
    parseAmount(originalBudgetTotalForQuote(quoteId, originQuoteOriginalTotals)) +
    parseAmount(approvedRollingDeltaForQuote(quoteId, changeOrders)),
  );
}

// ---------------------------------------------------------------------------
// Audit event lookup
// ---------------------------------------------------------------------------

/**
 * Find the most recent status event for a specific change order from the project's audit events.
 * Returns null if no matching events exist.
 */
export function lastStatusEventForChangeOrder(
  changeOrderId: number,
  projectAuditEvents: AuditEventRecord[],
): AuditEventRecord | null {
  const events = projectAuditEvents
    .filter((event) =>
      event.event_type === "change_order_updated" &&
      event.object_type === "change_order" &&
      event.object_id === changeOrderId &&
      (Boolean(event.from_status) || Boolean(event.to_status)))
    .sort((left, right) => {
      const leftTime = Date.parse(left.created_at);
      const rightTime = Date.parse(right.created_at);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return right.id - left.id;
    });
  return events[0] ?? null;
}

// ---------------------------------------------------------------------------
// Line item payload
// ---------------------------------------------------------------------------

/** Convert local line-item form state into the API payload shape for create/update requests. */
export function toLinePayload(lines: ChangeOrderLineInput[]) {
  return lines
    .filter((line) => line.costCodeId.trim() !== "")
    .map((line) => ({
      cost_code: Number(line.costCodeId),
      description: line.description,
      adjustment_reason: line.adjustmentReason,
      amount_delta: line.amountDelta.trim() || "0",
      days_delta: Number(line.daysDelta.trim() || "0"),
    }));
}
