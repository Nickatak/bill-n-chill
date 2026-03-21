/**
 * Derives a user-facing authentication status message for the quick-add form.
 *
 * The intake page can be loaded with a shared session token (e.g. a tablet
 * left on a job site). This hook decides whether to surface a warning about
 * missing or shared auth so the form can display it prominently.
 */

"use client";

type UseQuickAddAuthStatusArgs = {
  authToken: string;
  baseAuthMessage: string;
};

/**
 * Return the auth status message that should be displayed in the quick-add
 * form header, or an empty string when no message is needed.
 *
 * A "shared session" message (prefixed with "Using shared session for ") is
 * suppressed because it is informational, not actionable. A missing token
 * surfaces the base message so the user knows they need to sign in.
 */
export function useQuickAddAuthStatus({
  authToken,
  baseAuthMessage,
}: UseQuickAddAuthStatusArgs): string {
  // Shared-session banners are informational only — suppress them so the
  // form area stays clean for data entry.
  const effectiveBaseMessage = baseAuthMessage.startsWith("Using shared session for ")
    ? ""
    : baseAuthMessage;

  if (!authToken) {
    return effectiveBaseMessage;
  }

  return "";
}
