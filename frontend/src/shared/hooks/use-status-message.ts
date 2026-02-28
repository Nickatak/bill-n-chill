/**
 * Shared hook for the status-message + tone pattern used across console components.
 *
 * Most consoles display a single feedback message (loading, success, error) with
 * a tone that drives styling. This hook encapsulates the state pair and provides
 * convenient setters so consumers don't need to coordinate two useState calls.
 */
"use client";

import { useCallback, useState } from "react";

export type StatusTone = "neutral" | "success" | "error";

/** Manages a status message string paired with a display tone. */
export function useStatusMessage(initialMessage = "") {
  const [message, setMessage] = useState(initialMessage);
  const [tone, setTone] = useState<StatusTone>("neutral");

  const setNeutral = useCallback((msg: string) => {
    setTone("neutral");
    setMessage(msg);
  }, []);

  const setSuccess = useCallback((msg: string) => {
    setTone("success");
    setMessage(msg);
  }, []);

  const setError = useCallback((msg: string) => {
    setTone("error");
    setMessage(msg);
  }, []);

  const clear = useCallback(() => {
    setTone("neutral");
    setMessage("");
  }, []);

  return { message, tone, setMessage, setNeutral, setSuccess, setError, clear };
}
