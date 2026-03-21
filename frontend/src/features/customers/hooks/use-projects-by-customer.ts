/**
 * Project-by-customer index for the customer list accordion.
 *
 * Fetches all projects and groups them by customer ID so each customer
 * row can render an expandable project list. Best-effort — the customer
 * list still functions if this fails.
 *
 * Consumer: CustomersConsole (composed alongside useCustomerListFetch
 * and useCustomerFilters).
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import { useEffect, useState } from "react";

import type { ProjectRecord } from "@/features/projects/types";

/**
 * Fetch all projects and group them by customer ID.
 *
 * @param authToken - Auth token for API requests.
 * @returns `projectsByCustomer` map and a `refresh()` to force re-fetch.
 */
export function useProjectsByCustomer(authToken: string) {

  // --- State ---

  const [projectsByCustomer, setProjectsByCustomer] = useState<Record<number, ProjectRecord[]>>({});
  const [refreshKey, setRefreshKey] = useState(0);

  // --- Functions ---

  /** Fetch all projects and build a customer-ID-keyed map, sorted newest first. */
  async function loadProjectsIndex() {
    try {
      const response = await fetch(`${apiBaseUrl}/projects/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: { data?: ProjectRecord[] } = await response.json();
      if (!response.ok) return;

      const projectRows = payload.data ?? [];
      const nextMap: Record<number, ProjectRecord[]> = {};
      for (const project of projectRows) {
        if (!nextMap[project.customer]) {
          nextMap[project.customer] = [];
        }
        nextMap[project.customer].push(project);
      }
      for (const key of Object.keys(nextMap)) {
        nextMap[Number(key)].sort((a, b) => b.id - a.id);
      }
      setProjectsByCustomer(nextMap);
    } catch {
      // Best-effort — the customer list still works without this index.
    }
  }

  // --- Effects ---

  /** Effect: project index fetch — reloads when authToken or refreshKey changes. */
  useEffect(() => {
    if (!authToken) return;
    void loadProjectsIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, refreshKey]);

  // --- Exposed helpers ---

  /** Bump the refresh key to force the effect to re-run. */
  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  // --- Return bag ---

  return {
    // State
    projectsByCustomer,

    // Helpers
    refresh,
  };
}
