/**
 * Pure helper functions for the change-orders feature.
 *
 * Extracted from component files so they can be unit-tested directly.
 * None of these touch React state or DOM — they're plain data transforms.
 */

import { readApiErrorMessage } from "@/shared/api/error";
import type {
  ApiResponse,
  ChangeOrderLineInput,
  ChangeOrderRecord,
  LineValidationIssue,
} from "./types";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Check whether a string is a valid finite numeric value. */
export function isFiniteNumericInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed);
}

type LineValidationResult = {
  issues: LineValidationIssue[];
  issuesByLocalId: Map<number, string[]>;
};

/** Validate change-order line items for completeness. */
export function validateLineItems(lines: ChangeOrderLineInput[]): LineValidationResult {
  const issues: LineValidationIssue[] = [];
  const issuesByLocalId = new Map<number, string[]>();
  lines.forEach((line, index) => {
    const rowNumber = index + 1;
    const rowIssues: string[] = [];
    const budgetLineId = line.budgetLineId.trim();

    if (!budgetLineId) {
      rowIssues.push("Select a budget line.");
    }

    if (line.lineType === "adjustment" && !line.adjustmentReason.trim()) {
      rowIssues.push("Adjustment lines require a reason.");
    }

    if (!isFiniteNumericInput(line.amountDelta)) {
      rowIssues.push("Amount delta must be a number.");
    }

    if (!isFiniteNumericInput(line.daysDelta) || !Number.isInteger(Number(line.daysDelta))) {
      rowIssues.push("Days delta must be a whole number.");
    }

    if (!rowIssues.length) {
      return;
    }

    issuesByLocalId.set(line.localId, rowIssues);
    for (const message of rowIssues) {
      issues.push({
        localId: line.localId,
        rowNumber,
        message,
      });
    }
  });

  return {
    issues,
    issuesByLocalId,
  };
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Create a blank change-order line item with sensible defaults. */
export function emptyLine(localId: number): ChangeOrderLineInput {
  return {
    localId,
    lineType: "scope",
    adjustmentReason: "",
    budgetLineId: "",
    description: "",
    amountDelta: "0.00",
    daysDelta: "0",
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Generate a default change-order title from the project name. */
export function defaultChangeOrderTitle(projectName?: string): string {
  const trimmed = (projectName || "").trim();
  if (!trimmed) {
    return "Change Order";
  }
  return `Change Order: ${trimmed}`;
}

/** Build a human-readable label like "CO-3 v2" for a change order. */
export function coLabel(changeOrder: Pick<ChangeOrderRecord, "family_key" | "revision_number">): string {
  return `CO-${changeOrder.family_key} v${changeOrder.revision_number}`;
}

/** Build the public-facing change-order URL for a viewer link. */
export function publicChangeOrderHref(publicRef?: string): string {
  if (!publicRef) {
    return "";
  }
  return `/change-order/${publicRef}`;
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/** Enrich API error messages with change-order-specific context for status transition failures. */
export function readChangeOrderApiError(
  payload: ApiResponse | undefined,
  fallback: string,
): string {
  const message = readApiErrorMessage(payload, fallback);
  if (/invalid .*status transition/i.test(message) && !/refresh/i.test(message)) {
    return `${message} This change order may have changed from a client action on the public page. Refresh to load the latest status.`;
  }
  return message;
}
