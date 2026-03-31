/**
 * Project-scoped data fetching for the change-orders console.
 *
 * Owns all server-side data that the change-orders console depends on:
 * project metadata, approved quotes, cost codes, audit events,
 * organization branding defaults, and the change-order list itself.
 *
 * Consumer: ChangeOrdersConsole (composed alongside useChangeOrderForm
 * and useChangeOrderViewer).
 *
 * ## State (useState)
 *
 * - selectedProjectId            — currently selected project ID string
 * - selectedProjectName          — display name of the selected project
 * - selectedProjectCustomerEmail — customer email from the selected project
 * - changeOrders                 — full change-order list for the selected project
 * - projectQuotes             — approved origin quotes for the selected project
 * - originQuoteOriginalTotals — map of quote ID to original grand total
 * - projectAuditEvents           — status events for change orders (fetched per-CO, merged)
 * - costCodes                    — active cost codes for line-item dropdowns
 * - organizationDefaults         — branding and default terms for document headers
 *
 * ## Functions
 *
 * - fetchProjectChangeOrders(projectId)
 *     GETs change orders for a project. Returns { rows, error }.
 *
 * - loadProjectQuotes(projectId)
 *     GETs quotes, filters to approved, enriches with approval metadata,
 *     writes into projectQuotes/originQuoteOriginalTotals state.
 *
 * - loadChangeOrderStatusEvents(changeOrderId)
 *     GETs status events for a CO, maps to AuditEventRecord shape, merges into projectAuditEvents.
 *
 * - loadCostCodes()
 *     GETs active cost codes, writes into costCodes.
 *
 * - loadOrganizationDefaults()
 *     GETs org branding, writes into organizationDefaults. Best-effort.
 *
 * - loadProjects(callbacks)
 *     Primary bootstrap: fetches projects, selects the scoped/first project,
 *     cascades into loadProjectQuotes + loadCostCodes
 *     + fetchProjectChangeOrders. Uses callbacks to coordinate with form state.
 *
 * ## Effect
 *
 * - Bootstrap effect: runs loadProjects on mount (when authToken is truthy).
 * - Org defaults effect: runs loadOrganizationDefaults on mount.
 *
 * @module
 */

import { useCallback, useEffect, useState } from "react";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import { readChangeOrderApiError } from "../helpers";
import type {
  ApiResponse,
  AuditEventRecord,
  ChangeOrderRecord,
  CostCodeOption,
  OrganizationDocumentDefaults,
  OriginQuoteLineItem,
  OriginQuoteRecord,
} from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadProjectsCallbacks = {
  /** Called after COs are loaded to hydrate the edit form. */
  onChangeOrdersLoaded: (
    changeOrders: ChangeOrderRecord[],
    initialOriginQuoteId: number | null,
  ) => void;
  /** Called when the CO list could not be fetched. */
  onChangeOrdersError: () => void;
  /** Called to reset the create form line items on project switch. */
  onProjectSwitch: () => void;
};

type UseChangeOrderProjectDataOptions = {
  authToken: string;
  scopedProjectId: number | null;
  initialOriginQuoteId: number | null;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch and manage all project-scoped data for the change-orders console.
 *
 * @param options.authToken              - Auth token for API requests.
 * @param options.scopedProjectId        - Pre-selected project ID (from URL param).
 * @param options.initialOriginQuoteId - Pre-selected quote ID (from URL param).
 * @returns Project data state, setters for cross-hook coordination, and data loaders.
 */
export function useChangeOrderProjectData({
  authToken,
  scopedProjectId,
  initialOriginQuoteId,
}: UseChangeOrderProjectDataOptions) {

  // --- State ---

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [selectedProjectStatus, setSelectedProjectStatus] = useState("");
  const [selectedProjectCustomerEmail, setSelectedProjectCustomerEmail] = useState("");
  const [selectedProjectCustomerId, setSelectedProjectCustomerId] = useState<number | null>(null);
  const [changeOrders, setChangeOrders] = useState<ChangeOrderRecord[]>([]);
  const [projectQuotes, setProjectQuotes] = useState<OriginQuoteRecord[]>([]);
  const [originQuoteOriginalTotals, setOriginQuoteOriginalTotals] = useState<
    Record<number, number>
  >({});
  const [projectAuditEvents, setProjectAuditEvents] = useState<AuditEventRecord[]>([]);
  const [costCodes, setCostCodes] = useState<CostCodeOption[]>([]);
  const [organizationDefaults, setOrganizationDefaults] =
    useState<OrganizationDocumentDefaults | null>(null);
  const [selectedViewerQuoteId, setSelectedViewerQuoteId] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"error" | "success" | "info">("info");

  // --- Functions ---

  /** Set the feedback banner message and tone. */
  const setFeedback = useCallback((message: string, tone: "error" | "success" | "info" = "info") => {
    setActionMessage(message);
    setActionTone(tone);
  }, []);

  /** Fetch change orders for a project. Returns { rows, error }. */
  const fetchProjectChangeOrders = useCallback(async (projectId: number) => {
    const response = await fetch(
      `${apiBaseUrl}/projects/${projectId}/change-orders/`,
      {
        headers: buildAuthHeaders(authToken),
      },
    );
    const payload: ApiResponse = await response.json();
    if (!response.ok) {
      return {
        rows: null as ChangeOrderRecord[] | null,
        error: readChangeOrderApiError(payload, "Could not load change orders."),
      };
    }
    return { rows: (payload.data as ChangeOrderRecord[]) ?? [], error: "" };
  }, [authToken]);

  /** Load approved quotes for a project, enriching with approval metadata. */
  const loadProjectQuotes = useCallback(async (projectId: number) => {
    try {
      const response = await fetch(`${apiBaseUrl}/projects/${projectId}/quotes/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setProjectQuotes([]);
        return;
      }
      const rows =
        (payload.data as Array<{
          id: number;
          title: string;
          version: number;
          status?: string;
          grand_total?: string;
          line_items?: OriginQuoteLineItem[];
        }>) ?? [];
      const approvedRows = rows.filter((quote) => quote.status === "approved");
      const approvedRowsWithMeta: OriginQuoteRecord[] = await Promise.all(
        approvedRows.map(async (quote) => {
          const base = {
            id: quote.id,
            title: quote.title,
            version: quote.version,
            grand_total: quote.grand_total ?? "0.00",
            line_items: quote.line_items ?? [],
          };
          try {
            const response = await fetch(
              `${apiBaseUrl}/quotes/${quote.id}/status-events/`,
              {
                headers: buildAuthHeaders(authToken),
              },
            );
            const payload: ApiResponse = await response.json();
            if (!response.ok) {
              return {
                ...base,
                approved_at: null,
                approved_by_email: null,
              };
            }
            const events =
              (payload.data as Array<{
                to_status?: string;
                changed_at?: string;
                changed_by_email?: string;
              }>) ?? [];
            const approvedEvent = [...events]
              .reverse()
              .find((event) => event.to_status === "approved");
            return {
              ...base,
              approved_at: approvedEvent?.changed_at ?? null,
              approved_by_email: approvedEvent?.changed_by_email ?? null,
            };
          } catch {
            return {
              ...base,
              approved_at: null,
              approved_by_email: null,
            };
          }
        }),
      );
      const preferredQuoteId =
        initialOriginQuoteId &&
        approvedRowsWithMeta.some((quote) => quote.id === initialOriginQuoteId)
          ? String(initialOriginQuoteId)
          : "";
      setProjectQuotes(approvedRowsWithMeta);
      const totalsMap: Record<number, number> = {};
      for (const est of approvedRowsWithMeta) {
        totalsMap[est.id] = parseFloat(est.grand_total) || 0;
      }
      setOriginQuoteOriginalTotals(totalsMap);
      setSelectedViewerQuoteId((current) => {
        if (preferredQuoteId) {
          return preferredQuoteId;
        }
        if (current && approvedRowsWithMeta.some((quote) => String(quote.id) === current)) {
          return current;
        }
        return approvedRowsWithMeta[0] ? String(approvedRowsWithMeta[0].id) : "";
      });
    } catch {
      setProjectQuotes([]);
      setSelectedViewerQuoteId("");
    }
  }, [initialOriginQuoteId, authToken]);

  /** Load status events for a single change order and merge into projectAuditEvents. */
  const loadChangeOrderStatusEvents = useCallback(async (changeOrderId: number) => {
    try {
      const response = await fetch(`${apiBaseUrl}/change-orders/${changeOrderId}/status-events/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload = await response.json();
      if (!response.ok || !payload.data) return;
      const events = (payload.data as Array<{
        id: number;
        change_order: number;
        from_status: string;
        to_status: string;
        note: string;
        changed_by: number;
        changed_by_email: string | null;
        changed_by_display?: string | null;
        changed_by_customer_id?: number | null;
        changed_at: string;
        action_type: string;
      }>).map((event) => ({
        id: event.id,
        event_type: "change_order_updated",
        object_type: "change_order",
        object_id: event.change_order,
        from_status: event.from_status,
        to_status: event.to_status,
        note: event.note,
        metadata_json: { status_action: event.action_type },
        created_by: event.changed_by,
        created_by_email: event.changed_by_email,
        created_by_display: event.changed_by_display,
        created_by_customer_id: event.changed_by_customer_id,
        created_at: event.changed_at,
      } satisfies AuditEventRecord));
      // Merge: replace events for this CO, keep events for other COs
      setProjectAuditEvents((prev) => [
        ...prev.filter((e) => e.object_id !== changeOrderId),
        ...events,
      ]);
    } catch {
      // silent — events are non-critical
    }
  }, [authToken]);

  /** Load active cost codes. */
  const loadCostCodes = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/cost-codes/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setCostCodes([]);
        return;
      }
      const rows = ((payload.data as CostCodeOption[]) ?? []).filter((c) => c.is_active);
      setCostCodes(rows);
    } catch {
      setCostCodes([]);
    }
  }, [authToken]);

  /** Load organization branding defaults. Best-effort — failures are silently ignored. */
  const loadOrganizationDefaults = useCallback(async () => {
    if (!authToken) {
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/organization/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        return;
      }
      const organizationData = (
        payload.data as { organization?: OrganizationDocumentDefaults } | undefined
      )?.organization;
      if (organizationData) {
        setOrganizationDefaults(organizationData);
      }
      return organizationData ?? null;
    } catch {
      // Branding defaults are best-effort; change order workflows can continue.
      return null;
    }
  }, [authToken]);

  /**
   * Bootstrap the console: fetch projects, select the scoped/first project,
   * cascade into all dependent data loads.
   */
  const loadProjects = useCallback(async (callbacks: LoadProjectsCallbacks) => {
    if (!authToken) {
      return;
    }
    setFeedback("");
    try {
      const response = await fetch(`${apiBaseUrl}/projects/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Could not load projects."), "error");
        return;
      }
      const rows = (payload.data as Array<{ id: number; name: string; status?: string; customer?: number; customer_email?: string }>) ?? [];
      callbacks.onProjectSwitch();
      if (rows[0]) {
        const scopedMatch = scopedProjectId
          ? rows.find((project) => project.id === scopedProjectId)
          : null;
        const nextProject = scopedMatch ?? rows[0];
        const scopeFallbackNote =
          scopedProjectId && !scopedMatch
            ? ` Project #${scopedProjectId} was not found in scope; defaulted to #${nextProject.id}.`
            : "";
        setSelectedProjectId(String(nextProject.id));
        setSelectedProjectName(nextProject.name || "");
        setSelectedProjectStatus(nextProject.status || "");
        setSelectedProjectCustomerEmail(nextProject.customer_email || "");
        setSelectedProjectCustomerId(nextProject.customer ?? null);
        setProjectAuditEvents([]);
        await Promise.all([
          loadProjectQuotes(nextProject.id),
          loadCostCodes(),
        ]);
        const { rows: changeOrderRows, error } = await fetchProjectChangeOrders(nextProject.id);
        if (!changeOrderRows) {
          setChangeOrders([]);
          callbacks.onChangeOrdersError();
          setFeedback(`${error}${scopeFallbackNote}`, "error");
          return;
        }
        setChangeOrders(changeOrderRows);
        callbacks.onChangeOrdersLoaded(changeOrderRows, initialOriginQuoteId);
        setFeedback("");
      } else {
        setSelectedProjectId("");
        setSelectedProjectName("");
        setSelectedProjectStatus("");
        setSelectedProjectCustomerEmail("");
        setOriginQuoteOriginalTotals({});
        setProjectQuotes([]);
        setProjectAuditEvents([]);
        setChangeOrders([]);
        callbacks.onChangeOrdersError();
        setFeedback("No projects found.", "info");
      }
    } catch {
      setFeedback("Could not reach projects endpoint.", "error");
    }
  }, [
    fetchProjectChangeOrders,
    initialOriginQuoteId,
    loadCostCodes,
    loadProjectQuotes,
    scopedProjectId,
    setFeedback,
    authToken,
  ]);

  // --- Effects ---

  /** Effect: Org defaults — load organization branding defaults on mount. */
  useEffect(() => {
    if (!authToken) {
      return;
    }
    const run = window.setTimeout(() => {
      void loadOrganizationDefaults();
    }, 0);
    return () => window.clearTimeout(run);
  }, [loadOrganizationDefaults, authToken]);

  // --- Return bag ---

  return {
    // State
    selectedProjectId,
    selectedProjectName,
    selectedProjectStatus,
    selectedProjectCustomerEmail,
    selectedProjectCustomerId,
    changeOrders,
    projectQuotes,
    originQuoteOriginalTotals,
    projectAuditEvents,
    costCodes,
    organizationDefaults,
    selectedViewerQuoteId,
    actionMessage,
    actionTone,

    // Setters
    setChangeOrders,
    setSelectedViewerQuoteId,
    setFeedback,

    // Helpers
    fetchProjectChangeOrders,
    loadProjectQuotes,
    loadChangeOrderStatusEvents,
    loadCostCodes,
    loadOrganizationDefaults,
    loadProjects,
  };
}

export type { LoadProjectsCallbacks };
