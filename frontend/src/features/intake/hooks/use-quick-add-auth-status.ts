"use client";

type UseQuickAddAuthStatusArgs = {
  token: string;
  baseAuthMessage: string;
};

export function useQuickAddAuthStatus({
  token,
  baseAuthMessage,
}: UseQuickAddAuthStatusArgs): string {
  const effectiveBaseMessage = baseAuthMessage.startsWith("Using shared session for ")
    ? ""
    : baseAuthMessage;
  if (!token) {
    return effectiveBaseMessage;
  }
  return "";
}
