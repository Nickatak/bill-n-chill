/**
 * Date formatting utilities for consistent human-readable date display.
 *
 * All formatters accept nullable/undefined inputs and return a safe fallback,
 * so callers never need to guard against missing dates.
 */

/**
 * Format a date-only ISO string (e.g. "2024-06-15") for display.
 *
 * Appends `T00:00:00` before parsing to avoid timezone-offset shifts that
 * occur when `new Date()` parses a bare YYYY-MM-DD string as UTC.
 */
export function formatDateDisplay(
  dateValue?: string | null,
  fallback = "TBD",
): string {
  if (!dateValue) {
    return fallback;
  }
  const parsed = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

/**
 * Format a full ISO datetime string (e.g. "2024-06-15T14:30:00Z") for display,
 * including both the date and a short time component.
 */
export function formatDateTimeDisplay(
  dateValue?: string | null,
  fallback = "--",
): string {
  if (!dateValue) {
    return fallback;
  }
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

/**
 * Convert an ISO datetime string to a `YYYY-MM-DD` value suitable for
 * `<input type="date">` elements.
 *
 * Returns an empty string for missing or unparseable values so the input
 * renders blank rather than showing an invalid date.
 */
export function formatDateInputFromIso(dateValue?: string | null): string {
  if (!dateValue) {
    return "";
  }
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Date-input value helpers (YYYY-MM-DD strings for <input type="date">)
// ---------------------------------------------------------------------------

/** Today's date as a YYYY-MM-DD string for date inputs and API payloads. */
export function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A date N days from now as YYYY-MM-DD (defaults to 30 days). */
export function futureDateInput(daysFromNow = 30): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

/**
 * Add (or subtract) days from a YYYY-MM-DD base date, returning YYYY-MM-DD.
 *
 * Returns an empty string if the base date is malformed or unparseable,
 * so callers can treat it as "no date" in form inputs.
 */
export function addDaysToDateInput(baseDateInput: string, daysToAdd: number): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseDateInput);
  if (!matched) {
    return "";
  }
  const normalized = new Date(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])));
  if (Number.isNaN(normalized.getTime())) {
    return "";
  }
  normalized.setUTCDate(normalized.getUTCDate() + daysToAdd);
  return normalized.toISOString().slice(0, 10);
}
