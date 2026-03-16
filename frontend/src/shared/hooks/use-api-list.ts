/**
 * Generic hook for fetching and managing a list of items from the API.
 *
 * Encapsulates the fetch → parse → store → auto-select → status-message
 * cycle that every console component repeats. Consumers supply the endpoint
 * and get back a ready-to-render item list with selection and status state.
 *
 * Does NOT own pagination, search, or client-side filtering — those stay
 * with the consumer as post-fetch concerns.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/shared/api/base";
import { useStatusMessage } from "./use-status-message";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UseApiListConfig<T> = {
  /** API endpoint path, e.g. "/projects/5/invoices/". Must include leading slash. */
  endpoint: string;
  /** Auth token from session. Fetch is skipped when empty. */
  token: string;
  /** Skip automatic fetching when false (e.g. waiting for a project selection). Default true. */
  enabled?: boolean;
  /** Domain-specific error reader. Falls back to `payload.error?.message`. */
  readError?: (payload: unknown, fallback: string) => string;
  /** Re-select the previous item if it still exists after reload. Default true. */
  autoSelect?: boolean;
  /** Extract a stable string ID from an item. Default: `String(item.id)`. */
  getId?: (item: T) => string;
  /** Called after a successful fetch with the new items. Use for post-load side effects. */
  onSuccess?: (items: T[]) => void;
};

type ApiPayload = {
  data?: unknown;
  error?: { message?: string };
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const normalizedBase = normalizeApiBaseUrl(defaultApiBaseUrl);

function defaultGetId<T>(item: T): string {
  return String((item as Record<string, unknown>).id);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useApiList<T>(config: UseApiListConfig<T>) {
  const {
    endpoint,
    token,
    enabled = true,
    autoSelect = true,
  } = config;

  const [items, setItems] = useState<T[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const { setNeutral, setError, clear, ...statusRest } = useStatusMessage();

  // Refs for values used inside the load callback that shouldn't trigger
  // re-creation (they change identity on every render but not semantics).
  // Synced via useEffect to comply with React 19's no-ref-writes-during-render rule.
  const readErrorRef = useRef(config.readError);
  const getIdRef = useRef(config.getId ?? defaultGetId);
  const autoSelectRef = useRef(autoSelect);
  const onSuccessRef = useRef(config.onSuccess);

  useEffect(() => {
    readErrorRef.current = config.readError;
    getIdRef.current = config.getId ?? defaultGetId;
    autoSelectRef.current = autoSelect;
    onSuccessRef.current = config.onSuccess;
  });

  const load = useCallback(
    async (): Promise<T[]> => {
      if (!token) return [];

      setNeutral("Loading\u2026");
      try {
        const response = await fetch(`${normalizedBase}${endpoint}`, {
          headers: buildAuthHeaders(token),
        });
        const payload: ApiPayload = await response.json();

        if (!response.ok) {
          const msg = readErrorRef.current
            ? readErrorRef.current(payload, "Failed to load.")
            : (payload.error?.message ?? "Failed to load.");
          setError(msg);
          return [];
        }

        const rows = (payload.data as T[]) ?? [];
        setItems(rows);

        if (autoSelectRef.current) {
          const getId = getIdRef.current;
          setSelectedId((current) => {
            if (current && rows.some((row) => getId(row) === current)) return current;
            return rows.length ? getId(rows[0]) : "";
          });
        }

        clear();
        onSuccessRef.current?.(rows);
        return rows;
      } catch {
        setError("Could not reach the server.");
        return [];
      }
    },
    [endpoint, token, setNeutral, setError, clear],
  );

  // Auto-fetch when token, endpoint, or enabled state changes.
  useEffect(() => {
    if (!token || !enabled) return;
    void load();
  }, [load, token, enabled]);

  return {
    /** Current list of items from the last successful fetch. */
    items,
    /** Directly replace the items array (useful for optimistic updates after mutations). */
    setItems,
    /** Currently selected item ID (string). Empty string when nothing is selected. */
    selectedId,
    /** Manually set the selected item ID. */
    setSelectedId,
    /** Re-fetch the list. Returns the new items array. */
    refresh: load,
    /** Status message state — exposes message, tone, setNeutral, setSuccess, setError, clear. */
    status: { setNeutral, setError, clear, ...statusRest },
  };
}
