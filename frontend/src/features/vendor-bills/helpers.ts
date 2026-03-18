/**
 * Pure helper functions for the vendor-bills feature.
 *
 * Extracted from component files so they can be unit-tested directly.
 * None of these touch React state or DOM — they're plain data transforms.
 */

import type { VendorBillLineInput } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VendorBillLineFormRow = VendorBillLineInput;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Creates a blank line item row for the vendor bill form (description, qty × unit_price). */
export function createEmptyVendorBillLineRow(): VendorBillLineFormRow {
  return {
    description: "",
    quantity: "1",
    unit_price: "",
  };
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/** Returns default bill status filters — active (non-terminal) statuses only. */
export function defaultBillStatusFilters(statuses: string[]): string[] {
  const TERMINAL = new Set(["closed", "void"]);
  const active = statuses.filter((value) => !TERMINAL.has(value));
  return active.length ? active : statuses;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Convert a snake_case project status to a display-friendly label. */
export function projectStatusLabel(statusValue: string): string {
  return statusValue.replace("_", " ");
}

/** Formats a string dollar value to two decimal places, defaulting to "0.00". */
export function formatMoney(value?: string): string {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}
