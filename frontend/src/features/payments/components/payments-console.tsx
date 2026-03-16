"use client";

/**
 * Inbound payments console — standalone page at /payments.
 *
 * Form-first layout for quickly recording money received from clients.
 * Project select is a dropdown inside the form. Payment history for the
 * selected project lives below as a compact reference list.
 *
 * Outbound payments live on the Bills page (/bills) via PaymentRecorder.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useCombobox } from "@/shared/hooks/use-combobox";
import { todayDateInput, formatDateDisplay } from "@/shared/date-format";
import {
  defaultApiBaseUrl,
  fetchPaymentPolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { canDo } from "@/shared/session/rbac";
import { useStatusMessage } from "@/shared/hooks/use-status-message";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";
import type {
  AllocationTarget,
  ApiResponse,
  CustomerRecord,
  PaymentAllocateResult,
  PaymentMethod,
  PaymentPolicyContract,
  PaymentRecord,
  PaymentStatus,
  ProjectRecord,
  InvoiceRecord,
} from "../types";
import styles from "./payments-console.module.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIRECTION = "inbound" as const;

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
const PAYMENT_STATUSES_DISPLAY = ["pending", "settled", "void"];

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
  const { message: statusMessage, tone: statusTone, setNeutral, setSuccess, setError } = useStatusMessage();

  // -- URL params (deep-link from other pages) --
  const searchParams = useSearchParams();
  const urlCustomerId = searchParams.get("customer");
  const urlProjectId = searchParams.get("project");
  const scopedCustomerId = urlCustomerId && /^\d+$/.test(urlCustomerId) ? urlCustomerId : null;
  const scopedProjectId = urlProjectId && /^\d+$/.test(urlProjectId) ? urlProjectId : null;

  // -- Customers --
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(scopedCustomerId ?? "");
  const selectedCustomer = customers.find((c) => String(c.id) === selectedCustomerId) ?? null;

  // -- Projects --
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(scopedProjectId ?? "");
  const selectedProject = projects.find((p) => String(p.id) === selectedProjectId) ?? null;

  function projectDisplayLabel(p: ProjectRecord): string {
    return `${p.name} — ${p.customer_display_name}`;
  }

  // Filter projects by selected customer, then let the hook filter by query
  const customerProjects = useMemo(() => {
    if (!selectedCustomerId) return projects;
    return projects.filter((p) => String(p.customer) === selectedCustomerId);
  }, [projects, selectedCustomerId]);

  // Commit handlers live outside the hooks so they can reference each other's
  // setQuery without circular initialization issues.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const commitCustomerRef = { current: (_c: CustomerRecord | null) => {} };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const commitProjectRef = { current: (_p: ProjectRecord | null) => {} };

  const { inputRef: customerInputRef, menuRef: customerMenuRef, ...customerCombobox } = useCombobox<CustomerRecord>({
    items: customers,
    getLabel: (c) => c.display_name,
    onCommit: (c) => commitCustomerRef.current(c),
  });

  const { inputRef: projectInputRef, menuRef: projectMenuRef, ...projectCombobox } = useCombobox<ProjectRecord>({
    items: customerProjects,
    getLabel: (p) => `${p.name} ${p.customer_display_name}`,
    onCommit: (p) => commitProjectRef.current(p),
    syntheticPrefixCount: 1, // "No project" option
  });

  commitCustomerRef.current = (customer) => {
    if (customer) {
      setSelectedCustomerId(String(customer.id));
      customerCombobox.setQuery(customer.display_name);
    } else {
      setSelectedCustomerId("");
      customerCombobox.setQuery("");
    }
    // Clear project when customer changes (project must belong to customer)
    setSelectedProjectId("");
    projectCombobox.setQuery("");
    customerCombobox.close(!!customer);
  };

  commitProjectRef.current = (project) => {
    if (project) {
      setSelectedProjectId(String(project.id));
      projectCombobox.setQuery(projectDisplayLabel(project));
    } else {
      setSelectedProjectId("");
      projectCombobox.setQuery("");
    }
    projectCombobox.close(!!project);
  };

  function commitCustomer(customer: CustomerRecord | null) { commitCustomerRef.current(customer); }
  function commitProject(project: ProjectRecord | null) { commitProjectRef.current(project); }

  // -- Policy --
  const [paymentStatusLabels, setPaymentStatusLabels] = useState<Record<string, string>>(PAYMENT_STATUS_LABELS_FALLBACK);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(PAYMENT_METHODS_FALLBACK);
  const [paymentAllowedTransitions, setPaymentAllowedTransitions] = useState<Record<string, string[]>>(PAYMENT_ALLOWED_TRANSITIONS_FALLBACK);
  const [defaultCreateMethod, setDefaultCreateMethod] = useState<string>(PAYMENT_METHODS_FALLBACK[0]);

  // -- Payments --
  const [allPayments, setAllPayments] = useState<PaymentRecord[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [paymentStatusFilters, setPaymentStatusFilters] = useState<string[]>(["pending", "settled"]);
  const [paymentSearch, setPaymentSearch] = useState("");

  // -- Allocation targets (invoices for inbound) --
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);

  // -- Form --
  const [workspaceMode, setWorkspaceMode] = useState<"create" | "edit">("create");
  const [formMethod, setFormMethod] = useState<PaymentMethod>("check");
  const [formStatus, setFormStatus] = useState<PaymentStatus>("settled");
  const [formAmount, setFormAmount] = useState("");
  const [formPaymentDate, setFormPaymentDate] = useState(todayDateInput());
  const [formReferenceNumber, setFormReferenceNumber] = useState("");
  const [formNotes, setFormNotes] = useState("");

  // -- Allocation (disclosure) --
  const [showAllocation, setShowAllocation] = useState(false);
  const [allocTargetId, setAllocTargetId] = useState("");
  const [allocAmount, setAllocAmount] = useState("");

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------

  const inboundPayments = useMemo(
    () => allPayments.filter((p) => p.direction === DIRECTION),
    [allPayments],
  );

  const paymentStatusTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of inboundPayments) {
      totals.set(p.status, (totals.get(p.status) ?? 0) + 1);
    }
    return totals;
  }, [inboundPayments]);

  const statusFilteredPayments = useMemo(() => {
    if (!paymentStatusFilters.length) return [];
    return inboundPayments.filter((p) => paymentStatusFilters.includes(p.status));
  }, [inboundPayments, paymentStatusFilters]);

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
        p.customer_name,
        p.project_name,
      ].join(" ").toLowerCase();
      return haystack.includes(paymentNeedle);
    });
  }, [statusFilteredPayments, paymentNeedle]);

  const { page: paymentPage, totalPages: paymentTotalPages, totalCount: paymentTotalCount, paginatedItems: paginatedPayments, setPage: setPaymentPage } = useClientPagination(searchedPayments);

  const selectedPayment = useMemo(
    () => inboundPayments.find((p) => String(p.id) === selectedPaymentId),
    [inboundPayments, selectedPaymentId],
  );

  const quickStatusOptions = selectedPayment
    ? paymentAllowedTransitions[selectedPayment.status] ?? []
    : [];

  const selectedPaymentAllowedStatuses = selectedPayment
    ? [selectedPayment.status, ...(paymentAllowedTransitions[selectedPayment.status] ?? [])]
        .filter((v, i, a) => a.indexOf(v) === i)
    : [];

  const allocationTargets: AllocationTarget[] = useMemo(() => {
    return invoices.map((inv) => ({
      id: inv.id,
      label: inv.invoice_number || `Invoice #${inv.id}`,
      balanceDue: inv.balance_due,
    }));
  }, [invoices]);

  const payableTargets = useMemo(
    () => allocationTargets.filter((t) => Number(t.balanceDue) > 0),
    [allocationTargets],
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
    setSelectedCustomerId("");
    customerCombobox.setQuery("");
    setSelectedProjectId("");
    projectCombobox.setQuery("");
    setFormMethod(defaultCreateMethod);
    setFormStatus("settled");
    setFormAmount("");
    setFormPaymentDate(todayDateInput());
    setFormReferenceNumber("");
    setFormNotes("");
    setShowAllocation(false);
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
    setShowAllocation(false);
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
      setDefaultCreateMethod(nextDefaultMethod);
      setFormMethod((c) => (contract.methods.includes(c) ? c : nextDefaultMethod));
    } catch {
      // Best-effort; static fallback remains active.
    }
  }, [normalizedBaseUrl, token]);

  const loadCustomers = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${normalizedBaseUrl}/customers/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) return;
      const rows = (payload.data as CustomerRecord[]) ?? [];
      setCustomers(rows);
    } catch {
      // silent
    }
  }, [normalizedBaseUrl, token]);

  const loadProjects = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(token),
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
  }, [normalizedBaseUrl, token]);

  const loadPayments = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${normalizedBaseUrl}/payments/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) return;
      const rows = (payload.data as PaymentRecord[]) ?? [];
      setAllPayments(rows);
    } catch {
      // silent
    }
  }, [normalizedBaseUrl, token]);

  const loadInvoices = useCallback(async (projectId?: number) => {
    const resolvedId = projectId ?? Number(selectedProjectId);
    if (!token || !resolvedId) return;
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${resolvedId}/invoices/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (response.ok) {
        setInvoices((payload.data as InvoiceRecord[]) ?? []);
      }
    } catch {
      // silent
    }
  }, [normalizedBaseUrl, selectedProjectId, token]);

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!token) return;
    void loadPaymentPolicy();
    void loadCustomers();
    void loadProjects();
    void loadPayments();
  }, [loadPaymentPolicy, loadCustomers, loadProjects, loadPayments, token]);

  // Hydrate combobox display text when data arrives for URL-scoped selections
  useEffect(() => {
    if (!selectedCustomerId || customerCombobox.query) return;
    const match = customers.find((c) => String(c.id) === selectedCustomerId);
    if (match) customerCombobox.setQuery(match.display_name);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally depends on .query only, not the full combobox object
  }, [customers, selectedCustomerId, customerCombobox.query]);

  useEffect(() => {
    if (!selectedProjectId || projectCombobox.query) return;
    const match = projects.find((p) => String(p.id) === selectedProjectId);
    if (match) projectCombobox.setQuery(projectDisplayLabel(match));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally depends on .query only, not the full combobox object
  }, [projects, selectedProjectId, projectCombobox.query]);

  // Load invoices (allocation targets) when project selection changes
  useEffect(() => {
    const projectId = Number(selectedProjectId);
    if (!token || !projectId) {
      setInvoices([]);
      return;
    }
    void loadInvoices(projectId);
  }, [loadInvoices, selectedProjectId, token]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

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

    const customerId = Number(selectedCustomerId) || null;
    if (!customerId) {
      setError("Customer is required for inbound payments.");
      return;
    }

    setNeutral("Recording payment...");
    try {
      const projectId = Number(selectedProjectId) || null;
      const response = await fetch(`${normalizedBaseUrl}/payments/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          direction: DIRECTION,
          method: formMethod,
          amount: formAmount,
          payment_date: formPaymentDate,
          reference_number: formReferenceNumber,
          notes: formNotes,
          customer: customerId,
          ...(projectId ? { project: projectId } : {}),
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
                target_type: "invoice",
                target_id: Number(allocTargetId),
                applied_amount: allocAmount,
              }],
            }),
          });
          const allocPayload: ApiResponse = await allocResponse.json();
          if (allocResponse.ok) {
            const result = allocPayload.data as PaymentAllocateResult;
            created = result.payment;
            void loadInvoices();
          } else {
            setAllPayments((current) => [created, ...current]);
            setSelectedPaymentId(String(created.id));
            hydrateFromPayment(created);
            setError(`Recorded payment #${created.id}, but allocation failed: ${allocPayload.error?.message ?? "unknown error"}.`);
            return;
          }
        } catch {
          setAllPayments((current) => [created, ...current]);
          setSelectedPaymentId(String(created.id));
          hydrateFromPayment(created);
          setError(`Recorded payment #${created.id}, but could not reach allocation endpoint.`);
          return;
        }
      }

      setAllPayments((current) => [created, ...current]);
      setSelectedPaymentId(String(created.id));
      hydrateFromPayment(created);
      setSuccess(
        wantAllocate
          ? `Recorded and allocated payment #${created.id}.`
          : `Recorded payment #${created.id}.`,
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
          direction: DIRECTION,
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
      setError("Select a payment and invoice first.");
      return;
    }

    try {
      const response = await fetch(`${normalizedBaseUrl}/payments/${paymentId}/allocate/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          allocations: [{
            target_type: "invoice",
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
      setSuccess(`Allocated. Unapplied: $${updatedPayment.unapplied_amount}.`);
      void loadInvoices();
    } catch {
      setError("Could not reach payment allocation endpoint.");
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

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

          {/* ── Record Payment form (leads the page) ── */}
          {canMutatePayments ? (
            <form className={styles.recordForm} onSubmit={handleSubmit}>
              <div className={styles.recordHeader}>
                <h3 className={styles.recordTitle}>
                  {workspaceMode === "create" ? "Record Payment" : `Editing Payment #${selectedPaymentId}`}
                </h3>
                {workspaceMode === "edit" ? (
                  <button type="button" className={styles.secondaryButton} onClick={resetToCreate}>
                    + New
                  </button>
                ) : null}
              </div>

              <div className={styles.fieldGrid}>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Customer</span>
                  <div className={styles.projectCombobox}>
                    <div className={styles.projectInputWrap}>
                      <input
                        ref={customerInputRef}
                        className={styles.projectInput}
                        role="combobox"
                        aria-expanded={customerCombobox.isOpen}
                        aria-controls="customer-combobox-listbox"
                        value={customerCombobox.isOpen ? customerCombobox.query : (selectedCustomer ? selectedCustomer.display_name : "")}
                        placeholder="Type to search customers..."
                        onFocus={() => customerCombobox.open(selectedCustomer ? selectedCustomer.display_name : "")}
                        onChange={(e) => {
                          customerCombobox.handleInput(e.target.value);
                          if (selectedCustomerId) {
                            setSelectedCustomerId("");
                            setSelectedProjectId("");
                            projectCombobox.setQuery("");
                          }
                        }}
                        onKeyDown={customerCombobox.handleKeyDown}
                        autoComplete="off"
                        required
                      />
                      {selectedCustomerId ? (
                        <button
                          type="button"
                          className={styles.projectClear}
                          aria-label="Clear customer selection"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => commitCustomer(null)}
                        >
                          ×
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.projectClear}
                          aria-label="Open customer options"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { customerInputRef.current?.focus(); customerCombobox.open(""); }}
                        >
                          ▾
                        </button>
                      )}
                    </div>
                    {customerCombobox.isOpen ? (
                      <div ref={customerMenuRef} id="customer-combobox-listbox" className={styles.projectMenu} role="listbox">
                        {customerCombobox.filteredItems.map((c, i) => (
                          <button
                            key={c.id}
                            type="button"
                            role="option"
                            aria-selected={String(c.id) === selectedCustomerId}
                            className={`${styles.projectOption} ${customerCombobox.highlightIndex === i ? styles.projectOptionActive : ""}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => customerCombobox.setHighlightIndex(i)}
                            onClick={() => commitCustomer(c)}
                          >
                            {c.display_name}
                          </button>
                        ))}
                        {customerCombobox.filteredItems.length === 0 && customerCombobox.query.trim() ? (
                          <div className={styles.projectNoResults}>No matching customers.</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Project (optional)</span>
                  <div className={styles.projectCombobox}>
                    <div className={styles.projectInputWrap}>
                      <input
                        ref={projectInputRef}
                        className={styles.projectInput}
                        role="combobox"
                        aria-expanded={projectCombobox.isOpen}
                        aria-controls="project-combobox-listbox"
                        value={projectCombobox.isOpen ? projectCombobox.query : (selectedProject ? projectDisplayLabel(selectedProject) : "")}
                        placeholder="Type to search projects..."
                        onFocus={() => projectCombobox.open(selectedProject ? projectDisplayLabel(selectedProject) : "")}
                        onChange={(e) => {
                          projectCombobox.handleInput(e.target.value);
                          if (selectedProjectId) setSelectedProjectId("");
                        }}
                        onKeyDown={projectCombobox.handleKeyDown}
                        autoComplete="off"
                      />
                      {selectedProjectId ? (
                        <button
                          type="button"
                          className={styles.projectClear}
                          aria-label="Clear project selection"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => commitProject(null)}
                        >
                          ×
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.projectClear}
                          aria-label="Open project options"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { projectInputRef.current?.focus(); projectCombobox.open(""); }}
                        >
                          ▾
                        </button>
                      )}
                    </div>
                    {projectCombobox.isOpen ? (
                      <div ref={projectMenuRef} id="project-combobox-listbox" className={styles.projectMenu} role="listbox">
                        <button
                          type="button"
                          role="option"
                          aria-selected={!selectedProjectId}
                          className={`${styles.projectOption} ${projectCombobox.highlightIndex === 0 ? styles.projectOptionActive : ""}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => projectCombobox.setHighlightIndex(0)}
                          onClick={() => commitProject(null)}
                        >
                          No project
                        </button>
                        {projectCombobox.filteredItems.map((p, i) => {
                          const idx = i + 1;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              role="option"
                              aria-selected={String(p.id) === selectedProjectId}
                              className={`${styles.projectOption} ${projectCombobox.highlightIndex === idx ? styles.projectOptionActive : ""}`}
                              onMouseDown={(e) => e.preventDefault()}
                              onMouseEnter={() => projectCombobox.setHighlightIndex(idx)}
                              onClick={() => commitProject(p)}
                            >
                              <span className={styles.projectOptionName}>{p.name}</span>
                              <span className={styles.projectOptionCustomer}>{p.customer_display_name}</span>
                            </button>
                          );
                        })}
                        {projectCombobox.filteredItems.length === 0 && projectCombobox.query.trim() ? (
                          <div className={styles.projectNoResults}>No matching projects.</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Amount</span>
                  <input
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    required
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <span className={styles.fieldLabel}>Method</span>
                  <div className={styles.methodPills}>
                    {paymentMethods.map((v) => (
                      <button
                        key={v}
                        type="button"
                        className={`${styles.methodPill} ${v === formMethod ? styles.methodPillActive : ""}`}
                        aria-pressed={v === formMethod}
                        onClick={() => setFormMethod(v as PaymentMethod)}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Date</span>
                  <input type="date" value={formPaymentDate} onChange={(e) => setFormPaymentDate(e.target.value)} required />
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Reference #</span>
                  <input value={formReferenceNumber} onChange={(e) => setFormReferenceNumber(e.target.value)} placeholder="Check #, confirmation, etc." />
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
                  <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} placeholder="Optional" />
                </div>
              </div>

              {/* Allocation disclosure — create mode only */}
              {workspaceMode === "create" && payableTargets.length > 0 ? (
                <div className={styles.allocationDisclosure}>
                  <button
                    type="button"
                    className={styles.disclosureToggle}
                    onClick={() => setShowAllocation((v) => !v)}
                    aria-expanded={showAllocation}
                  >
                    {showAllocation ? "▾" : "▸"} Allocate to invoice
                  </button>
                  {showAllocation ? (
                    <div className={styles.allocationFields}>
                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>Invoice</span>
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
                          <span className={styles.fieldLabel}>Amount</span>
                          <input value={allocAmount} onChange={(e) => setAllocAmount(e.target.value)} placeholder="0.00" />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className={styles.formActions}>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={
                    workspaceMode === "create"
                      ? !canCreatePayments
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
                  <button type="button" className={styles.secondaryButton} onClick={resetToCreate}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          ) : null}

          {/* ── Selected payment detail ── */}
          {selectedPayment ? (
            <div className={styles.detailCard}>
              <div className={styles.detailHeader}>
                <h3 className={styles.detailTitle}>Payment #{selectedPayment.id}</h3>
                <span className={statusBadgeClass(selectedPayment.status)}>
                  {statusLabel(selectedPayment.status)}
                </span>
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
                          Invoice #{alloc.target_id}
                        </span>
                        <span className={styles.allocationAmount}>${alloc.applied_amount}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {/* Allocate form (settled payments with outstanding invoices) */}
              {selectedPayment.status === "settled" &&
               payableTargets.length > 0 &&
               canAllocatePayments &&
               Number(selectedPayment.unapplied_amount) > 0 ? (
                <>
                  <span className={styles.sectionLabel}>Allocate to Invoice</span>
                  <form className={styles.allocationForm} onSubmit={handleAllocate}>
                    <div className={styles.field}>
                      <span className={styles.fieldLabel}>Invoice</span>
                      <select value={allocTargetId} onChange={(e) => setAllocTargetId(e.target.value)} required>
                        <option value="">Select invoice</option>
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

          {/* ── Payment history (compact, below form) ── */}
          <section className={styles.historyPanel}>
            <div className={styles.historyHeader}>
              <h3 className={styles.historyTitle}>Payment History</h3>
                <span className={styles.historyCount}>
                  {inboundPayments.length} payment{inboundPayments.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div className={styles.historyControls}>
                <input
                  className={styles.historySearch}
                  type="text"
                  placeholder="Search..."
                  value={paymentSearch}
                  onChange={(e) => setPaymentSearch(e.target.value)}
                />
                <div className={styles.statusFilters}>
                  {PAYMENT_STATUSES_DISPLAY.map((status) => {
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
                            {payment.customer_name ? (
                              <span>{payment.customer_name}</span>
                            ) : null}
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
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <p className={styles.emptyState}>
                    {inboundPayments.length
                      ? paymentNeedle
                        ? "No payments match your search."
                        : "No payments match the selected filters."
                      : "No inbound payments yet for this project."}
                  </p>
                )}
              </div>
              <PaginationControls page={paymentPage} totalPages={paymentTotalPages} totalCount={paymentTotalCount} onPageChange={setPaymentPage} />
          </section>
        </>
      ) : null}
    </section>
  );
}
