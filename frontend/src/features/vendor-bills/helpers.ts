/**
 * Pure helper functions for the vendor-bills feature.
 *
 * Extracted from component files so they can be unit-tested directly.
 * None of these touch React state or DOM — they're plain data transforms.
 */

import type { VendorBillAllocationInput } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AllocationFormRow = VendorBillAllocationInput & {
  ui_line_key?: string;
  ui_target_budget_id?: number;
};

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Creates a blank allocation row for the bill allocation form. */
export function createEmptyAllocationRow(): AllocationFormRow {
  return {
    budget_line: 0,
    amount: "",
    note: "",
    ui_line_key: "",
    ui_target_budget_id: undefined,
  };
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/** Returns default bill status filters — active (non-terminal) statuses only. */
export function defaultBillStatusFilters(statuses: string[]): string[] {
  const TERMINAL = new Set(["paid", "void"]);
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
