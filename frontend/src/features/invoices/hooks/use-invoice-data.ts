/**
 * Invoice data fetching and list state.
 *
 * Owns the server-fetched data for the invoice console: project list,
 * invoice list, organization defaults, cost codes, contract breakdown,
 * and status history events. Runs data-loading effects on auth/project
 * changes and exposes load functions for mutation handlers to call.
 *
 * Consumer: InvoicesConsole (composed alongside useInvoiceFormFields
 * and useLineItems).
 *
 * ## State
 *
 * - projects                        — project list (for project lookup)
 * - invoices                        — invoice list for the scoped project
 * - organizationInvoiceDefaults     — org-level invoice settings (due delta, terms)
 * - costCodes                       — active cost codes for line item selection
 * - contractBreakdown               — estimate + CO breakdown for the project
 * - selectedInvoiceStatusEvents     — status history for the selected invoice
 * - statusEventsLoading             — loading flag for status events fetch
 *
 * ## Functions
 *
 * - loadDependencies(options?)
 *     Fetches projects, organization, and cost codes in parallel.
 *     Hydrates org defaults and due date/terms from org settings.
 *
 * - loadInvoices()
 *     Fetches invoices for the scoped project. Returns the rows so
 *     callers can act on them (e.g. auto-select first invoice).
 *
 * - loadContractBreakdown(projectId)
 *     Fetches contract breakdown (estimate + COs) for a project.
 *
 * - loadInvoiceStatusEvents(invoiceId)
 *     Fetches status history events for an invoice.
 *
 * ## Effects
 *
 * - Load dependencies on auth token change.
 * - Load invoices + contract breakdown on scoped project change.
 *   Auto-loads first invoice into workspace via onInitialLoad callback.
 */

import { useCallback, useEffect, useState } from "react";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import { dueDateFromIssueDate, readInvoiceApiError } from "../helpers";
import type {
  ApiResponse,
  CostCode,
  InvoiceRecord,
  InvoiceStatusEventRecord,
  OrganizationInvoiceDefaults,
  ProjectRecord,
} from "../types";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type ContractBreakdownEstimateLine = {
  id: number;
  cost_code?: number | null;
  cost_code_code?: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  markup_percent: string;
  line_total: string;
};

type ContractBreakdownEstimate = {
  id: number;
  title: string;
  version: number;
  grand_total: string;
  line_items: ContractBreakdownEstimateLine[];
};

type ContractBreakdownCO = {
  id: number;
  title: string;
  family_key: string;
  revision_number: number;
  amount_delta: string;
  line_items: Array<{
    id: number;
    cost_code_code?: string;
    description: string;
    adjustment_reason: string;
    amount_delta: string;
    days_delta: number;
  }>;
};

export type ContractBreakdown = {
  active_estimate: ContractBreakdownEstimate | null;
  approved_change_orders: ContractBreakdownCO[];
};

type StatusMessageSetters = {
  setNeutralStatus: (msg: string) => void;
  setErrorStatus: (msg: string) => void;
  setStatusMessage: (msg: string) => void;
};

type FormFieldSetters = {
  setDueDate: (date: string) => void;
  setTermsText: (fn: string | ((current: string) => string)) => void;
};

type UseInvoiceDataOptions = {
  authToken: string;
  scopedProjectId: number;
  issueDate: string;
  status: StatusMessageSetters;
  formSetters: FormFieldSetters;
  /** Called after initial invoice list load with the fetched rows. */
  onInitialLoad: (rows: InvoiceRecord[]) => void;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Fetch and manage invoice-related data for the scoped project.
 *
 * @param options - Auth token, scoped project ID, status message setters,
 *                  and form field setters for org-default hydration.
 * @returns Data state, setters, and load functions.
 */
export function useInvoiceData({
  authToken,
  scopedProjectId,
  issueDate,
  status,
  formSetters,
  onInitialLoad,
}: UseInvoiceDataOptions) {

  // --- State ---

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [organizationInvoiceDefaults, setOrganizationInvoiceDefaults] =
    useState<OrganizationInvoiceDefaults | null>(null);
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);
  const [contractBreakdown, setContractBreakdown] = useState<ContractBreakdown | null>(null);
  const [selectedInvoiceStatusEvents, setSelectedInvoiceStatusEvents] = useState<
    InvoiceStatusEventRecord[]
  >([]);
  const [statusEventsLoading, setStatusEventsLoading] = useState(false);

  // --- Functions ---

  /** Fetch projects, organization settings, and cost codes in parallel. */
  const loadDependencies = useCallback(
    async (options?: { keepStatusOnSuccess?: boolean }) => {
      if (!authToken) {
        return;
      }

      status.setNeutralStatus("Loading...");
      try {
        const [projectsRes, orgRes, costCodesRes] = await Promise.all([
          fetch(`${apiBaseUrl}/projects/`, { headers: buildAuthHeaders(authToken) }),
          fetch(`${apiBaseUrl}/organization/`, { headers: buildAuthHeaders(authToken) }),
          fetch(`${apiBaseUrl}/cost-codes/`, { headers: buildAuthHeaders(authToken) }),
        ]);
        const projectsPayload: ApiResponse = await projectsRes.json();
        const orgPayload: ApiResponse = await orgRes.json();

        if (!projectsRes.ok) {
          status.setErrorStatus("Failed loading dependencies.");
          return;
        }

        if (costCodesRes.ok) {
          const costCodesPayload: ApiResponse = await costCodesRes.json();
          const costCodeRows = ((costCodesPayload.data as CostCode[]) ?? []).filter((c) => c.is_active);
          setCostCodes(costCodeRows);
        }

        const projectRows = (projectsPayload.data as ProjectRecord[]) ?? [];
        const organizationData = (
          orgPayload.data as { organization?: OrganizationInvoiceDefaults } | undefined
        )?.organization;

        setProjects(projectRows);
        if (orgRes.ok && organizationData) {
          setOrganizationInvoiceDefaults(organizationData);
          formSetters.setDueDate(dueDateFromIssueDate(issueDate, organizationData.default_invoice_due_delta || 30));
          formSetters.setTermsText((current) => current || organizationData.invoice_terms_and_conditions || "");
        }

        if (!options?.keepStatusOnSuccess) {
          status.setStatusMessage("");
        }
      } catch {
        status.setErrorStatus("Could not reach dependency endpoints.");
      }
    },
    [authToken, formSetters, issueDate, status],
  );

  /** Fetch invoices for the scoped project. Returns the rows for caller use. */
  const loadInvoices = useCallback(
    async (): Promise<InvoiceRecord[]> => {
      if (!authToken || !scopedProjectId) {
        return [];
      }

      try {
        const response = await fetch(`${apiBaseUrl}/projects/${scopedProjectId}/invoices/`, {
          headers: buildAuthHeaders(authToken),
        });
        const payload: ApiResponse = await response.json();

        if (!response.ok) {
          status.setErrorStatus(readInvoiceApiError(payload, "Failed loading invoices."));
          return [];
        }

        const rows = (payload.data as InvoiceRecord[]) ?? [];
        setInvoices(rows);
        status.setStatusMessage("");
        return rows;
      } catch {
        status.setErrorStatus("Could not reach invoice endpoint.");
        return [];
      }
    },
    [authToken, scopedProjectId, status],
  );

  /** Fetch contract breakdown (estimate + COs) for a project. */
  const loadContractBreakdown = useCallback(
    async (projectId: number) => {
      if (!authToken || !projectId) {
        setContractBreakdown(null);
        return;
      }
      try {
        const response = await fetch(`${apiBaseUrl}/projects/${projectId}/contract-breakdown/`, {
          headers: buildAuthHeaders(authToken),
        });
        const payload = await response.json();
        if (!response.ok || !payload.data) {
          setContractBreakdown(null);
          return;
        }
        setContractBreakdown(payload.data as ContractBreakdown);
      } catch {
        setContractBreakdown(null);
      }
    },
    [authToken],
  );

  /** Fetch status history events for an invoice. */
  const loadInvoiceStatusEvents = useCallback(
    async (invoiceId: number) => {
      if (!authToken || !invoiceId) {
        setSelectedInvoiceStatusEvents([]);
        return;
      }
      setStatusEventsLoading(true);
      try {
        const response = await fetch(`${apiBaseUrl}/invoices/${invoiceId}/status-events/`, {
          headers: buildAuthHeaders(authToken),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          setSelectedInvoiceStatusEvents([]);
          return;
        }
        setSelectedInvoiceStatusEvents((payload.data as InvoiceStatusEventRecord[]) ?? []);
      } catch {
        setSelectedInvoiceStatusEvents([]);
      } finally {
        setStatusEventsLoading(false);
      }
    },
    [authToken],
  );

  // --- Effects ---

  /** Load projects and organization defaults on auth. */
  useEffect(() => {
    if (!authToken) {
      return;
    }
    void loadDependencies();
  }, [loadDependencies, authToken]);

  /** Load invoices and contract breakdown for the scoped project. */
  useEffect(() => {
    if (!authToken || !scopedProjectId) {
      setInvoices([]);
      setContractBreakdown(null);
      return;
    }
    void (async () => {
      const rows = await loadInvoices();
      onInitialLoad(rows);
    })();
    void loadContractBreakdown(scopedProjectId);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onInitialLoad is an untracked callback; adding it would re-fire on every render
  }, [loadContractBreakdown, loadInvoices, scopedProjectId, authToken]);

  // --- Return bag ---

  return {
    // State
    projects,
    invoices,
    organizationInvoiceDefaults,
    costCodes,
    contractBreakdown,
    selectedInvoiceStatusEvents,
    statusEventsLoading,

    // Setters
    setInvoices,
    setContractBreakdown,
    setSelectedInvoiceStatusEvents,
    setStatusEventsLoading,

    // Helpers
    loadDependencies,
    loadInvoices,
    loadContractBreakdown,
    loadInvoiceStatusEvents,
  };
}
