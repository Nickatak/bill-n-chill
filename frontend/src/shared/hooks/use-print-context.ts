/**
 * Shared hook for print-context management in public document previews.
 *
 * Captures a human-readable "printed at" timestamp on mount and refreshes
 * it before each browser print. Blanks `document.title` during print so
 * the browser header/footer doesn't leak the app URL, then restores it.
 */
"use client";

import { useEffect, useState } from "react";

/** Format the current time as a compact "printed at" label. */
function formatPrintedAt(): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
}

/** Manages print timestamp and document-title blanking for public document previews. */
export function usePrintContext() {
  const [printTimestamp, setPrintTimestamp] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const titleBeforeMount = document.title;

    const refreshTimestamp = () => {
      setPrintTimestamp(formatPrintedAt());
    };

    const handleBeforePrint = () => {
      refreshTimestamp();
      document.title = "";
    };

    const handleAfterPrint = () => {
      document.title = titleBeforeMount;
    };

    // Set initial timestamp immediately.
    refreshTimestamp();
    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", handleAfterPrint);
      document.title = titleBeforeMount;
    };
  }, []);

  return { printTimestamp };
}
