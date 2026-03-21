/**
 * Project-scoped data fetching for the change-orders console.
 *
 * Owns all server-side data that the change-orders console depends on:
 * project metadata, approved estimates, cost codes, audit events,
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
 * - projectEstimates             — approved origin estimates for the selected project
 * - originEstimateOriginalTotals — map of estimate ID to original grand total
 * - projectAuditEvents           — audit events for the selected project
 * - costCodes                    — active cost codes for line-item dropdowns
 * - organizationDefaults         — branding and default terms for document headers
 *
 * ## Functions
 *
 * - fetchProjectChangeOrders(projectId)
 *     GETs change orders for a project. Returns { rows, error }.
 *
 * - loadProjectEstimates(projectId)
 *     GETs estimates, filters to approved, enriches with approval metadata,
 *     writes into projectEstimates/originEstimateOriginalTotals state.
 *
 * - loadProjectAuditEvents(projectId)
 *     GETs audit events for a project, writes into projectAuditEvents.
 *
 * - loadCostCodes()
 *     GETs active cost codes, writes into costCodes.
 *
 * - loadOrganizationDefaults()
 *     GETs org branding, writes into organizationDefaults. Best-effort.
 *
 * - loadProjects(callbacks)
 *     Primary bootstrap: fetches projects, selects the scoped/first project,
 *     cascades into loadProjectEstimates + loadProjectAuditEvents + loadCostCodes
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
  OriginEstimateLineItem,
  OriginEstimateRecord,
} from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadProjectsCallbacks = {
  /** Called after COs are loaded to hydrate the edit form. */
  onChangeOrdersLoaded: (
    changeOrders: ChangeOrderRecord[],
    initialOriginEstimateId: number | null,
  ) => void;
  /** Called when the CO list could not be fetched. */
  onChangeOrdersError: () => void;
  /** Called to reset the create form line items on project switch. */
  onProjectSwitch: () => void;
};

type UseChangeOrderProjectDataOptions = {
  authToken: string;
  scopedProjectId: number | null;
  initialOriginEstimateId: number | null;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch and manage all project-scoped data for the change-orders console.
 *
 * @param options.authToken              - Auth token for API requests.
 * @param options.scopedProjectId        - Pre-selected project ID (from URL param).
 * @param options.initialOriginEstimateId - Pre-selected estimate ID (from URL param).
 * @returns Project data state, setters for cross-hook coordination, and data loaders.
 */
export function useChangeOrderProjectData({
  authToken,
  scopedProjectId,
  initialOriginEstimateId,
}: UseChangeOrderProjectDataOptions) {

  // --- State ---

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [selectedProjectStatus, setSelectedProjectStatus] = useState("");
  const [selectedProjectCustomerEmail, setSelectedProjectCustomerEmail] = useState("");
  const [changeOrders, setChangeOrders] = useState<ChangeOrderRecord[]>([]);
  const [projectEstimates, setProjectEstimates] = useState<OriginEstimateRecord[]>([]);
  const [originEstimateOriginalTotals, setOriginEstimateOriginalTotals] = useState<
    Record<number, number>
  >({});
  const [projectAuditEvents, setProjectAuditEvents] = useState<AuditEventRecord[]>([]);
  const [costCodes, setCostCodes] = useState<CostCodeOption[]>([]);
  const [organizationDefaults, setOrganizationDefaults] =
    useState<OrganizationDocumentDefaults | null>(null);
  const [selectedViewerEstimateId, setSelectedViewerEstimateId] = useState("");
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

  /** Load approved estimates for a project, enriching with approval metadata. */
  const loadProjectEstimates = useCallback(async (projectId: number) => {
    try {
      const response = await fetch(`${apiBaseUrl}/projects/${projectId}/estimates/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setProjectEstimates([]);
        return;
      }
      const rows =
        (payload.data as Array<{
          id: number;
          title: string;
          version: number;
          status?: string;
          grand_total?: string;
          line_items?: OriginEstimateLineItem[];
        }>) ?? [];
      const approvedRows = rows.filter((estimate) => estimate.status === "approved");
      const approvedRowsWithMeta: OriginEstimateRecord[] = await Promise.all(
        approvedRows.map(async (estimate) => {
          const base = {
            id: estimate.id,
            title: estimate.title,
            version: estimate.version,
            grand_total: estimate.grand_total ?? "0.00",
            line_items: estimate.line_items ?? [],
          };
          try {
            const response = await fetch(
              `${apiBaseUrl}/estimates/${estimate.id}/status-events/`,
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
      const preferredEstimateId =
        initialOriginEstimateId &&
        approvedRowsWithMeta.some((estimate) => estimate.id === initialOriginEstimateId)
          ? String(initialOriginEstimateId)
          : "";
      setProjectEstimates(approvedRowsWithMeta);
      const totalsMap: Record<number, number> = {};
      for (const est of approvedRowsWithMeta) {
        totalsMap[est.id] = parseFloat(est.grand_total) || 0;
      }
      setOriginEstimateOriginalTotals(totalsMap);
      setSelectedViewerEstimateId((current) => {
        if (preferredEstimateId) {
          return preferredEstimateId;
        }
        if (current && approvedRowsWithMeta.some((estimate) => String(estimate.id) === current)) {
          return current;
        }
        return approvedRowsWithMeta[0] ? String(approvedRowsWithMeta[0].id) : "";
      });
    } catch {
      setProjectEstimates([]);
      setSelectedViewerEstimateId("");
    }
  }, [initialOriginEstimateId, authToken]);

  /** Load audit events for a project. */
  const loadProjectAuditEvents = useCallback(async (projectId: number) => {
    try {
      const response = await fetch(`${apiBaseUrl}/projects/${projectId}/audit-events/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setProjectAuditEvents([]);
        return;
      }
      const rows =
        (payload.data as Array<{
          id: number;
          event_type: string;
          object_type: string;
          object_id: number;
          from_status: string;
          to_status: string;
          note: string;
          metadata_json?: Record<string, unknown> | null;
          created_by: number;
          created_by_email: string | null;
          created_by_display?: string | null;
          created_by_customer_id?: number | null;
          created_at: string;
        }>) ?? [];
      setProjectAuditEvents(rows);
    } catch {
      setProjectAuditEvents([]);
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
      const rows = (payload.data as Array<{ id: number; name: string; status?: string; customer_email?: string }>) ?? [];
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
        await Promise.all([
          loadProjectEstimates(nextProject.id),
          loadProjectAuditEvents(nextProject.id),
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
        callbacks.onChangeOrdersLoaded(changeOrderRows, initialOriginEstimateId);
        setFeedback("");
      } else {
        setSelectedProjectId("");
        setSelectedProjectName("");
        setSelectedProjectStatus("");
        setSelectedProjectCustomerEmail("");
        setOriginEstimateOriginalTotals({});
        setProjectEstimates([]);
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
    initialOriginEstimateId,
    loadCostCodes,
    loadProjectAuditEvents,
    loadProjectEstimates,
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
    changeOrders,
    projectEstimates,
    originEstimateOriginalTotals,
    projectAuditEvents,
    costCodes,
    organizationDefaults,
    selectedViewerEstimateId,
    actionMessage,
    actionTone,

    // Setters
    setChangeOrders,
    setSelectedViewerEstimateId,
    setFeedback,

    // Helpers
    fetchProjectChangeOrders,
    loadProjectEstimates,
    loadProjectAuditEvents,
    loadCostCodes,
    loadOrganizationDefaults,
    loadProjects,
  };
}

export type { LoadProjectsCallbacks };
