"use client";

/**
 * Full payment recording console for a project's cash management lifecycle.
 * Supports creating, editing, and allocating inbound/outbound payments with
 * direction-aware target resolution (invoices for inbound, vendor bills for outbound).
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { todayDateInput } from "@/shared/date-format";

import {
  defaultApiBaseUrl,
  fetchPaymentPolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { canDo } from "../../session/rbac";
import {
  ApiResponse,
  InvoiceRecord,
  PaymentAllocateResult,
  PaymentAllocationTargetType,
  PaymentDirection,
  PaymentMethod,
  PaymentPolicyContract,
  PaymentRecord,
  PaymentStatus,
  ProjectRecord,
  VendorBillRecord,
} from "../types";
import styles from "./payments-console.module.css";

const PAYMENT_STATUSES_FALLBACK = ["pending", "settled", "void"];
const PAYMENT_STATUS_LABELS_FALLBACK: Record<string, string> = {
  pending: "Pending",
  settled: "Settled",
  void: "Void",
};
const PAYMENT_DIRECTIONS_FALLBACK = ["inbound", "outbound"];
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

/** Return a contextual hint about the next workflow step for a given payment status. */
function paymentNextActionHint(status: PaymentStatus): string {
  if (status === "pending") {
    return "Next: settle once funds are confirmed, or void if cancelled.";
  }
  if (status === "settled") {
    return "Next: allocate this payment to invoice/vendor-bill targets.";
  }
  if (status === "void") {
    return "Payment is void and cannot be allocated.";
  }
  return "Use allowed transitions from the policy contract.";
}

/** Full payment lifecycle console: create, edit, transition, and allocate payments per project. */
export function PaymentsConsole() {
  const { token, authMessage, role, capabilities } = useSharedSessionAuth();
  const [statusMessage, setStatusMessage] = useState("");

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [paymentStatuses, setPaymentStatuses] = useState<string[]>(PAYMENT_STATUSES_FALLBACK);
  const [paymentStatusLabels, setPaymentStatusLabels] = useState<Record<string, string>>(
    PAYMENT_STATUS_LABELS_FALLBACK,
  );
  const [paymentDirections, setPaymentDirections] = useState<string[]>(PAYMENT_DIRECTIONS_FALLBACK);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(PAYMENT_METHODS_FALLBACK);
  const [paymentAllowedTransitions, setPaymentAllowedTransitions] = useState<Record<string, string[]>>(
    PAYMENT_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
  );
  const [allocationTargetByDirection, setAllocationTargetByDirection] = useState<
    Record<string, PaymentAllocationTargetType>
  >(PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK);
  const [defaultCreateDirection, setDefaultCreateDirection] = useState<string>("inbound");
  const [defaultCreateMethod, setDefaultCreateMethod] = useState<string>("ach");
  const [defaultCreateStatus, setDefaultCreateStatus] = useState<string>("settled");

  const [newDirection, setNewDirection] = useState<PaymentDirection>("inbound");
  const [newMethod, setNewMethod] = useState<PaymentMethod>("ach");
  const [newStatus, setNewStatus] = useState<PaymentStatus>("settled");
  const [newAmount, setNewAmount] = useState("0.00");
  const [newPaymentDate, setNewPaymentDate] = useState(todayDateInput());
  const [newReferenceNumber, setNewReferenceNumber] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const [direction, setDirection] = useState<PaymentDirection>("inbound");
  const [method, setMethod] = useState<PaymentMethod>("ach");
  const [status, setStatus] = useState<PaymentStatus>("settled");
  const [amount, setAmount] = useState("0.00");
  const [paymentDate, setPaymentDate] = useState(todayDateInput());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [invoiceTargets, setInvoiceTargets] = useState<InvoiceRecord[]>([]);
  const [vendorBillTargets, setVendorBillTargets] = useState<VendorBillRecord[]>([]);
  const [allocationTargetType, setAllocationTargetType] =
    useState<PaymentAllocationTargetType>("invoice");
  const [allocationTargetId, setAllocationTargetId] = useState("");
  const [allocationAmount, setAllocationAmount] = useState("0.00");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const searchParams = useSearchParams();
  const canCreatePayments = canDo(capabilities, "payments", "create");
  const canEditPayments = canDo(capabilities, "payments", "edit");
  const canAllocatePayments = canDo(capabilities, "payments", "allocate");
  const scopedProjectIdParam = searchParams.get("project");
  const scopedProjectId =
    scopedProjectIdParam && /^\d+$/.test(scopedProjectIdParam) ? Number(scopedProjectIdParam) : null;
  const selectedPayment = useMemo(
    () => payments.find((payment) => String(payment.id) === selectedPaymentId),
    [payments, selectedPaymentId],
  );
  const selectedPaymentAllowedStatuses = selectedPayment
    ? [selectedPayment.status, ...(paymentAllowedTransitions[selectedPayment.status] ?? [])]
        .filter((value, index, source) => source.indexOf(value) === index)
    : paymentStatuses;
  const quickStatusOptions = selectedPayment
    ? paymentAllowedTransitions[selectedPayment.status] ?? []
    : [];

  /** Populate the edit form fields from a selected payment record. */
  function hydratePayment(payment: PaymentRecord) {
    setDirection(payment.direction);
    setMethod(payment.method);
    setStatus(payment.status);
    setAmount(payment.amount);
    setPaymentDate(payment.payment_date);
    setReferenceNumber(payment.reference_number);
    setNotes(payment.notes);
    setAllocationTargetType(
      allocationTargetByDirection[payment.direction] ??
        PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK.inbound,
    );
  }

  /** Reset the create-payment form to default values. */
  function clearCreateForm() {
    setNewDirection(defaultCreateDirection);
    setNewMethod(defaultCreateMethod);
    setNewStatus(defaultCreateStatus);
    setNewAmount("0.00");
    setNewPaymentDate(todayDateInput());
    setNewReferenceNumber("");
    setNewNotes("");
  }

  /** Resolve a display label for a payment status value. */
  function paymentStatusDisplayLabel(value: string): string {
    return paymentStatusLabels[value] ?? value;
  }

  /** Fetch the payment policy contract and hydrate statuses, directions, methods, and transitions. */
  async function loadPaymentPolicy() {
    try {
      const response = await fetchPaymentPolicyContract({
        baseUrl: normalizedBaseUrl,
        token,
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        return;
      }
      const contract = payload.data as PaymentPolicyContract;
      if (
        !Array.isArray(contract.statuses) ||
        !contract.statuses.length ||
        !Array.isArray(contract.directions) ||
        !contract.directions.length ||
        !Array.isArray(contract.methods) ||
        !contract.methods.length ||
        !contract.allowed_status_transitions
      ) {
        return;
      }
      const normalizedTransitions = contract.statuses.reduce<Record<string, string[]>>(
        (acc, statusValue) => {
          const nextStatuses = contract.allowed_status_transitions[statusValue];
          acc[statusValue] = Array.isArray(nextStatuses) ? nextStatuses : [];
          return acc;
        },
        {},
      );
      const nextDefaultDirection =
        contract.default_create_direction || contract.directions[0] || PAYMENT_DIRECTIONS_FALLBACK[0];
      const nextDefaultMethod =
        contract.default_create_method || contract.methods[0] || PAYMENT_METHODS_FALLBACK[0];
      const nextDefaultStatus =
        contract.default_create_status || contract.statuses[0] || PAYMENT_STATUSES_FALLBACK[0];

      setPaymentStatuses(contract.statuses);
      setPaymentStatusLabels({
        ...PAYMENT_STATUS_LABELS_FALLBACK,
        ...(contract.status_labels || {}),
      });
      setPaymentDirections(contract.directions);
      setPaymentMethods(contract.methods);
      setPaymentAllowedTransitions(normalizedTransitions);
      setAllocationTargetByDirection({
        ...PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK,
        ...(contract.allocation_target_by_direction || {}),
      });
      setDefaultCreateDirection(nextDefaultDirection);
      setDefaultCreateMethod(nextDefaultMethod);
      setDefaultCreateStatus(nextDefaultStatus);
      setNewDirection((current) =>
        contract.directions.includes(current) ? current : nextDefaultDirection,
      );
      setDirection((current) => (contract.directions.includes(current) ? current : nextDefaultDirection));
      setNewMethod((current) => (contract.methods.includes(current) ? current : nextDefaultMethod));
      setMethod((current) => (contract.methods.includes(current) ? current : nextDefaultMethod));
      setNewStatus((current) => (contract.statuses.includes(current) ? current : nextDefaultStatus));
      setStatus((current) => (contract.statuses.includes(current) ? current : nextDefaultStatus));
    } catch {
      // Policy load is best-effort; static fallback remains active.
    }
  }

  /** Load the project list for the project selector dropdown. */
  async function loadProjects() {
    setStatusMessage("Loading projects...");

    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load projects.");
        return;
      }

      const rows = (payload.data as ProjectRecord[]) ?? [];
      setProjects(rows);
      if (rows[0]) {
        const scopedProject = scopedProjectId
          ? rows.find((project) => project.id === scopedProjectId)
          : null;
        setSelectedProjectId(String((scopedProject ?? rows[0]).id));
      } else {
        setSelectedProjectId("");
      }
      setStatusMessage(`Loaded ${rows.length} project(s).`);
    } catch {
      setStatusMessage("Could not reach projects endpoint.");
    }
  }

  /** Load payments for the currently selected project. */
  async function loadPayments() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading payments...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/payments/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load payments.");
        return;
      }

      const rows = (payload.data as PaymentRecord[]) ?? [];
      setPayments(rows);
      if (rows[0]) {
        setSelectedPaymentId(String(rows[0].id));
        hydratePayment(rows[0]);
      } else {
        setSelectedPaymentId("");
        setInvoiceTargets([]);
        setVendorBillTargets([]);
      }
      setStatusMessage(`Loaded ${rows.length} payment(s).`);
    } catch {
      setStatusMessage("Could not reach payments endpoint.");
    }
  }

  /** Submit a new payment record for the selected project. */
  async function handleCreatePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreatePayments) {
      setStatusMessage(`Role ${role} does not have payment create permission.`);
      return;
    }

    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Creating payment...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/payments/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          direction: newDirection,
          method: newMethod,
          status: newStatus,
          amount: newAmount,
          payment_date: newPaymentDate,
          reference_number: newReferenceNumber,
          notes: newNotes,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Create payment failed.");
        return;
      }

      const created = payload.data as PaymentRecord;
      setPayments((current) => [created, ...current]);
      setSelectedPaymentId(String(created.id));
      hydratePayment(created);
      clearCreateForm();
      setStatusMessage(`Created payment #${created.id}.`);
    } catch {
      setStatusMessage("Could not reach payment create endpoint.");
    }
  }

  /** Switch the active payment selection and hydrate the edit form. */
  function handleSelectPayment(id: string) {
    setSelectedPaymentId(id);
    const selected = payments.find((payment) => String(payment.id) === id);
    if (!selected) return;

    hydratePayment(selected);

    setInvoiceTargets([]);
    setVendorBillTargets([]);
    setAllocationTargetId("");
  }

  /** Persist edits to the selected payment via PATCH. */
  async function handleSavePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEditPayments) {
      setStatusMessage(`Role ${role} does not have payment edit permission.`);
      return;
    }

    const paymentId = Number(selectedPaymentId);
    if (!paymentId) {
      setStatusMessage("Select a payment first.");
      return;
    }

    setStatusMessage("Saving payment...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/payments/${paymentId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          direction,
          method,
          status,
          amount,
          payment_date: paymentDate,
          reference_number: referenceNumber,
          notes,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Save payment failed.");
        return;
      }

      const updated = payload.data as PaymentRecord;
      setPayments((current) =>
        current.map((payment) => (payment.id === updated.id ? updated : payment)),
      );
      setStatusMessage(`Saved payment #${updated.id}.`);
    } catch {
      setStatusMessage("Could not reach payment detail endpoint.");
    }
  }

  /** Load invoice or vendor bill targets for the allocation form based on payment direction. */
  async function loadAllocationTargets() {
    const projectId = Number(selectedProjectId);
    const paymentId = Number(selectedPaymentId);
    if (!projectId || !paymentId || !selectedPayment) {
      setStatusMessage("Select a project and payment first.");
      return;
    }

    setStatusMessage("Loading allocation targets...");
    try {
      const expectedTargetType =
        allocationTargetByDirection[selectedPayment.direction] ??
        PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK.inbound;
      if (expectedTargetType === "invoice") {
        const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/invoices/`, {
          headers: buildAuthHeaders(token),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          setStatusMessage(payload.error?.message ?? "Could not load invoices.");
          return;
        }
        const rows = ((payload.data as InvoiceRecord[]) ?? []).filter(
          (row) => Number(row.balance_due) > 0,
        );
        setInvoiceTargets(rows);
        setVendorBillTargets([]);
        setAllocationTargetType("invoice");
        setAllocationTargetId(rows[0] ? String(rows[0].id) : "");
        setStatusMessage(`Loaded ${rows.length} invoice target(s).`);
        return;
      }

      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/vendor-bills/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load vendor bills.");
        return;
      }
      const rows = ((payload.data as VendorBillRecord[]) ?? []).filter(
        (row) => Number(row.balance_due) > 0,
      );
      setVendorBillTargets(rows);
      setInvoiceTargets([]);
      setAllocationTargetType("vendor_bill");
      setAllocationTargetId(rows[0] ? String(rows[0].id) : "");
      setStatusMessage(`Loaded ${rows.length} vendor bill target(s).`);
    } catch {
      setStatusMessage("Could not load allocation targets.");
    }
  }

  /** Create a payment allocation against the selected invoice or vendor bill target. */
  async function handleCreateAllocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAllocatePayments) {
      setStatusMessage(`Role ${role} does not have payment allocation permission.`);
      return;
    }

    const paymentId = Number(selectedPaymentId);
    const targetId = Number(allocationTargetId);
    if (!paymentId || !targetId) {
      setStatusMessage("Select a payment and target first.");
      return;
    }

    setStatusMessage("Creating allocation...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/payments/${paymentId}/allocate/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          allocations: [
            {
              target_type: allocationTargetType,
              target_id: targetId,
              applied_amount: allocationAmount,
            },
          ],
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Create allocation failed.");
        return;
      }

      const result = payload.data as PaymentAllocateResult;
      const updatedPayment = result.payment;
      setPayments((current) =>
        current.map((payment) => (payment.id === updatedPayment.id ? updatedPayment : payment)),
      );
      setSelectedPaymentId(String(updatedPayment.id));
      hydratePayment(updatedPayment);
      setAllocationAmount("0.00");
      setStatusMessage(
        `Allocation created. Allocated ${payload.meta?.allocated_total ?? updatedPayment.allocated_total}, unapplied ${payload.meta?.unapplied_amount ?? updatedPayment.unapplied_amount}.`,
      );
      await loadAllocationTargets();
    } catch {
      setStatusMessage("Could not reach payment allocation endpoint.");
    }
  }

  /** One-tap status transition for mobile quick actions (e.g. settle, void). */
  async function handleQuickPaymentStatus(nextStatus: PaymentStatus) {
    if (!canEditPayments) {
      setStatusMessage(`Role ${role} does not have payment edit permission.`);
      return;
    }
    const paymentId = Number(selectedPaymentId);
    if (!paymentId) {
      setStatusMessage("Select a payment first.");
      return;
    }
    setStatusMessage(`Updating payment status to ${nextStatus}...`);
    try {
      const response = await fetch(`${normalizedBaseUrl}/payments/${paymentId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Quick status update failed.");
        return;
      }
      const updated = payload.data as PaymentRecord;
      setPayments((current) =>
        current.map((payment) => (payment.id === updated.id ? updated : payment)),
      );
      hydratePayment(updated);
      setStatusMessage(`Updated payment #${updated.id} to ${updated.status}.`);
    } catch {
      setStatusMessage("Could not reach payment quick status endpoint.");
    }
  }

  // Hydrate payment policy (statuses, directions, methods, transitions) on auth.
  useEffect(() => {
    if (!token) {
      return;
    }
    void loadPaymentPolicy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <section className={styles.console}>
      <h2 className={styles.heading}>Payment Recording</h2>
      <p className={styles.copy}>
        Record inbound and outbound money movement with method, status, and reference tracking.
      </p>

      <p className={styles.authMessage}>{authMessage}</p>
      {!canCreatePayments && !canEditPayments ? (
        <p className={styles.readOnlyNotice}>
          Role `{role}` can view payments but cannot create, edit, or allocate.
        </p>
      ) : null}

      <button type="button" onClick={loadProjects}>
        Load Projects
      </button>

      {projects.length > 0 ? (
        <label>
          Project
          <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                #{project.id} - {project.name} ({project.customer_display_name})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <form onSubmit={handleCreatePayment}>
        <h3>Create Payment</h3>
        <label>
          Direction
          <select
            value={newDirection}
            onChange={(event) => setNewDirection(event.target.value as PaymentDirection)}
          >
            {paymentDirections.map((value) => (
              <option key={`create-direction-${value}`} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Method
          <select value={newMethod} onChange={(event) => setNewMethod(event.target.value as PaymentMethod)}>
            {paymentMethods.map((value) => (
              <option key={`create-method-${value}`} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={newStatus} onChange={(event) => setNewStatus(event.target.value as PaymentStatus)}>
            {paymentStatuses.map((value) => (
              <option key={`create-status-${value}`} value={value}>
                {paymentStatusDisplayLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input value={newAmount} onChange={(event) => setNewAmount(event.target.value)} required />
        </label>
        <label>
          Payment date
          <input
            type="date"
            value={newPaymentDate}
            onChange={(event) => setNewPaymentDate(event.target.value)}
            required
          />
        </label>
        <label>
          Reference number
          <input
            value={newReferenceNumber}
            onChange={(event) => setNewReferenceNumber(event.target.value)}
          />
        </label>
        <label>
          Notes
          <textarea value={newNotes} onChange={(event) => setNewNotes(event.target.value)} rows={3} />
        </label>

        <button type="submit" disabled={!selectedProjectId || !canCreatePayments}>
          Create Payment
        </button>
      </form>

      <button type="button" onClick={loadPayments} disabled={!selectedProjectId}>
        Load Payments for Selected Project
      </button>

      {payments.length > 0 ? (
        <label>
          Payment
          <select value={selectedPaymentId} onChange={(event) => handleSelectPayment(event.target.value)}>
            {payments.map((payment) => (
              <option key={payment.id} value={payment.id}>
                #{payment.id} - {payment.direction} {payment.amount} ({payment.status})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>No payments yet for this project. Create one to start reconciliation.</p>
      )}

      {selectedPayment ? (
        <p>
          Selected payment #{selectedPayment.id}: status{" "}
          {paymentStatusDisplayLabel(selectedPayment.status)} | allocated{" "}
          {selectedPayment.allocated_total} | unapplied {selectedPayment.unapplied_amount}.{" "}
          {paymentNextActionHint(selectedPayment.status)}
        </p>
      ) : null}

      <form onSubmit={handleSavePayment}>
        <h3>Update Selected Payment</h3>
        <label>
          Direction
          <select value={direction} onChange={(event) => setDirection(event.target.value as PaymentDirection)}>
            {paymentDirections.map((value) => (
              <option key={`edit-direction-${value}`} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Method
          <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
            {paymentMethods.map((value) => (
              <option key={`edit-method-${value}`} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as PaymentStatus)}>
            {selectedPaymentAllowedStatuses.map((value) => (
              <option key={`edit-status-${value}`} value={value}>
                {paymentStatusDisplayLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input value={amount} onChange={(event) => setAmount(event.target.value)} required />
        </label>
        <label>
          Payment date
          <input
            type="date"
            value={paymentDate}
            onChange={(event) => setPaymentDate(event.target.value)}
            required
          />
        </label>
        <label>
          Reference number
          <input value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>

        <button type="submit" disabled={!selectedPaymentId || !canEditPayments}>
          Save Payment
        </button>
        <p>Mobile quick actions:</p>
        <p>
          {quickStatusOptions.map((nextStatus) => (
            <button
              key={`quick-status-${nextStatus}`}
              type="button"
              onClick={() => handleQuickPaymentStatus(nextStatus)}
              disabled={!selectedPaymentId || !canEditPayments}
            >
              {paymentStatusDisplayLabel(nextStatus)}
            </button>
          ))}
        </p>
      </form>

      <section>
        <h3>Allocate Selected Payment</h3>
        <p>
          Direction-aware allocation: inbound payments allocate to invoices, outbound payments
          allocate to vendor bills. Payment must be <code>settled</code>.
        </p>
        <button type="button" onClick={loadAllocationTargets} disabled={!selectedPaymentId}>
          Load Allocation Targets
        </button>

        {selectedPayment ? (
          <p>
            Allocated: {selectedPayment.allocated_total} | Unapplied: {selectedPayment.unapplied_amount}
          </p>
        ) : null}

        <form onSubmit={handleCreateAllocation}>
          <label>
            Target type
            <select
              value={allocationTargetType}
              onChange={(event) =>
                setAllocationTargetType(event.target.value as PaymentAllocationTargetType)
              }
              disabled
            >
              <option value="invoice">invoice</option>
              <option value="vendor_bill">vendor_bill</option>
            </select>
          </label>
          <label>
            Target
            <select
              value={allocationTargetId}
              onChange={(event) => setAllocationTargetId(event.target.value)}
              required
            >
              <option value="">Select target</option>
              {allocationTargetType === "invoice"
                ? invoiceTargets.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      #{invoice.id} - {invoice.invoice_number} (due {invoice.balance_due})
                    </option>
                  ))
                : vendorBillTargets.map((bill) => (
                    <option key={bill.id} value={bill.id}>
                      #{bill.id} - {bill.bill_number} (due {bill.balance_due})
                    </option>
                  ))}
            </select>
          </label>
          <label>
            Applied amount
            <input
              value={allocationAmount}
              onChange={(event) => setAllocationAmount(event.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            disabled={
              !canAllocatePayments ||
              !selectedPaymentId ||
              !allocationTargetId ||
              allocationAmount === "0.00"
            }
          >
            Create Allocation
          </button>
        </form>

        {selectedPayment && selectedPayment.allocations.length > 0 ? (
          <label>
            Existing allocations
            <textarea
              value={selectedPayment.allocations
                .map(
                  (allocation) =>
                    `#${allocation.id} ${allocation.target_type} #${allocation.target_id} (${allocation.applied_amount})`,
                )
                .join("\n")}
              readOnly
              rows={Math.min(8, selectedPayment.allocations.length + 1)}
            />
          </label>
        ) : null}
      </section>

      {statusMessage ? <p className={styles.statusMessage}>{statusMessage}</p> : null}
    </section>
  );
}
