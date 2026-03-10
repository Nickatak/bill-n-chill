/**
 * Pure helpers for duplicate-candidate comparison during quick-add.
 *
 * Extracted from `duplicate-resolution-panel.tsx` so the matching logic
 * can be unit-tested independently of React rendering.
 */

import type { CustomerIntakePayload, DuplicateCustomerCandidate } from "../types";

/** Format a created_at timestamp for display. Falls back to the raw string on invalid dates. */
export function formatCreatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

/** Normalize a string for case-insensitive, whitespace-trimmed comparison. */
export function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Identify which fields match between a duplicate candidate and the submitted intake payload. */
export function matchedFields(
  candidate: DuplicateCustomerCandidate,
  payload: CustomerIntakePayload | null,
): string[] {
  if (!payload) {
    return [];
  }

  const matches: string[] = [];
  if (normalized(payload.phone) && normalized(candidate.phone) === normalized(payload.phone)) {
    matches.push("phone");
  }
  if (normalized(payload.email) && normalized(candidate.email) === normalized(payload.email)) {
    matches.push("email");
  }
  if (
    normalized(payload.full_name) &&
    normalized(candidate.display_name) === normalized(payload.full_name)
  ) {
    matches.push("name");
  }
  if (
    normalized(payload.project_address) &&
    normalized(candidate.billing_address) === normalized(payload.project_address)
  ) {
    matches.push("address");
  }

  return matches;
}
