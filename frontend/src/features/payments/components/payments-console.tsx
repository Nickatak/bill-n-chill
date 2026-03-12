"use client";

/**
 * Primary payments management console — standalone page at /payments.
 *
 * Combines project selection, direction toggle (inbound/outbound), payment list
 * with status filtering, selected payment detail with optional allocation, and a
 * quick-record workspace form.
 *
 * Replaces the old embedded PaymentRecorder tabs on the Invoices page.
 * Outbound payments also remain co-located on the Bills page.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { todayDateInput, formatDateDisplay } from "@/shared/date-format";
import {
  defaultApiBaseUrl,
  fetchPaymentPolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { canDo } from "@/shared/session/rbac";
import {
  ProjectListViewer,
  collapseToggleButtonStyles as collapseButtonStyles,
} from "@/shared/project-list-viewer";
import type { ProjectListStatusValue } from "@/shared/project-list-viewer";
import { useStatusMessage } from "@/shared/hooks/use-status-message";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";
import type {
  AllocationTarget,
  ApiResponse,
  PaymentAllocateResult,
  PaymentAllocationTargetType,
  PaymentMethod,
  PaymentPolicyContract,
  PaymentRecord,
  PaymentStatus,
  ProjectRecord,
  InvoiceRecord,
  VendorBillRecord,
} from "../types";
import styles from "./payments-console.module.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAYMENT_STATUSES_FALLBACK = ["pending", "settled", "void"];
const PAYMENT_STATUS_LABELS_FALLBACK: Record<string, string> = {
  pending: "Pending",
  settled: "Settled",
  void: "Void",
};
const PAYMENT_METHODS_FALLBACK = ["ach", "card", "check", "wire", "cash", "other"];
const PAYMENT_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, string[]> = {
  pending: ["settled", "void"],
  settled: ["void"],
  void: [],
};
const PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK: Record<string, PaymentAllocationTargetType> = {
  inbound: "invoice",
  outbound: "vendor_bill",
};

const DEFAULT_PROJECT_STATUS_FILTERS: ProjectListStatusValue[] = ["active", "prospect"];
const PROJECT_STATUS_VALUES: ProjectListStatusValue[] = ["prospect", "active", "on_hold", "completed", "cancelled"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CLASS_MAP: Record<string, string> = {
  pending: styles.statusPending,
  settled: styles.statusSettled,
  void: styles.statusVoid,
};

function statusBadgeClass(status: string): string {
  return STATUS_CLASS_MAP[status] ?? styles.statusPending;
}

function projectStatusLabel(statusValue: string): string {
  return statusValue.replace("_", " ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PaymentsConsole() {
  const { token, authMessage, role, capabilities } = useSharedSessionAuth();
  const canCreatePayments = canDo(capabilities, "payments", "create");
  const canEditPayments = canDo(capabilities, "payments", "edit");
  const canAllocatePayments = canDo(capabilities, "payments", "allocate");
  const canMutatePayments = canCreatePayments || canEditPayments;

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const { message: statusMessage, tone: statusTone, setNeutral, setSuccess, setError, setMessage: setStatusMessage, clear: clearStatus } = useStatusMessage();

  // -- Project state --
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilters, setProjectStatusFilters] = useState<ProjectListStatusValue[]>(DEFAULT_PROJECT_STATUS_FILTERS);
  const [isProjectListExpanded, setIsProjectListExpanded] = useState(true);

  // -- Direction --
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");

  // -- Policy --
  const [paymentStatusLabels, setPaymentStatusLabels] = useState<Record<string, string>>(PAYMENT_STATUS_LABELS_FALLBACK);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(PAYMENT_METHODS_FALLBACK);
  const [paymentAllowedTransitions, setPaymentAllowedTransitions] = useState<Record<string, string[]>>(PAYMENT_ALLOWED_STATUS_TRANSITIONS_FALLBACK);
  const [allocationTargetByDirection, setAllocationTargetByDirection] = useState<Record<string, PaymentAllocationTargetType>>(PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK);
  const [defaultCreateMethod, setDefaultCreateMethod] = useState<string>("ach");

  // -- Payments --
  const [allPayments, setAllPayments] = useState<PaymentRecord[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [paymentStatusFilters, setPaymentStatusFilters] = useState<string[]>(["pending", "settled"]);
  const [paymentSearch, setPaymentSearch] = useState("");
  const [isPaymentListExpanded, setIsPaymentListExpanded] = useState(true);

  // -- Allocation targets --
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [vendorBills, setVendorBills] = useState<VendorBillRecord[]>([]);

  // -- Workspace --
  const [workspaceMode, setWorkspaceMode] = useState<"create" | "edit">("create");
  const [formMethod, setFormMethod] = useState<PaymentMethod>("ach");
  const [formStatus, setFormStatus] = useState<PaymentStatus>("settled");
  const [formAmount, setFormAmount] = useState("0.00");
  const [formPaymentDate, setFormPaymentDate] = useState(todayDateInput());
  const [formReferenceNumber, setFormReferenceNumber] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [allocTargetId, setAllocTargetId] = useState("");
  const [allocAmount, setAllocAmount] = useState("");

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------

  const directionLabel = direction === "inbound" ? "Inbound" : "Outbound";
  const targetLabel = direction === "inbound" ? "Invoice" : "Bill";
  const allocationTargetType: PaymentAllocationTargetType =
    allocationTargetByDirection[direction] ?? PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK[direction];

  // Filter payments by direction
  const directionPayments = useMemo(
    () => allPayments.filter((p) => p.direction === direction),
    [allPayments, direction],
  );

  // Status totals for filter pills
  const paymentStatusTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of directionPayments) {
      totals.set(p.status, (totals.get(p.status) ?? 0) + 1);
    }
    return totals;
  }, [directionPayments]);

  // Status-filtered payments
  const statusFilteredPayments = useMemo(() => {
    if (!paymentStatusFilters.length) return [];
    return directionPayments.filter((p) => paymentStatusFilters.includes(p.status));
  }, [directionPayments, paymentStatusFilters]);

  // Search-filtered payments
  const paymentNeedle = paymentSearch.trim().toLowerCase();
  const searchedPayments = useMemo(() => {
    if (!paymentNeedle) return statusFilteredPayments;
    return statusFilteredPayments.filter((p) => {
      const haystack = [
        String(p.id),
        p.method,
        p.status,
        p.amount,
        p.payment_date,
        p.reference_number,
        p.notes,
        p.project_name,
      ].join(" ").toLowerCase();
      return haystack.includes(paymentNeedle);
    });
  }, [statusFilteredPayments, paymentNeedle]);

  const { page: paymentPage, totalPages: paymentTotalPages, totalCount: paymentTotalCount, paginatedItems: paginatedPayments, setPage: setPaymentPage } = useClientPagination(searchedPayments);

  const selectedPayment = useMemo(
    () => directionPayments.find((p) => String(p.id) === selectedPaymentId),
    [directionPayments, selectedPaymentId],
  );

  const quickStatusOptions = selectedPayment
    ? paymentAllowedTransitions[selectedPayment.status] ?? []
    : [];

  const selectedPaymentAllowedStatuses = selectedPayment
    ? [selectedPayment.status, ...(paymentAllowedTransitions[selectedPayment.status] ?? [])]
        .filter((v, i, a) => a.indexOf(v) === i)
    : [];

  // Allocation targets for current direction
  const allocationTargets: AllocationTarget[] = useMemo(() => {
    if (direction === "inbound") {
      return invoices.map((inv) => ({
        id: inv.id,
        label: inv.invoice_number || `Invoice #${inv.id}`,
        balanceDue: inv.balance_due,
      }));
    }
    return vendorBills.map((bill) => ({
      id: bill.id,
      label: bill.bill_number ? `${bill.bill_number}` : `Bill #${bill.id}`,
      balanceDue: bill.balance_due,
    }));
  }, [direction, invoices, vendorBills]);

  const payableTargets = useMemo(
    () => allocationTargets.filter((t) => Number(t.balanceDue) > 0),
    [allocationTargets],
  );

  // Project list filtering
  const projectNeedle = projectSearch.trim().toLowerCase();
  const filteredProjects = !projectNeedle
    ? projects
    : projects.filter((p) => {
        const haystack = [String(p.id), p.name, p.customer_display_name, p.status].join(" ").toLowerCase();
        return haystack.includes(projectNeedle);
      });
  const projectStatusCounts = PROJECT_STATUS_VALUES.reduce<Record<ProjectListStatusValue, number>>(
    (acc, sv) => {
      acc[sv] = filteredProjects.filter((p) => (p.status as ProjectListStatusValue) === sv).length;
      return acc;
    },
    { prospect: 0, active: 0, on_hold: 0, completed: 0, cancelled: 0 },
  );
  const statusFilteredProjects = filteredProjects.filter((p) =>
    projectStatusFilters.includes(p.status as ProjectListStatusValue),
  );

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function statusLabel(value: string): string {
    return paymentStatusLabels[value] ?? value;
  }

  function resetToCreate() {
    setWorkspaceMode("create");
    setSelectedPaymentId("");
    setFormMethod(defaultCreateMethod);
    setFormStatus("settled");
    setFormAmount("0.00");
    setFormPaymentDate(todayDateInput());
    setFormReferenceNumber("");
    setFormNotes("");
    setAllocTargetId("");
    setAllocAmount("");
  }

  function hydrateFromPayment(payment: PaymentRecord) {
    setWorkspaceMode("edit");
    setFormMethod(payment.method);
    setFormStatus(payment.status);
    setFormAmount(payment.amount);
    setFormPaymentDate(payment.payment_date);
    setFormReferenceNumber(payment.reference_number);
    setFormNotes(payment.notes);
    setAllocTargetId("");
    setAllocAmount("");
  }

  function togglePaymentStatusFilter(status: string) {
    setPaymentStatusFilters((current) =>
      current.includes(status)
        ? current.filter((s) => s !== status)
        : [...current, status],
    );
  }

  function toggleProjectStatusFilter(sv: ProjectListStatusValue) {
    setProjectStatusFilters((current) =>
      current.includes(sv) ? current.filter((s) => s !== sv) : [...current, sv],
    );
  }

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadPaymentPolicy = useCallback(async () => {
    try {
      const response = await fetchPaymentPolicyContract({ baseUrl: normalizedBaseUrl, token });
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
      setAllocationTargetByDirection({
        ...PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK,
        ...(contract.allocation_target_by_direction || {}),
      });
      setDefaultCreateMethod(nextDefaultMethod);
      setFormMethod((c) => (contract.methods.includes(c) ? c : nextDefaultMethod));
    } catch {
      // Best-effort; static fallback remains active.
    }
  }, [normalizedBaseUrl, token]);

  const loadProjects = useCallback(async () => {
    if (!token) return;
    setNeutral("Loading projects...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setError("Failed loading projects.");
        return;
      }
      const rows = (payload.data as ProjectRecord[]) ?? [];
      setProjects(rows);
      setSelectedProjectId((current) => {
        if (current && rows.some((r) => String(r.id) === current)) return current;
        return rows[0] ? String(rows[0].id) : "";
      });
      setStatusMessage("");
    } catch {
      setError("Could not reach projects endpoint.");
    }
  }, [normalizedBaseUrl, setError, setNeutral, setStatusMessage, token]);

  const loadPayments = useCallback(async (projectId?: number) => {
    const resolvedId = projectId ?? Number(selectedProjectId);
    if (!token || !resolvedId) return;
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${resolvedId}/payments/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setError(payload.error?.message ?? "Could not load payments.");
        return;
      }
      const rows = (payload.data as PaymentRecord[]) ?? [];
      setAllPayments(rows);

      // Auto-select first payment in current direction
      const dirRows = rows.filter((p) => p.direction === direction);
      setSelectedPaymentId((current) => {
        if (current && dirRows.some((p) => String(p.id) === current)) return current;
        return dirRows[0] ? String(dirRows[0].id) : "";
      });
      setStatusMessage("");
    } catch {
      setError("Could not reach payments endpoint.");
    }
  }, [direction, normalizedBaseUrl, selectedProjectId, setError, setStatusMessage, token]);

  const loadAllocationTargets = useCallback(async (projectId?: number) => {
    const resolvedId = projectId ?? Number(selectedProjectId);
    if (!token || !resolvedId) return;

    try {
      const [invoicesRes, billsRes] = await Promise.all([
        fetch(`${normalizedBaseUrl}/projects/${resolvedId}/invoices/`, {
          headers: buildAuthHeaders(token),
        }),
        fetch(`${normalizedBaseUrl}/projects/${resolvedId}/vendor-bills/`, {
          headers: buildAuthHeaders(token),
        }),
      ]);
      const invoicesPayload: ApiResponse = await invoicesRes.json();
      const billsPayload: ApiResponse = await billsRes.json();

      if (invoicesRes.ok) {
        setInvoices((invoicesPayload.data as InvoiceRecord[]) ?? []);
      }
      if (billsRes.ok) {
        setVendorBills((billsPayload.data as VendorBillRecord[]) ?? []);
      }
    } catch {
      // Best-effort — allocation is optional.
    }
  }, [normalizedBaseUrl, selectedProjectId, token]);

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  // Load policy + projects on auth
  useEffect(() => {
    if (!token) return;
    void loadPaymentPolicy();
    void loadProjects();
  }, [loadPaymentPolicy, loadProjects, token]);

  // Reload payments + allocation targets when project changes
  useEffect(() => {
    const projectId = Number(selectedProjectId);
    if (!token || !projectId) {
      setAllPayments([]);
      setSelectedPaymentId("");
      setInvoices([]);
      setVendorBills([]);
      return;
    }
    void loadPayments(projectId);
    void loadAllocationTargets(projectId);
  }, [loadAllocationTargets, loadPayments, selectedProjectId, token]);

  // Auto-select first payment when direction changes
  useEffect(() => {
    const dirRows = allPayments.filter((p) => p.direction === direction);
    const stillVisible = dirRows.some((p) => String(p.id) === selectedPaymentId);
    if (!stillVisible) {
      const first = dirRows[0];
      if (first) {
        setSelectedPaymentId(String(first.id));
        hydrateFromPayment(first);
      } else {
        resetToCreate();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, allPayments]);

  // Ensure selected project is still visible after filter changes
  useEffect(() => {
    if (statusFilteredProjects.length === 0) return;
    const stillVisible = statusFilteredProjects.some((p) => String(p.id) === selectedProjectId);
    if (!stillVisible) {
      setSelectedProjectId(String(statusFilteredProjects[0].id));
    }
  }, [selectedProjectId, statusFilteredProjects]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function handleSelectProject(project: { id: number }) {
    if (String(project.id) === selectedProjectId) return;
    setSelectedProjectId(String(project.id));
    setPaymentSearch("");
    resetToCreate();
  }

  function handleSelectPayment(payment: PaymentRecord) {
    setSelectedPaymentId(String(payment.id));
    hydrateFromPayment(payment);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (workspaceMode === "create") {
      await handleCreate();
    } else {
      await handleUpdate();
    }
  }

  async function handleCreate() {
    if (!canCreatePayments) {
      setError(`Role ${role} does not have payment create permission.`);
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setError("Select a project first.");
      return;
    }

    setNeutral("Recording payment...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/payments/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          direction,
          method: formMethod,
          amount: formAmount,
          payment_date: formPaymentDate,
          reference_number: formReferenceNumber,
          notes: formNotes,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setError(payload.error?.message ?? "Create payment failed.");
        return;
      }

      let created = payload.data as PaymentRecord;

      // One-step allocate if user filled in the optional allocation
      const wantAllocate = allocTargetId && allocAmount && allocAmount !== "0.00";
      if (wantAllocate && canAllocatePayments) {
        try {
          const allocResponse = await fetch(`${normalizedBaseUrl}/payments/${created.id}/allocate/`, {
            method: "POST",
            headers: buildAuthHeaders(token, { contentType: "application/json" }),
            body: JSON.stringify({
              allocations: [{
                target_type: allocationTargetType,
                target_id: Number(allocTargetId),
                applied_amount: allocAmount,
              }],
            }),
          });
          const allocPayload: ApiResponse = await allocResponse.json();
          if (allocResponse.ok) {
            const result = allocPayload.data as PaymentAllocateResult;
            created = result.payment;
            void loadAllocationTargets();
          } else {
            setAllPayments((current) => [created, ...current]);
            setSelectedPaymentId(String(created.id));
            hydrateFromPayment(created);
            setError(`Created payment #${created.id}, but allocation failed: ${allocPayload.error?.message ?? "unknown error"}.`);
            return;
          }
        } catch {
          setAllPayments((current) => [created, ...current]);
          setSelectedPaymentId(String(created.id));
          hydrateFromPayment(created);
          setError(`Created payment #${created.id}, but could not reach allocation endpoint.`);
          return;
        }
      }

      setAllPayments((current) => [created, ...current]);
      setSelectedPaymentId(String(created.id));
      hydrateFromPayment(created);
      setSuccess(
        wantAllocate
          ? `Created and allocated payment #${created.id}.`
          : `Created payment #${created.id}.`,
      );
    } catch {
      setError("Could not reach payment create endpoint.");
    }
  }

  async function handleUpdate() {
    if (!canEditPayments) {
      setError(`Role ${role} does not have payment edit permission.`);
      return;
    }
    const paymentId = Number(selectedPaymentId);
    if (!paymentId) {
      setError("Select a payment first.");
      return;
    }

    setNeutral("Saving payment...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/payments/${paymentId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          direction,
          method: formMethod,
          status: formStatus,
          amount: formAmount,
          payment_date: formPaymentDate,
          reference_number: formReferenceNumber,
          notes: formNotes,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setError(payload.error?.message ?? "Save payment failed.");
        return;
      }
      const updated = payload.data as PaymentRecord;
      setAllPayments((current) => current.map((p) => (p.id === updated.id ? updated : p)));
      hydrateFromPayment(updated);
      setSuccess(`Saved payment #${updated.id}.`);
    } catch {
      setError("Could not reach payment detail endpoint.");
    }
  }

  async function handleQuickStatus(nextStatus: PaymentStatus) {
    if (!canEditPayments) {
      setError(`Role ${role} does not have payment edit permission.`);
      return;
    }
    const paymentId = Number(selectedPaymentId);
    if (!paymentId) return;

    try {
      const response = await fetch(`${normalizedBaseUrl}/payments/${paymentId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setError(payload.error?.message ?? "Status update failed.");
        return;
      }
      const updated = payload.data as PaymentRecord;
      setAllPayments((current) => current.map((p) => (p.id === updated.id ? updated : p)));
      hydrateFromPayment(updated);
      setSuccess(`Payment #${updated.id} → ${statusLabel(updated.status)}.`);
    } catch {
      setError("Could not reach payment endpoint.");
    }
  }

  async function handleAllocate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAllocatePayments) {
      setError(`Role ${role} does not have payment allocation permission.`);
      return;
    }
    const paymentId = Number(selectedPaymentId);
    const targetId = Number(allocTargetId);
    if (!paymentId || !targetId) {
      setError("Select a payment and target first.");
      return;
    }

    try {
      const response = await fetch(`${normalizedBaseUrl}/payments/${paymentId}/allocate/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          allocations: [{
            target_type: allocationTargetType,
            target_id: targetId,
            applied_amount: allocAmount,
          }],
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setError(payload.error?.message ?? "Create allocation failed.");
        return;
      }

      const result = payload.data as PaymentAllocateResult;
      const updatedPayment = result.payment;
      setAllPayments((current) => current.map((p) => (p.id === updatedPayment.id ? updatedPayment : p)));
      setSelectedPaymentId(String(updatedPayment.id));
      hydrateFromPayment(updatedPayment);
      setAllocAmount("");
      setSuccess(`Allocated. Unapplied: ${updatedPayment.unapplied_amount}.`);
      void loadAllocationTargets();
    } catch {
      setError("Could not reach payment allocation endpoint.");
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const selectedProject = projects.find((p) => String(p.id) === selectedProjectId) ?? null;

  return (
    <section className={styles.console}>
      {!token ? <p className={styles.authNotice}>{authMessage}</p> : null}

      {statusMessage ? (
        <p className={`${styles.statusBanner} ${
          statusTone === "success" ? styles.statusSuccess : statusTone === "error" ? styles.statusError : ""
        }`}>
          {statusMessage}
        </p>
      ) : null}

      {token ? (
        <>
          {!canMutatePayments ? (
            <p className={styles.readOnlyNotice}>
              Role `{role}` can view payments but cannot create, edit, or allocate.
            </p>
          ) : null}

          <ProjectListViewer
            isExpanded={isProjectListExpanded}
            onToggleExpanded={() => setIsProjectListExpanded((v) => !v)}
            showSearchAndFilters
            searchValue={projectSearch}
            onSearchChange={setProjectSearch}
            statusValues={PROJECT_STATUS_VALUES}
            statusFilters={projectStatusFilters}
            statusCounts={projectStatusCounts}
            onToggleStatusFilter={toggleProjectStatusFilter}
            onShowAllStatuses={() => setProjectStatusFilters(["active", "on_hold", "prospect", "completed", "cancelled"])}
            onResetStatuses={() => setProjectStatusFilters(DEFAULT_PROJECT_STATUS_FILTERS)}
            projects={statusFilteredProjects}
            selectedProjectId={selectedProjectId}
            onSelectProject={handleSelectProject}
            statusLabel={projectStatusLabel}
          />

          {/* Direction toggle */}
          <div className={styles.directionToggle}>
            <button
              type="button"
              className={`${styles.directionButton} ${direction === "inbound" ? styles.directionButtonActive : ""}`}
              onClick={() => setDirection("inbound")}
            >
              Inbound (Received)
            </button>
            <button
              type="button"
              className={`${styles.directionButton} ${direction === "outbound" ? styles.directionButtonActive : ""}`}
              onClick={() => setDirection("outbound")}
            >
              Outbound (Paid)
            </button>
          </div>

          {/* Payment list panel */}
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h3>{selectedProject ? `${directionLabel} Payments: ${selectedProject.name}` : `${directionLabel} Payments`}</h3>
              <button
                type="button"
                className={collapseButtonStyles.collapseButton}
                onClick={() => setIsPaymentListExpanded((v) => !v)}
                aria-expanded={isPaymentListExpanded}
              >
                {isPaymentListExpanded ? "Collapse" : "Expand"}
              </button>
            </div>

            {isPaymentListExpanded ? (
              <>
                <input
                  className={styles.paymentSearchInput}
                  type="text"
                  placeholder="Search payments..."
                  value={paymentSearch}
                  onChange={(e) => setPaymentSearch(e.target.value)}
                />

                <div className={styles.statusFilters}>
                  {PAYMENT_STATUSES_FALLBACK.map((status) => {
                    const active = paymentStatusFilters.includes(status);
                    return (
                      <button
                        key={status}
                        type="button"
                        className={`${styles.statusFilterPill} ${active ? styles.statusFilterPillActive : styles.statusFilterPillInactive}`}
                        onClick={() => togglePaymentStatusFilter(status)}
                      >
                        <span>{statusLabel(status)}</span>
                        <span className={styles.statusFilterCount}>{paymentStatusTotals.get(status) ?? 0}</span>
                      </button>
                    );
                  })}
                </div>

                <div className={styles.paymentList}>
                  {paginatedPayments.length ? (
                    paginatedPayments.map((payment) => {
                      const isSelected = String(payment.id) === selectedPaymentId;
                      return (
                        <article
                          key={payment.id}
                          className={`${styles.paymentCard} ${isSelected ? styles.paymentCardSelected : ""}`}
                          onClick={() => handleSelectPayment(payment)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleSelectPayment(payment);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isSelected}
                        >
                          <div className={styles.paymentCardRow}>
                            <div className={styles.paymentCardIdentity}>
                              <span className={statusBadgeClass(payment.status)}>
                                {statusLabel(payment.status)}
                              </span>
                              <span>{payment.method.toUpperCase()}</span>
                              {payment.reference_number ? (
                                <span>#{payment.reference_number}</span>
                              ) : null}
                            </div>
                            <span className={styles.paymentCardAmount}>${payment.amount}</span>
                          </div>
                          <div className={styles.paymentMetaGrid}>
                            <span><span className={styles.paymentMetaLabel}>Date</span> {formatDateDisplay(payment.payment_date)}</span>
                            <span><span className={styles.paymentMetaLabel}>Allocated</span> ${payment.allocated_total}</span>
                            <span><span className={styles.paymentMetaLabel}>Unapplied</span> ${payment.unapplied_amount}</span>
                            {payment.notes ? (
                              <span><span className={styles.paymentMetaLabel}>Notes</span> {payment.notes}</span>
                            ) : null}
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <p className={styles.emptyState}>
                      {directionPayments.length
                        ? paymentNeedle
                          ? "No payments match your search."
                          : "No payments match the selected status filters."
                        : `No ${directionLabel.toLowerCase()} payments yet for this project.`}
                    </p>
                  )}
                </div>
                <PaginationControls page={paymentPage} totalPages={paymentTotalPages} totalCount={paymentTotalCount} onPageChange={setPaymentPage} />
              </>
            ) : (
              <p className={styles.inlineHint}>Payment list collapsed.</p>
            )}
          </section>

          {/* Selected payment detail card */}
          {selectedPayment ? (
            <div className={styles.detailCard}>
              <div className={styles.detailHeader}>
                <h3 className={styles.detailTitle}>Payment #{selectedPayment.id}</h3>
                <span className={statusBadgeClass(selectedPayment.status)}>
                  {statusLabel(selectedPayment.status)}
                </span>
                <span className={styles.directionBadge}>{directionLabel}</span>
              </div>

              <div className={styles.detailMetrics}>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Amount</span>
                  <span className={styles.metricValue}>${selectedPayment.amount}</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Allocated</span>
                  <span className={styles.metricValue}>${selectedPayment.allocated_total}</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Unapplied</span>
                  <span className={styles.metricValue}>${selectedPayment.unapplied_amount}</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Method</span>
                  <span className={styles.metricValue}>{selectedPayment.method}</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Date</span>
                  <span className={styles.metricValue}>{formatDateDisplay(selectedPayment.payment_date)}</span>
                </div>
                {selectedPayment.reference_number ? (
                  <div className={styles.metric}>
                    <span className={styles.metricLabel}>Reference</span>
                    <span className={styles.metricValue}>#{selectedPayment.reference_number}</span>
                  </div>
                ) : null}
              </div>

              {/* Quick status actions */}
              {quickStatusOptions.length > 0 && canEditPayments ? (
                <div className={styles.quickActions}>
                  {quickStatusOptions.map((nextStatus) => (
                    <button
                      key={nextStatus}
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => handleQuickStatus(nextStatus)}
                    >
                      {statusLabel(nextStatus)}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Existing allocations */}
              {selectedPayment.allocations.length > 0 ? (
                <>
                  <span className={styles.sectionLabel}>Allocations</span>
                  <div className={styles.allocationList}>
                    {selectedPayment.allocations.map((alloc) => (
                      <div key={alloc.id} className={styles.allocationRow}>
                        <span className={styles.allocationTarget}>
                          {alloc.target_type === "invoice" ? "Invoice" : "Bill"} #{alloc.target_id}
                        </span>
                        <span className={styles.allocationAmount}>${alloc.applied_amount}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {/* Allocate form (settled payments with targets) */}
              {selectedPayment.status === "settled" &&
               payableTargets.length > 0 &&
               canAllocatePayments &&
               Number(selectedPayment.unapplied_amount) > 0 ? (
                <>
                  <span className={styles.sectionLabel}>Allocate to {targetLabel}</span>
                  <form className={styles.allocationForm} onSubmit={handleAllocate}>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Target</span>
                      <select value={allocTargetId} onChange={(e) => setAllocTargetId(e.target.value)} required>
                        <option value="">Select {targetLabel.toLowerCase()}</option>
                        {payableTargets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.label} (due ${target.balanceDue})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Amount</span>
                      <input
                        value={allocAmount}
                        onChange={(e) => setAllocAmount(e.target.value)}
                        placeholder="0.00"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      className={styles.primaryButton}
                      disabled={!allocTargetId || !allocAmount || allocAmount === "0.00"}
                    >
                      Allocate
                    </button>
                  </form>
                </>
              ) : null}
            </div>
          ) : null}

          {/* Workspace form (create / edit) */}
          {canMutatePayments ? (
            <form className={styles.workspace} onSubmit={handleSubmit}>
              <h3 className={styles.workspaceTitle}>
                {workspaceMode === "create" ? "Record Payment" : `Editing Payment #${selectedPaymentId}`}
                <span className={styles.workspaceBadge}>
                  {workspaceMode === "create" ? "New" : "Edit"}
                </span>
              </h3>

              <div className={styles.fieldGrid}>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Method</span>
                  <select value={formMethod} onChange={(e) => setFormMethod(e.target.value as PaymentMethod)}>
                    {paymentMethods.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Amount</span>
                  <input value={formAmount} onChange={(e) => setFormAmount(e.target.value)} inputMode="decimal" required />
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Payment Date</span>
                  <input type="date" value={formPaymentDate} onChange={(e) => setFormPaymentDate(e.target.value)} required />
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Reference #</span>
                  <input value={formReferenceNumber} onChange={(e) => setFormReferenceNumber(e.target.value)} />
                </div>

                {workspaceMode === "edit" ? (
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>Status</span>
                    <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as PaymentStatus)}>
                      {selectedPaymentAllowedStatuses.map((v) => (
                        <option key={v} value={v}>{statusLabel(v)}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <span className={styles.fieldLabel}>Notes</span>
                  <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} />
                </div>
              </div>

              {/* Inline allocation on create */}
              {workspaceMode === "create" && payableTargets.length > 0 ? (
                <>
                  <p className={styles.inlineHint}>
                    Optionally allocate this payment to a {targetLabel.toLowerCase()} on creation.
                  </p>
                  <div className={styles.fieldGrid}>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>{targetLabel}</span>
                      <select value={allocTargetId} onChange={(e) => setAllocTargetId(e.target.value)}>
                        <option value="">None</option>
                        {payableTargets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.label} (due ${target.balanceDue})
                          </option>
                        ))}
                      </select>
                    </div>
                    {allocTargetId ? (
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>Allocation Amount</span>
                        <input value={allocAmount} onChange={(e) => setAllocAmount(e.target.value)} placeholder="0.00" />
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}

              <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={
                    workspaceMode === "create"
                      ? !selectedProjectId || !canCreatePayments
                      : !selectedPaymentId || !canEditPayments
                  }
                >
                  {workspaceMode === "create"
                    ? allocTargetId && allocAmount
                      ? "Record & Allocate"
                      : "Record Payment"
                    : "Save Changes"}
                </button>
                {workspaceMode === "edit" ? (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={resetToCreate}
                  >
                    + Record New Payment
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
