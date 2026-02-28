/**
 * Shared money-formatting utilities.
 *
 * Centralises the two display flavours used across the app: plain decimal
 * strings for form inputs and table cells ("1234.56") and locale-aware
 * currency strings for financial summaries ("$1,234.56").
 */

/** Parse a decimal string to a finite number, returning 0 for non-finite or missing values. */
export function parseAmount(value?: string): number {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Format a number as a plain two-decimal string (e.g. "1234.56"). */
export function formatDecimal(value: number): string {
  return value.toFixed(2);
}

/** Format a number as a US-locale currency string (e.g. "$1,234.56"). */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
