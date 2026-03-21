/**
 * Customer list data fetching hook.
 *
 * Owns the server-side customer list: paginated fetching, search query,
 * and status messaging. Exposes row data and setters so sibling hooks
 * (editor, project creator) can read and optimistically update the list.
 *
 * Consumer: CustomersConsole (composed alongside useCustomerFilters
 * and useProjectsByCustomer).
 *
 * ## State (useState)
 *
 * - customerRows   — current page of CustomerRow records from the server
 * - query          — search text; drives debounced fetch via the effect
 * - page           — current page number (1-based)
 * - totalPages     — server-reported total page count
 * - totalCount     — server-reported total customer count
 * - statusMessage  — error/success string; shared with editor + creator
 * - refreshKey     — counter; bumping it forces re-fetch (see refresh())
 *
 * ## Functions
 *
 * - loadCustomers(searchQuery, requestedPage)
 *     Builds query params, GETs /customers/, writes results into state.
 *     On error sets statusMessage and bails. Not called directly —
 *     invoked by the effect.
 *
 * - refresh()
 *     Increments refreshKey, which triggers the effect. Consumers call
 *     this after mutations (quick-add, edit) to reload the list.
 *
 * ## Effect (the engine)
 *
 * Deps: [authToken, query, page, refreshKey]
 *
 * On any dep change: sets a 250ms timer that calls loadCustomers.
 * Returns a cleanup that clears the timer — this is the debounce.
 * Rapid query changes cancel pending fetches so only the last fires.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import { useEffect, useState } from "react";

import type { CustomerRow, PaginatedCustomerResponse } from "../types";

/**
 * Fetch and paginate the customer list from the server.
 *
 * @param authToken - Auth token for API requests.
 * @returns Row data, pagination controls, search state, status message,
 *          and a `refresh()` function to force a re-fetch.
 */
export function useCustomerListFetch(authToken: string) {

  // --- State ---

  const [customerRows, setCustomerRows] = useState<CustomerRow[]>([]);
  const [query, setQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // --- Functions ---

  /** Fetch a page of customers from the API, optionally filtered by search text. */
  async function loadCustomers(searchQuery: string, requestedPage: number) {
    setStatusMessage("");
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }
      params.set("page", String(requestedPage));
      params.set("page_size", "25");

      const response = await fetch(`${apiBaseUrl}/customers/?${params.toString()}`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: PaginatedCustomerResponse = await response.json();

      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load customers.");
        return;
      }

      const customers = (payload.data as CustomerRow[]) ?? [];
      setCustomerRows(customers);
      setTotalPages(payload.pagination_metadata?.total_pages ?? 1);
      setTotalCount(payload.pagination_metadata?.total_count ?? customers.length);
      setPage(payload.pagination_metadata?.page ?? requestedPage);
    } catch {
      setStatusMessage("Could not reach customers endpoint.");
    }
  }

  // --- Effects ---

  /** Effect: debounced fetch — loads customers 250ms after query/page/refreshKey changes. */
  useEffect(() => {
    if (!authToken) return;
    const timer = window.setTimeout(() => {
      void loadCustomers(query, page);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, query, page, refreshKey]);

  // --- Exposed helpers ---

  /** Bump the refresh key to force the effect to re-run. */
  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  // --- Return bag ---

  return {
    // State
    customerRows,
    query,
    page,
    totalPages,
    totalCount,
    statusMessage,

    // Setters
    setCustomerRows,
    setQuery,
    setPage,
    setStatusMessage,

    // Helpers
    refresh,
  };
}
