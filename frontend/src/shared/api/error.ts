/**
 * Shared API error extraction.
 *
 * Provides a single utility for pulling a human-readable message out of
 * the standard `{ error: { message, fields } }` envelope returned by
 * the Django REST API on validation or business-rule failures.
 */

type ApiErrorPayload = {
  error?: {
    message?: string;
    fields?: Record<string, string[]>;
  };
};

/**
 * Extract a user-facing error message from an API error response.
 *
 * Checks the top-level `error.message` first, then falls back to the
 * first non-empty field-level message. Returns the provided fallback
 * if no usable message is found.
 */
export function readApiErrorMessage(payload: ApiErrorPayload | undefined, fallback: string): string {
  const topLevelMessage = payload?.error?.message?.trim();
  if (topLevelMessage) {
    return topLevelMessage;
  }

  const fieldEntries = Object.entries(payload?.error?.fields ?? {});
  for (const [fieldName, fieldMessages] of fieldEntries) {
    if (!Array.isArray(fieldMessages)) {
      continue;
    }
    const first = fieldMessages.find((m) => Boolean((m || "").trim()));
    if (first) {
      return `${fieldName}: ${first}`;
    }
  }

  return fallback;
}
