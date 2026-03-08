/**
 * Pure helper functions for the invoices feature.
 *
 * Extracted from component files so they can be unit-tested directly.
 * None of these touch React state or DOM — they're plain data transforms.
 */

import { readApiErrorMessage } from "@/shared/api/error";
import type {
  ApiResponse,
  InvoiceLineInput,
  InvoiceRecord,
  InvoiceStatusEventRecord,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVOICE_STATUS_LABELS_FALLBACK: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Partially Paid",
  paid: "Paid",
  void: "Void",
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Compute a due date by adding dueDays to a given issue date. */
export function dueDateFromIssueDate(issueDate: string, dueDays: number): string {
  const base = issueDate ? new Date(`${issueDate}T00:00:00`) : new Date();
  const safeDueDays = Number.isFinite(dueDays) ? Math.max(1, Math.min(365, Math.round(dueDays))) : 30;
  base.setDate(base.getDate() + safeDueDays);
  return base.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

/** Normalize a number to a two-decimal string, returning a fallback for non-finite values. */
export function normalizeDecimalInput(value: number, fallback = "0"): string {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return value.toFixed(2);
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Create a blank line item with sensible defaults for the creator workspace. */
export function emptyLine(localId: number): InvoiceLineInput {
  return {
    localId,
    costCode: "",
    description: "",
    quantity: "1",
    unit: "ea",
    unitPrice: "0",
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Resolve a display label for an invoice status using the static fallback map. */
export function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABELS_FALLBACK[status] ?? status;
}

/** Build the public-facing route for a customer to view their invoice. */
export function publicInvoiceHref(publicRef?: string): string {
  if (!publicRef) {
    return "";
  }
  return `/invoice/${publicRef}`;
}

/** Return a contextual hint about the next workflow action for a given invoice status. */
export function invoiceNextActionHint(status: string): string {
  if (status === "draft") {
    return "Next: send the invoice to move it into billable AR tracking.";
  }
  if (status === "sent") {
    return "Next: record payments to move invoice to partially paid or paid.";
  }
  if (status === "partially_paid") {
    return "Next: allocate remaining payment and close the outstanding balance.";
  }
  if (status === "paid") {
    return "Invoice is fully settled.";
  }
  if (status === "void") {
    return "Invoice is void and no longer billable.";
  }
  return "Select a status transition as needed.";
}

/** Predict the next sequential invoice number (INV-XXXX) for pre-filling the workspace. */
export function nextInvoiceNumberPreview(rows: InvoiceRecord[]): string {
  const usedNumbers = new Set<number>();
  let digitWidth = 4;
  for (const row of rows) {
    const match = row.invoice_number.match(/^INV-(\d+)$/i);
    if (!match) {
      continue;
    }
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      usedNumbers.add(value);
      digitWidth = Math.max(digitWidth, match[1].length);
    }
  }
  let nextNumber = rows.length + 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }
  return `INV-${String(nextNumber).padStart(digitWidth, "0")}`;
}

// ---------------------------------------------------------------------------
// Status event helpers
// ---------------------------------------------------------------------------

/** Derive a human-readable action label for a status history event row. */
export function invoiceStatusEventActionLabel(
  event: InvoiceStatusEventRecord,
  statusLabel: (status: string) => string,
): string {
  if (event.action_type === "notate") {
    return "Notated";
  }
  if (event.action_type === "resend") {
    return "Re-sent";
  }
  if (event.action_type === "create") {
    return "Created";
  }
  if (event.from_status === "sent" && event.to_status === "sent") {
    return "Re-sent";
  }
  if (event.from_status === event.to_status && (event.note || "").trim()) {
    return "Notated";
  }
  if (!event.from_status) {
    return `Created as ${statusLabel(event.to_status)}`;
  }
  return `${statusLabel(event.from_status)} to ${statusLabel(event.to_status)}`;
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/** Enrich API error messages with invoice-specific context for status transition failures. */
export function readInvoiceApiError(
  payload: ApiResponse | undefined,
  fallback: string,
): string {
  const message = readApiErrorMessage(payload, fallback);
  if (/invalid .*status transition/i.test(message) && !/refresh/i.test(message)) {
    return `${message} This invoice may have changed from a client action on the public page. Refresh to load the latest status.`;
  }
  return message;
}

// ---------------------------------------------------------------------------
// Project helpers
// ---------------------------------------------------------------------------

/** Convert a snake_case project status to a display-friendly label. */
export function projectStatusLabel(statusValue: string): string {
  return statusValue.replace("_", " ");
}
