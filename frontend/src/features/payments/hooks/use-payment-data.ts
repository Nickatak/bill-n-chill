/**
 * Payment data loading, policy contract, and entity lists.
 *
 * Owns the server-fetched data that feeds the payments console:
 * customers, projects, all payments, invoices (allocation targets),
 * and the payment policy contract (status labels, methods, transitions).
 *
 * Consumer: PaymentsConsole (composed alongside usePaymentForm and
 * usePaymentFilters).
 *
 * ## State (useState)
 *
 * - customers               — full customer list for combobox
 * - selectedCustomerId      — current customer selection (string id or "")
 * - projects                — full project list for combobox
 * - selectedProjectId       — current project selection (string id or "")
 * - allPayments             — all payment records (both directions)
 * - selectedPaymentId       — currently selected payment in the list
 * - invoices                — invoice list for the selected project (allocation targets)
 * - paymentStatusLabels     — display labels from policy contract (fallback-initialized)
 * - paymentMethods          — method options from policy contract
 * - paymentAllowedTransitions — status transition map from policy contract
 * - defaultCreateMethod     — default method for new payments from policy
 *
 * ## Functions
 *
 * - loadPaymentPolicy()
 *     Fetches /contracts/payments/ and hydrates policy state.
 *
 * - loadCustomers()
 *     GET /customers/ — populates customer combobox.
 *
 * - loadProjects()
 *     GET /projects/ — populates project combobox.
 *     Validates selectedProjectId still exists after reload.
 *
 * - loadPayments()
 *     GET /payments/ — populates full payment list.
 *
 * - loadInvoices(projectId?)
 *     GET /projects/:id/invoices/ — populates allocation targets.
 *     Falls back to selectedProjectId when no arg given.
 *
 * ## Effect: initial data load
 *
 * Deps: [authToken]
 *
 * On mount (when token is available), fires all four data loaders
 * and the policy loader in parallel.
 *
 * ## Effect: invoice reload on project change
 *
 * Deps: [selectedProjectId, authToken]
 *
 * Clears invoices when no project is selected; otherwise loads
 * invoices for the new project.
 */

import { useCallback, useEffect, useState } from "react";

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";

import { fetchPaymentPolicyContract } from "../api";
import type {
  ApiResponse,
  CustomerRecord,
  InvoiceRecord,
  PaymentPolicyContract,
  PaymentRecord,
  ProjectRecord,
} from "../types";

// ---------------------------------------------------------------------------
// Fallbacks (used until policy contract loads)
// ---------------------------------------------------------------------------

const PAYMENT_STATUS_LABELS_FALLBACK: Record<string, string> = {
  pending: "Pending",
  settled: "Settled",
  void: "Void",
};
const PAYMENT_METHODS_FALLBACK = ["check", "zelle", "ach", "cash", "wire", "card", "other"];
const PAYMENT_ALLOWED_TRANSITIONS_FALLBACK: Record<string, string[]> = {
  pending: ["settled", "void"],
  settled: ["void"],
  void: [],
};

/**
 * Fetch and manage all server data for the payments console.
 *
 * @param authToken - Auth token for API requests.
 * @param scopedCustomerId - URL-scoped customer id (deep link), or null.
 * @param scopedProjectId  - URL-scoped project id (deep link), or null.
 * @returns Entity lists, policy state, selection state, setters, and loaders.
 */
export function usePaymentData(
  authToken: string,
  scopedCustomerId: string | null,
  scopedProjectId: string | null,
) {

  // --- State ---

  // Customers
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(scopedCustomerId ?? "");

  // Projects
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(scopedProjectId ?? "");

  // Payments
  const [allPayments, setAllPayments] = useState<PaymentRecord[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");

  // Allocation targets (invoices for inbound)
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);

  // Policy contract
  const [paymentStatusLabels, setPaymentStatusLabels] = useState<Record<string, string>>(PAYMENT_STATUS_LABELS_FALLBACK);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(PAYMENT_METHODS_FALLBACK);
  const [paymentAllowedTransitions, setPaymentAllowedTransitions] = useState<Record<string, string[]>>(PAYMENT_ALLOWED_TRANSITIONS_FALLBACK);
  const [defaultCreateMethod, setDefaultCreateMethod] = useState<string>(PAYMENT_METHODS_FALLBACK[0]);

  // --- Functions ---

  const loadPaymentPolicy = useCallback(async () => {
    try {
      const response = await fetchPaymentPolicyContract({ baseUrl: apiBaseUrl, token: authToken });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) return;

      const contract = payload.data as PaymentPolicyContract;
      if (!Array.isArray(contract.statuses) || !contract.statuses.length ||
          !Array.isArray(contract.methods) || !contract.methods.length ||
          !contract.allowed_status_transitions) return;

      const normalizedTransitions = contract.statuses.reduce<Record<string, string[]>>((acc, s) => {
        const next = contract.allowed_status_transitions[s];
        acc[s] = Array.isArray(next) ? next : [];
        return acc;
      }, {});

      const nextDefaultMethod = contract.default_create_method || contract.methods[0] || PAYMENT_METHODS_FALLBACK[0];

      setPaymentStatusLabels({ ...PAYMENT_STATUS_LABELS_FALLBACK, ...(contract.status_labels || {}) });
      setPaymentMethods(contract.methods);
      setPaymentAllowedTransitions(normalizedTransitions);
      setDefaultCreateMethod(nextDefaultMethod);
    } catch {
      // Best-effort; static fallback remains active.
    }
  }, [authToken]);

  const loadCustomers = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`${apiBaseUrl}/customers/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) return;
      const rows = (payload.data as CustomerRecord[]) ?? [];
      setCustomers(rows);
    } catch {
      // silent
    }
  }, [authToken]);

  const loadProjects = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`${apiBaseUrl}/projects/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) return;
      const rows = (payload.data as ProjectRecord[]) ?? [];
      setProjects(rows);
      // Validate scoped project ID still exists; don't auto-select (project is optional)
      setSelectedProjectId((current) => {
        if (current && rows.some((r) => String(r.id) === current)) return current;
        return "";
      });
    } catch {
      // silent
    }
  }, [authToken]);

  const loadPayments = useCallback(async () => {
    if (!authToken) return;
    try {
      const response = await fetch(`${apiBaseUrl}/payments/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) return;
      const rows = (payload.data as PaymentRecord[]) ?? [];
      setAllPayments(rows);
    } catch {
      // silent
    }
  }, [authToken]);

  const loadInvoices = useCallback(async (projectId?: number) => {
    const resolvedId = projectId ?? Number(selectedProjectId);
    if (!authToken || !resolvedId) return;
    try {
      const response = await fetch(`${apiBaseUrl}/projects/${resolvedId}/invoices/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (response.ok) {
        setInvoices((payload.data as InvoiceRecord[]) ?? []);
      }
    } catch {
      // silent
    }
  }, [authToken, selectedProjectId]);

  // --- Effects ---

  /** Effect: initial data load — fires all loaders when token becomes available. */
  useEffect(() => {
    if (!authToken) return;
    void loadPaymentPolicy();
    void loadCustomers();
    void loadProjects();
    void loadPayments();
  }, [loadPaymentPolicy, loadCustomers, loadProjects, loadPayments, authToken]);

  /** Effect: reload invoices when project selection changes. */
  useEffect(() => {
    const projectId = Number(selectedProjectId);
    if (!authToken || !projectId) {
      setInvoices([]);
      return;
    }
    void loadInvoices(projectId);
  }, [loadInvoices, selectedProjectId, authToken]);

  // --- Derived ---

  const selectedCustomer = customers.find((c) => String(c.id) === selectedCustomerId) ?? null;
  const selectedProject = projects.find((p) => String(p.id) === selectedProjectId) ?? null;

  // --- Return bag ---

  return {
    // State
    customers,
    selectedCustomerId,
    selectedCustomer,
    projects,
    selectedProjectId,
    selectedProject,
    allPayments,
    selectedPaymentId,
    invoices,
    paymentStatusLabels,
    paymentMethods,
    paymentAllowedTransitions,
    defaultCreateMethod,

    // Setters
    setCustomers,
    setSelectedCustomerId,
    setProjects,
    setSelectedProjectId,
    setAllPayments,
    setSelectedPaymentId,
    setInvoices,

    // Helpers
    loadPaymentPolicy,
    loadCustomers,
    loadProjects,
    loadPayments,
    loadInvoices,
  };
}
