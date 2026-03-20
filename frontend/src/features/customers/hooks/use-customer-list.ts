import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { ProjectRecord } from "@/features/projects/types";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import type { ApiResponse, CustomerRow } from "../types";

type ActivityFilter = "all" | "active";
type ProjectFilter = "all" | "with_project";

type UseCustomerListOptions = {
  /** Called when a scoped customer (?customer=id) is found in the initial load. */
  onScopedCustomerFound?: (customer: CustomerRow) => void;
};

export function useCustomerList(token: string, options?: UseCustomerListOptions) {
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [projectsByCustomer, setProjectsByCustomer] = useState<Record<number, ProjectRecord[]>>({});
  const [query, setQuery] = useState("");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("active");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");

  const normalizedBaseUrl = useMemo(() => normalizeApiBaseUrl(defaultApiBaseUrl), []);
  const scopedCustomerIdParam = searchParams.get("customer");
  const scopedCustomerId =
    scopedCustomerIdParam && /^\d+$/.test(scopedCustomerIdParam) ? Number(scopedCustomerIdParam) : null;

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const inactive = Boolean(row.is_archived);
      const hasProject = row.has_project ?? (row.project_count ?? 0) > 0;

      const activityMatch =
        activityFilter === "all" || (activityFilter === "active" && !inactive);

      const projectMatch =
        projectFilter === "all" || (projectFilter === "with_project" && hasProject);

      return activityMatch && projectMatch;
    });
  }, [activityFilter, projectFilter, rows]);

  /** Fetch the customer list from the API, optionally filtered by search text. */
  async function loadCustomers(searchQuery: string, requestedPage: number) {
    setStatusMessage("");
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }
      params.set("page", String(requestedPage));
      params.set("page_size", "25");
      const url = `${normalizedBaseUrl}/customers/?${params.toString()}`;
      const response = await fetch(url, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse & { meta?: { page?: number; total_pages?: number; total_count?: number } } =
        await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load customers.");
        return;
      }

      const items = (payload.data as CustomerRow[]) ?? [];
      setRows(items);
      setTotalPages(payload.meta?.total_pages ?? 1);
      setTotalCount(payload.meta?.total_count ?? items.length);
      setPage(payload.meta?.page ?? requestedPage);
      if (scopedCustomerId) {
        const scopedCustomer = items.find((entry) => entry.id === scopedCustomerId);
        if (scopedCustomer) {
          options?.onScopedCustomerFound?.(scopedCustomer);
        }
      }
      setStatusMessage("");
    } catch {
      setStatusMessage("Could not reach customers endpoint.");
    }
  }

  /** Load all projects and group them by customer for the expandable project accordion. */
  async function loadProjectsIndex() {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: { data?: ProjectRecord[] } = await response.json();
      if (!response.ok) {
        return;
      }

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
      // best-effort for lookup UX; primary page still works without this index
    }
  }

  // Debounce customer search so the API isn't hit on every keystroke
  useEffect(() => {
    if (!token) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadCustomers(query, page);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, query, page, normalizedBaseUrl, scopedCustomerId, refreshKey]);

  // Fetch project index for the per-customer project accordion
  useEffect(() => {
    if (!token) {
      return;
    }
    void loadProjectsIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, normalizedBaseUrl, refreshKey]);

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  return {
    rows,
    setRows,
    filteredRows,
    projectsByCustomer,
    query,
    setQuery,
    activityFilter,
    setActivityFilter,
    projectFilter,
    setProjectFilter,
    page,
    setPage,
    totalPages,
    totalCount,
    statusMessage,
    setStatusMessage,
    scopedCustomerId,
    normalizedBaseUrl,
    refresh,
  };
}
