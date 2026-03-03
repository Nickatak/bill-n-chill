/**
 * Shared financial-baseline status helpers.
 *
 * Used across estimates and change orders to derive and format the
 * baseline status of an estimate (none | active | superseded).
 */

export type FinancialBaselineStatusValue = "none" | "active" | "superseded";

/** Minimal shape required for baseline status derivation. */
type BaselineRecord = {
  is_active_financial_baseline?: boolean;
  financial_baseline_status?: string;
};

/** Derive the financial-baseline status for a record (none | active | superseded). */
export function financialBaselineStatus(
  record?: BaselineRecord | null,
): FinancialBaselineStatusValue {
  if (!record) {
    return "none";
  }
  if (record.is_active_financial_baseline) {
    return "active";
  }
  const status = record.financial_baseline_status;
  if (status === "active" || status === "superseded") {
    return status;
  }
  return "none";
}

/** Return a display label for a financial-baseline status. */
export function formatFinancialBaselineStatus(status: FinancialBaselineStatusValue): string {
  if (status === "active") {
    return "Active Estimate";
  }
  if (status === "superseded") {
    return "Superseded Estimate";
  }
  return "";
}
