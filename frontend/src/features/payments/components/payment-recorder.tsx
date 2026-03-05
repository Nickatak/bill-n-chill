"use client";

/**
 * Shared payment recording panel embedded in the Invoices and Bills pages.
 *
 * Direction-locked: inbound payments on the Invoices page, outbound on the
 * Bills page. Receives projectId and allocation targets from the parent
 * console so it doesn't duplicate project selection or target fetching.
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { todayDateInput } from "@/shared/date-format";

import {
  defaultApiBaseUrl,
  fetchPaymentPolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { canDo } from "../../session/rbac";
import type {
  AllocationTarget,
  ApiResponse,
  PaymentAllocateResult,
  PaymentAllocationTargetType,
  PaymentMethod,
  PaymentPolicyContract,
  PaymentRecord,
  PaymentStatus,
} from "../types";
import styles from "./payment-recorder.module.css";

// ---------------------------------------------------------------------------
// Fallback constants (used if policy contract fetch fails)
// ---------------------------------------------------------------------------

const PAYMENT_STATUSES_FALLBACK = ["pending", "settled", "failed", "void"];
const PAYMENT_STATUS_LABELS_FALLBACK: Record<string, string> = {
  pending: "Pending",
  settled: "Settled",
  failed: "Failed",
  void: "Void",
};
const PAYMENT_METHODS_FALLBACK = ["ach", "card", "check", "wire", "cash", "other"];
const PAYMENT_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, string[]> = {
  pending: ["settled", "failed", "void"],
  settled: ["void"],
  failed: ["void"],
  void: [],
};
const PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK: Record<string, PaymentAllocationTargetType> = {
  inbound: "invoice",
  outbound: "vendor_bill",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type PaymentRecorderProps = {
  projectId: number;
  direction: "inbound" | "outbound";
  allocationTargets: AllocationTarget[];
  onPaymentsChanged?: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a contextual hint about the next workflow step for a given payment status. */
function paymentNextActionHint(status: PaymentStatus): string {
  if (status === "pending") return "Next: settle or mark failed once bank confirmation is known.";
  if (status === "settled") return "Next: allocate this payment to targets.";
  if (status === "failed") return "Next: retry collection/disbursement or void if cancelled.";
  if (status === "void") return "Payment is void and cannot be allocated.";
  return "Use allowed transitions from the policy contract.";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PaymentRecorder({
  projectId,
  direction,
  allocationTargets,
  onPaymentsChanged,
}: PaymentRecorderProps) {
  const { token, role, capabilities } = useSharedSessionAuth();
  const [statusMessage, setStatusMessage] = useState("");

  // Policy state
  const [paymentStatuses, setPaymentStatuses] = useState<string[]>(PAYMENT_STATUSES_FALLBACK);
  const [paymentStatusLabels, setPaymentStatusLabels] = useState<Record<string, string>>(
    PAYMENT_STATUS_LABELS_FALLBACK,
  );
  const [paymentMethods, setPaymentMethods] = useState<string[]>(PAYMENT_METHODS_FALLBACK);
  const [paymentAllowedTransitions, setPaymentAllowedTransitions] = useState<Record<string, string[]>>(
    PAYMENT_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
  );
  const [allocationTargetByDirection, setAllocationTargetByDirection] = useState<
    Record<string, PaymentAllocationTargetType>
  >(PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK);
  const [defaultCreateMethod, setDefaultCreateMethod] = useState<string>("ach");
  const [defaultCreateStatus, setDefaultCreateStatus] = useState<string>("pending");

  // Payment list
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");

  // Create form (direction is locked from prop)
  const [newMethod, setNewMethod] = useState<PaymentMethod>("ach");
  const [newStatus, setNewStatus] = useState<PaymentStatus>("pending");
  const [newAmount, setNewAmount] = useState("0.00");
  const [newPaymentDate, setNewPaymentDate] = useState(todayDateInput());
  const [newReferenceNumber, setNewReferenceNumber] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // Edit form (direction is locked from prop)
  const [method, setMethod] = useState<PaymentMethod>("ach");
  const [status, setStatus] = useState<PaymentStatus>("pending");
  const [amount, setAmount] = useState("0.00");
  const [paymentDate, setPaymentDate] = useState(todayDateInput());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");

  // Allocation
  const [allocationTargetId, setAllocationTargetId] = useState("");
  const [allocationAmount, setAllocationAmount] = useState("0.00");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const canMutatePayments = canDo(capabilities, "payments", "create");
  const canAllocatePayments = canDo(capabilities, "payments", "allocate");

  const directionLabel = direction === "inbound" ? "Inbound" : "Outbound";
  const allocationTargetType: PaymentAllocationTargetType =
    allocationTargetByDirection[direction] ?? PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK[direction];

  // Filter to targets with balance > 0
  const payableTargets = useMemo(
    () => allocationTargets.filter((t) => Number(t.balanceDue) > 0),
    [allocationTargets],
  );

  const selectedPayment = useMemo(
    () => payments.find((p) => String(p.id) === selectedPaymentId),
    [payments, selectedPaymentId],
  );
  const selectedPaymentAllowedStatuses = selectedPayment
    ? [selectedPayment.status, ...(paymentAllowedTransitions[selectedPayment.status] ?? [])]
        .filter((v, i, a) => a.indexOf(v) === i)
    : paymentStatuses;
  const quickStatusOptions = selectedPayment
    ? paymentAllowedTransitions[selectedPayment.status] ?? []
    : [];

  // ── Helpers ───────────────────────────────────────────────

  function hydratePayment(payment: PaymentRecord) {
    setMethod(payment.method);
    setStatus(payment.status);
    setAmount(payment.amount);
    setPaymentDate(payment.payment_date);
    setReferenceNumber(payment.reference_number);
    setNotes(payment.notes);
  }

  function clearCreateForm() {
    setNewMethod(defaultCreateMethod);
    setNewStatus(defaultCreateStatus);
    setNewAmount("0.00");
    setNewPaymentDate(todayDateInput());
    setNewReferenceNumber("");
    setNewNotes("");
  }

  function paymentStatusDisplayLabel(value: string): string {
    return paymentStatusLabels[value] ?? value;
  }

  // ── API functions ─────────────────────────────────────────

  async function loadPaymentPolicy() {
    try {
      const response = await fetchPaymentPolicyContract({
        baseUrl: normalizedBaseUrl,
        token,
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) return;

      const contract = payload.data as PaymentPolicyContract;
      if (
        !Array.isArray(contract.statuses) ||
        !contract.statuses.length ||
        !Array.isArray(contract.methods) ||
        !contract.methods.length ||
        !contract.allowed_status_transitions
      )
        return;

      const normalizedTransitions = contract.statuses.reduce<Record<string, string[]>>((acc, s) => {
        const next = contract.allowed_status_transitions[s];
        acc[s] = Array.isArray(next) ? next : [];
        return acc;
      }, {});

      const nextDefaultMethod =
        contract.default_create_method || contract.methods[0] || PAYMENT_METHODS_FALLBACK[0];
      const nextDefaultStatus =
        contract.default_create_status || contract.statuses[0] || PAYMENT_STATUSES_FALLBACK[0];

      setPaymentStatuses(contract.statuses);
      setPaymentStatusLabels({ ...PAYMENT_STATUS_LABELS_FALLBACK, ...(contract.status_labels || {}) });
      setPaymentMethods(contract.methods);
      setPaymentAllowedTransitions(normalizedTransitions);
      setAllocationTargetByDirection({
        ...PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK,
        ...(contract.allocation_target_by_direction || {}),
      });
      setDefaultCreateMethod(nextDefaultMethod);
      setDefaultCreateStatus(nextDefaultStatus);
      setNewMethod((c) => (contract.methods.includes(c) ? c : nextDefaultMethod));
      setMethod((c) => (contract.methods.includes(c) ? c : nextDefaultMethod));
      setNewStatus((c) => (contract.statuses.includes(c) ? c : nextDefaultStatus));
      setStatus((c) => (contract.statuses.includes(c) ? c : nextDefaultStatus));
    } catch {
      // Best-effort; static fallback remains active.
    }
  }

  async function loadPayments() {
    if (!projectId) return;
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

      const rows = ((payload.data as PaymentRecord[]) ?? []).filter((p) => p.direction === direction);
      setPayments(rows);
      if (rows[0]) {
        setSelectedPaymentId(String(rows[0].id));
        hydratePayment(rows[0]);
      } else {
        setSelectedPaymentId("");
      }
      setStatusMessage(`Loaded ${rows.length} ${directionLabel.toLowerCase()} payment(s).`);
    } catch {
      setStatusMessage("Could not reach payments endpoint.");
    }
  }

  async function handleCreatePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutatePayments) {
      setStatusMessage(`Role ${role} is read-only for payment mutations.`);
      return;
    }
    if (!projectId) {
      setStatusMessage("No project selected.");
      return;
    }

    setStatusMessage("Creating payment...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/payments/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          direction,
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

  function handleSelectPayment(id: string) {
    setSelectedPaymentId(id);
    const selected = payments.find((p) => String(p.id) === id);
    if (!selected) return;
    hydratePayment(selected);
    setAllocationTargetId("");
  }

  async function handleSavePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutatePayments) {
      setStatusMessage(`Role ${role} is read-only for payment mutations.`);
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
      setPayments((current) => current.map((p) => (p.id === updated.id ? updated : p)));
      setStatusMessage(`Saved payment #${updated.id}.`);
    } catch {
      setStatusMessage("Could not reach payment detail endpoint.");
    }
  }

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
      setPayments((current) => current.map((p) => (p.id === updatedPayment.id ? updatedPayment : p)));
      setSelectedPaymentId(String(updatedPayment.id));
      hydratePayment(updatedPayment);
      setAllocationAmount("0.00");
      setStatusMessage(
        `Allocation created. Allocated ${payload.meta?.allocated_total ?? updatedPayment.allocated_total}, unapplied ${payload.meta?.unapplied_amount ?? updatedPayment.unapplied_amount}.`,
      );
      onPaymentsChanged?.();
    } catch {
      setStatusMessage("Could not reach payment allocation endpoint.");
    }
  }

  async function handleQuickPaymentStatus(nextStatus: PaymentStatus) {
    if (!canMutatePayments) {
      setStatusMessage(`Role ${role} is read-only for payment mutations.`);
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
      setPayments((current) => current.map((p) => (p.id === updated.id ? updated : p)));
      hydratePayment(updated);
      setStatusMessage(`Updated payment #${updated.id} to ${updated.status}.`);
    } catch {
      setStatusMessage("Could not reach payment quick status endpoint.");
    }
  }

  // ── Effects ───────────────────────────────────────────────

  // Load policy contract on auth.
  useEffect(() => {
    if (!token) return;
    void loadPaymentPolicy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Auto-load payments when projectId changes.
  useEffect(() => {
    if (!token || !projectId) return;
    void loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, projectId]);

  // ── Render ────────────────────────────────────────────────

  return (
    <section className={styles.recorder}>
      <h2 className={styles.heading}>{directionLabel} Payment Recording</h2>
      <p className={styles.copy}>
        {direction === "inbound"
          ? "Record payments received from customers and allocate them to invoices."
          : "Record payments made to vendors and allocate them to bills."}
      </p>

      {!canMutatePayments ? (
        <p className={styles.readOnlyNotice}>
          Role `{role}` can view payments but cannot create, edit, or allocate.
        </p>
      ) : null}

      <form onSubmit={handleCreatePayment}>
        <h3>Create Payment</h3>
        <label>
          Method
          <select value={newMethod} onChange={(e) => setNewMethod(e.target.value as PaymentMethod)}>
            {paymentMethods.map((v) => (
              <option key={`create-method-${v}`} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as PaymentStatus)}>
            {paymentStatuses.map((v) => (
              <option key={`create-status-${v}`} value={v}>{paymentStatusDisplayLabel(v)}</option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input value={newAmount} onChange={(e) => setNewAmount(e.target.value)} required />
        </label>
        <label>
          Payment date
          <input type="date" value={newPaymentDate} onChange={(e) => setNewPaymentDate(e.target.value)} required />
        </label>
        <label>
          Reference number
          <input value={newReferenceNumber} onChange={(e) => setNewReferenceNumber(e.target.value)} />
        </label>
        <label>
          Notes
          <textarea value={newNotes} onChange={(e) => setNewNotes(e.target.value)} rows={3} />
        </label>

        <button type="submit" disabled={!projectId || !canMutatePayments}>
          Create Payment
        </button>
      </form>

      {payments.length > 0 ? (
        <label>
          Payment
          <select value={selectedPaymentId} onChange={(e) => handleSelectPayment(e.target.value)}>
            {payments.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.id} - {p.amount} ({paymentStatusDisplayLabel(p.status)})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p>No {directionLabel.toLowerCase()} payments yet for this project.</p>
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
          Method
          <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {paymentMethods.map((v) => (
              <option key={`edit-method-${v}`} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as PaymentStatus)}>
            {selectedPaymentAllowedStatuses.map((v) => (
              <option key={`edit-status-${v}`} value={v}>{paymentStatusDisplayLabel(v)}</option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <label>
          Payment date
          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
        </label>
        <label>
          Reference number
          <input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>

        <button type="submit" disabled={!selectedPaymentId || !canMutatePayments}>
          Save Payment
        </button>
        {quickStatusOptions.length > 0 ? (
          <>
            <p>Quick actions:</p>
            <p>
              {quickStatusOptions.map((nextStatus) => (
                <button
                  key={`quick-status-${nextStatus}`}
                  type="button"
                  onClick={() => handleQuickPaymentStatus(nextStatus)}
                  disabled={!selectedPaymentId || !canMutatePayments}
                >
                  {paymentStatusDisplayLabel(nextStatus)}
                </button>
              ))}
            </p>
          </>
        ) : null}
      </form>

      <section>
        <h3>Allocate Selected Payment</h3>
        <p>
          {direction === "inbound"
            ? "Allocate settled payments to invoices with outstanding balance."
            : "Allocate settled payments to vendor bills with outstanding balance."}
          {" "}Payment must be <code>settled</code>.
        </p>

        {selectedPayment ? (
          <p>
            Allocated: {selectedPayment.allocated_total} | Unapplied: {selectedPayment.unapplied_amount}
          </p>
        ) : null}

        <form onSubmit={handleCreateAllocation}>
          <label>
            Target
            <select
              value={allocationTargetId}
              onChange={(e) => setAllocationTargetId(e.target.value)}
              required
            >
              <option value="">Select target</option>
              {payableTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label} (due {target.balanceDue})
                </option>
              ))}
            </select>
          </label>
          <label>
            Applied amount
            <input
              value={allocationAmount}
              onChange={(e) => setAllocationAmount(e.target.value)}
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
                  (a) => `#${a.id} ${a.target_type} #${a.target_id} (${a.applied_amount})`,
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
