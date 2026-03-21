"use client";

/**
 * Shared payment recording panel embedded in the Invoices and Bills pages.
 *
 * Direction-locked: inbound payments on the Invoices page, outbound on the
 * Bills page. Receives projectId and allocation targets from the parent
 * console so it doesn't duplicate project selection or target fetching.
 *
 * Every payment must allocate to exactly one document. The target selector
 * is required on create — the form is disabled when no allocation targets
 * exist for the project.
 *
 * Parent: QuickEntryTabs
 *
 * Layout: payment list → selected detail card → create/edit workspace.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { todayDateInput, formatDateDisplay } from "@/shared/date-format";

import {
  defaultApiBaseUrl,
  fetchPaymentPolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { canDo } from "@/shared/session/rbac";
import type {
  AllocationTarget,
  ApiResponse,
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

const PAYMENT_STATUS_LABELS_FALLBACK: Record<string, string> = {
  pending: "Pending",
  settled: "Settled",
  void: "Void",
};
const PAYMENT_METHODS_FALLBACK = ["check", "zelle", "ach", "cash", "wire", "card", "other"];
const PAYMENT_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, string[]> = {
  pending: ["settled", "void"],
  settled: ["void"],
  void: [],
};
const PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK: Record<string, PaymentAllocationTargetType[]> = {
  inbound: ["invoice"],
  outbound: ["vendor_bill", "receipt"],
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type PaymentRecorderProps = {
  projectId: number;
  direction: "inbound" | "outbound";
  allocationTargets: AllocationTarget[];
  onPaymentsChanged?: () => void;
  /** Hide the heading and description copy (e.g. when embedded in a parent with its own header). */
  hideHeader?: boolean;
  /** Show only the create form — hide the payment list and detail card (e.g. on project page). */
  createOnly?: boolean;
  /** Hide the workspace form title (e.g. when parent tabs already label the form). */
  hideWorkspaceTitle?: boolean;
};

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

export function PaymentRecorder({
  projectId,
  direction,
  allocationTargets,
  onPaymentsChanged,
  hideHeader = false,
  createOnly = false,
  hideWorkspaceTitle = false,
}: PaymentRecorderProps) {
  const { token: authToken, role, capabilities } = useSharedSessionAuth();
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<"info" | "success" | "error">("info");

  // Policy state
  const [paymentStatusLabels, setPaymentStatusLabels] = useState<Record<string, string>>(
    PAYMENT_STATUS_LABELS_FALLBACK,
  );
  const [paymentMethods, setPaymentMethods] = useState<string[]>(PAYMENT_METHODS_FALLBACK);
  const [paymentAllowedTransitions, setPaymentAllowedTransitions] = useState<Record<string, string[]>>(
    PAYMENT_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
  );
  const [allocationTargetByDirection, setAllocationTargetByDirection] = useState<
    Record<string, PaymentAllocationTargetType[]>
  >(PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK);
  const [defaultCreateMethod, setDefaultCreateMethod] = useState<string>(PAYMENT_METHODS_FALLBACK[0]);

  // Payment list
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");

  // Workspace mode
  const [workspaceMode, setWorkspaceMode] = useState<"create" | "edit">("create");

  // Form fields (shared between create and edit)
  const [formMethod, setFormMethod] = useState<PaymentMethod>("check");
  const [formStatus, setFormStatus] = useState<PaymentStatus>("settled");
  const [formAmount, setFormAmount] = useState("0.00");
  const [formPaymentDate, setFormPaymentDate] = useState(todayDateInput());
  const [formReferenceNumber, setFormReferenceNumber] = useState("");
  const [formNotes, setFormNotes] = useState("");

  // Target document (required — every payment must allocate to a document)
  const [allocTargetId, setAllocTargetId] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const canCreatePayments = canDo(capabilities, "payments", "create");
  const canEditPayments = canDo(capabilities, "payments", "edit");

  const directionLabel = direction === "inbound" ? "Inbound" : "Outbound";
  const targetLabel = direction === "inbound" ? "Invoice" : "Bill";
  const allocationTargetTypes = allocationTargetByDirection[direction] ?? PAYMENT_ALLOCATION_TARGET_BY_DIRECTION_FALLBACK[direction];
  const allocationTargetType: PaymentAllocationTargetType = allocationTargetTypes[0];

  const payableTargets = useMemo(
    () => allocationTargets.filter((t) => Number(t.balanceDue) > 0),
    [allocationTargets],
  );

  const selectedPayment = useMemo(
    () => payments.find((p) => String(p.id) === selectedPaymentId),
    [payments, selectedPaymentId],
  );

  const quickStatusOptions = selectedPayment
    ? paymentAllowedTransitions[selectedPayment.status] ?? []
    : [];

  const selectedPaymentAllowedStatuses = selectedPayment
    ? [selectedPayment.status, ...(paymentAllowedTransitions[selectedPayment.status] ?? [])]
        .filter((v, i, a) => a.indexOf(v) === i)
    : [];

  // ── Helpers ───────────────────────────────────────────────

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
  }

  function hydrateFromPayment(payment: PaymentRecord) {
    if (createOnly) return;
    setWorkspaceMode("edit");
    setFormMethod(payment.method);
    setFormStatus(payment.status);
    setFormAmount(payment.amount);
    setFormPaymentDate(payment.payment_date);
    setFormReferenceNumber(payment.reference_number);
    setFormNotes(payment.notes);
    setAllocTargetId("");
  }

  function setMessage(msg: string, tone: "info" | "success" | "error" = "info") {
    setStatusMessage(msg);
    setStatusTone(tone);
  }

  // ── API functions ─────────────────────────────────────────

  async function loadPaymentPolicy() {
    try {
      const response = await fetchPaymentPolicyContract({ baseUrl: normalizedBaseUrl, authToken });
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

      const nextDefaultMethod =
        contract.default_create_method || contract.methods[0] || PAYMENT_METHODS_FALLBACK[0];

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
  }

  async function loadPayments() {
    if (!projectId) return;
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/payments/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Could not load payments.", "error");
        return;
      }

      const rows = ((payload.data as PaymentRecord[]) ?? []).filter((p) => p.direction === direction);
      setPayments(rows);

      if (rows[0] && !selectedPaymentId) {
        setSelectedPaymentId(String(rows[0].id));
        hydrateFromPayment(rows[0]);
      } else if (!rows.length) {
        resetToCreate();
      }
    } catch {
      setMessage("Could not reach payments endpoint.", "error");
    }
  }

  function handleSelectPayment(payment: PaymentRecord) {
    if (createOnly) return;
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
      setMessage(`Role ${role} does not have payment create permission.`, "error");
      return;
    }
    if (!projectId) {
      setMessage("No project selected.", "error");
      return;
    }
    if (!allocTargetId) {
      setMessage(`Select a ${targetLabel.toLowerCase()} to allocate this payment to.`, "error");
      return;
    }

    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/payments/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({
          direction,
          method: formMethod,
          amount: formAmount,
          payment_date: formPaymentDate,
          reference_number: formReferenceNumber,
          notes: formNotes,
          target_type: allocationTargetType,
          target_id: Number(allocTargetId),
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Create payment failed.", "error");
        return;
      }

      const created = payload.data as PaymentRecord;
      setPayments((current) => [created, ...current]);
      setSelectedPaymentId(String(created.id));
      hydrateFromPayment(created);
      setMessage(`Recorded payment #${created.id}.`, "success");
      onPaymentsChanged?.();
    } catch {
      setMessage("Could not reach payment create endpoint.", "error");
    }
  }

  async function handleUpdate() {
    if (!canEditPayments) {
      setMessage(`Role ${role} does not have payment edit permission.`, "error");
      return;
    }
    const paymentId = Number(selectedPaymentId);
    if (!paymentId) {
      setMessage("Select a payment first.", "error");
      return;
    }

    try {
      const response = await fetch(`${normalizedBaseUrl}/payments/${paymentId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
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
        setMessage(payload.error?.message ?? "Save payment failed.", "error");
        return;
      }

      const updated = payload.data as PaymentRecord;
      setPayments((current) => current.map((p) => (p.id === updated.id ? updated : p)));
      setMessage(`Saved payment #${updated.id}.`, "success");
    } catch {
      setMessage("Could not reach payment detail endpoint.", "error");
    }
  }

  async function handleQuickStatus(nextStatus: PaymentStatus) {
    if (!canEditPayments) {
      setMessage(`Role ${role} does not have payment edit permission.`, "error");
      return;
    }
    const paymentId = Number(selectedPaymentId);
    if (!paymentId) return;

    try {
      const response = await fetch(`${normalizedBaseUrl}/payments/${paymentId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setMessage(payload.error?.message ?? "Status update failed.", "error");
        return;
      }
      const updated = payload.data as PaymentRecord;
      setPayments((current) => current.map((p) => (p.id === updated.id ? updated : p)));
      hydrateFromPayment(updated);
      setMessage(`Payment #${updated.id} → ${statusLabel(updated.status)}.`, "success");
    } catch {
      setMessage("Could not reach payment endpoint.", "error");
    }
  }

  // ── Effects ───────────────────────────────────────────────

  useEffect(() => {
    if (!authToken) return;
    void loadPaymentPolicy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  useEffect(() => {
    if (!authToken || !projectId) return;
    void loadPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, projectId]);

  // ── Render ────────────────────────────────────────────────

  return (
    <section className={styles.recorder}>
      {!hideHeader && (
        <>
          <h2 className={styles.heading}>{directionLabel} Payments</h2>
          <p className={styles.copy}>
            {direction === "inbound"
              ? "Record payments received from customers and allocate them to invoices."
              : "Record payments made to vendors and allocate them to bills."}
          </p>
        </>
      )}

      {!canCreatePayments && !canEditPayments ? (
        <p className={styles.readOnlyNotice}>
          Role <strong>{role}</strong> can view payments but cannot create or edit.
        </p>
      ) : null}

      {statusMessage ? (
        <p className={`${styles.statusBanner} ${
          statusTone === "success" ? styles.statusSuccess : statusTone === "error" ? styles.statusError : ""
        }`}>
          {statusMessage}
        </p>
      ) : null}

      {/* ── Payment list ──────────────────────────────────── */}

      {!createOnly && (payments.length > 0 ? (
        <>
          <div className={styles.paymentList}>
            {payments.map((payment) => {
              const isSelected = String(payment.id) === selectedPaymentId;
              return (
                <div
                  key={payment.id}
                  className={`${styles.paymentRow} ${isSelected ? styles.paymentRowSelected : ""}`}
                  onClick={() => handleSelectPayment(payment)}
                >
                  <span className={styles.paymentRowLabel}>
                    <span className={statusBadgeClass(payment.status)}>
                      {statusLabel(payment.status)}
                    </span>
                    <span className={styles.paymentRowMethod}>{payment.method}</span>
                    {payment.reference_number ? (
                      <span>#{payment.reference_number}</span>
                    ) : null}
                  </span>
                  <span className={styles.paymentRowAmount}>${payment.amount}</span>
                  <span style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
                    {formatDateDisplay(payment.payment_date)}
                  </span>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={resetToCreate}
          >
            + Record New Payment
          </button>
        </>
      ) : (
        <p className={styles.emptyState}>
          No {directionLabel.toLowerCase()} payments yet for this project.
        </p>
      ))}

      {/* ── Selected payment detail card ──────────────────── */}

      {!createOnly && selectedPayment ? (
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
              <span className={styles.metricLabel}>Method</span>
              <span className={styles.metricValue}>{selectedPayment.method}</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Date</span>
              <span className={styles.metricValue}>{formatDateDisplay(selectedPayment.payment_date)}</span>
            </div>
            {selectedPayment.target_type ? (
              <div className={styles.metric}>
                <span className={styles.metricLabel}>Target</span>
                <span className={styles.metricValue}>
                  {selectedPayment.target_type === "invoice" ? "Invoice" : selectedPayment.target_type === "vendor_bill" ? "Vendor Bill" : "Receipt"} #{selectedPayment.target_id}
                </span>
              </div>
            ) : null}
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
        </div>
      ) : null}

      {/* ── Workspace form (create / edit) ────────────────── */}

      <form className={`${styles.workspace} ${createOnly ? styles.workspaceEmbedded : ""}`} onSubmit={handleSubmit}>
        {!hideWorkspaceTitle && (
          <h3 className={styles.workspaceTitle}>
            {workspaceMode === "create" ? "Record Payment" : `Editing Payment #${selectedPaymentId}`}
            {!createOnly && (
              <span className={styles.workspaceBadge}>
                {workspaceMode === "create" ? "New" : "Edit"}
              </span>
            )}
          </h3>
        )}

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
            <input value={formAmount} onChange={(e) => setFormAmount(e.target.value)} required />
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

        {/* Target document (required for create) */}
        {workspaceMode === "create" ? (
          payableTargets.length > 0 ? (
            <div className={styles.fieldGrid}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{targetLabel}</span>
                <select value={allocTargetId} onChange={(e) => setAllocTargetId(e.target.value)} required>
                  <option value="">Select {targetLabel.toLowerCase()}</option>
                  {payableTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label} (due ${target.balanceDue})
                    </option>
                  ))}
                </select>
              </div>
              {allocTargetId ? (
                <div className={styles.quickAmountRow}>
                  {(() => {
                    const target = payableTargets.find((t) => String(t.id) === allocTargetId);
                    if (!target) return null;
                    const full = target.balanceDue;
                    const half = (Number(full) / 2).toFixed(2);
                    return (
                      <>
                        <button
                          type="button"
                          className={styles.quickAmountButton}
                          onClick={() => setFormAmount(full)}
                        >
                          Full (${full})
                        </button>
                        <button
                          type="button"
                          className={styles.quickAmountButton}
                          onClick={() => setFormAmount(half)}
                        >
                          50% (${half})
                        </button>
                      </>
                    );
                  })()}
                </div>
              ) : null}
            </div>
          ) : (
            <p className={styles.emptyState}>
              {direction === "inbound"
                ? "Create an invoice first to record payments."
                : "Create a vendor bill first to record payments."}
            </p>
          )
        ) : null}

        <button
          type="submit"
          className={styles.primaryButton}
          disabled={
            workspaceMode === "create"
              ? !projectId || !canCreatePayments || !allocTargetId
              : !selectedPaymentId || !canEditPayments
          }
        >
          {workspaceMode === "create" ? "Record Payment" : "Save Changes"}
        </button>
      </form>
    </section>
  );
}
