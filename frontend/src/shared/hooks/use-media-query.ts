"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Returns true when the given CSS media query matches. Updates on resize/orientation change. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  // SSR fallback: always false (mobile cards won't flash on hydration since
  // the server renders the desktop table, then the client swaps if needed).
  const getServerSnapshot = useCallback(() => false, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
