/**
 * Shared hook for fetching and normalizing backend policy contracts.
 *
 * All document consoles (estimates, invoices, change orders, vendor bills)
 * follow the same pattern: fetch a policy contract endpoint, validate the
 * shape, normalize status transitions, and merge labels with fallbacks.
 * This hook extracts that common lifecycle.
 *
 * Domain-specific post-load logic (e.g. updating filter state, deriving
 * shortcut statuses) is handled via the `onLoaded` callback, which receives
 * both the raw contract and the normalized base policy.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimum shape every policy contract shares. */
export type PolicyContractBase = {
  statuses: string[];
  status_labels: Record<string, string>;
  allowed_status_transitions: Record<string, string[]>;
  default_create_status: string;
  terminal_statuses?: string[];
};

/** Normalized policy values returned by the hook. */
export type NormalizedPolicy = {
  statuses: string[];
  statusLabels: Record<string, string>;
  allowedTransitions: Record<string, string[]>;
  defaultCreateStatus: string;
};

export type UsePolicyContractConfig<TContract extends PolicyContractBase> = {
  /** API fetch function — must return a Response. */
  fetchContract: (params: { baseUrl: string; token: string }) => Promise<Response>;
  /** Fallback statuses used before the contract loads and as merge base. */
  fallbackStatuses: string[];
  /** Fallback labels merged under contract labels. */
  fallbackLabels: Record<string, string>;
  /** Fallback transitions used before the contract loads. */
  fallbackTransitions: Record<string, string[]>;
  /** API base URL (normalized). */
  baseUrl: string;
  /** Auth token. */
  token: string;
  /**
   * Called after a successful contract load with the raw contract and the
   * normalized base policy. Use this for domain-specific state updates
   * (e.g. adjusting filters, extracting quick-action maps).
   *
   * Stored in a ref internally — safe to define inline without memoization.
   */
  onLoaded?: (contract: TContract, base: NormalizedPolicy) => void;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePolicyContract<TContract extends PolicyContractBase>(
  config: UsePolicyContractConfig<TContract>,
): NormalizedPolicy {
  const {
    fetchContract,
    fallbackStatuses,
    fallbackLabels,
    fallbackTransitions,
    baseUrl,
    token,
  } = config;

  const [policy, setPolicy] = useState<NormalizedPolicy>({
    statuses: fallbackStatuses,
    statusLabels: fallbackLabels,
    allowedTransitions: fallbackTransitions,
    defaultCreateStatus: fallbackStatuses[0] ?? "draft",
  });

  // Store onLoaded in a ref so inline callbacks don't trigger re-fetches.
  const onLoadedRef = useRef(config.onLoaded);
  useEffect(() => { onLoadedRef.current = config.onLoaded; });

  // Store fallbacks in refs to avoid re-fetch on object identity changes.
  const fallbackStatusesRef = useRef(fallbackStatuses);
  const fallbackLabelsRef = useRef(fallbackLabels);
  useEffect(() => {
    fallbackStatusesRef.current = fallbackStatuses;
    fallbackLabelsRef.current = fallbackLabels;
  });

  const loadPolicy = useCallback(async () => {
    try {
      const response = await fetchContract({ baseUrl, token });
      const payload = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        return;
      }

      const contract = payload.data as TContract;
      if (
        !Array.isArray(contract.statuses) ||
        !contract.statuses.length ||
        !contract.allowed_status_transitions
      ) {
        return;
      }

      // Normalize transitions.
      const allowedTransitions: Record<string, string[]> = {};
      for (const status of contract.statuses) {
        const next = contract.allowed_status_transitions[status];
        allowedTransitions[status] = Array.isArray(next) ? next : [];
      }

      const defaultCreateStatus =
        contract.default_create_status ||
        contract.statuses[0] ||
        fallbackStatusesRef.current[0];

      const base: NormalizedPolicy = {
        statuses: contract.statuses,
        statusLabels: {
          ...fallbackLabelsRef.current,
          ...(contract.status_labels || {}),
        },
        allowedTransitions,
        defaultCreateStatus,
      };

      setPolicy(base);
      onLoadedRef.current?.(contract, base);
    } catch {
      // Policy load is best-effort; static fallback remains active.
    }
  }, [fetchContract, baseUrl, token]);

  useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

  return policy;
}
