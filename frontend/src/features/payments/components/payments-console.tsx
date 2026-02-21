"use client";

import { FormEvent, useMemo, useState } from "react";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import {
  ApiResponse,
  InvoiceRecord,
  PaymentAllocateResult,
  PaymentAllocationTargetType,
  PaymentDirection,
  PaymentMethod,
  PaymentRecord,
  PaymentStatus,
  ProjectRecord,
  VendorBillRecord,
} from "../types";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function PaymentsConsole() {
  const { token, authMessage, role } = useSharedSessionAuth();
  const [statusMessage, setStatusMessage] = useState("");

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");

  const [newDirection, setNewDirection] = useState<PaymentDirection>("inbound");
  const [newMethod, setNewMethod] = useState<PaymentMethod>("ach");
  const [newStatus, setNewStatus] = useState<PaymentStatus>("pending");
  const [newAmount, setNewAmount] = useState("0.00");
  const [newPaymentDate, setNewPaymentDate] = useState(todayIsoDate());
  const [newReferenceNumber, setNewReferenceNumber] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const [direction, setDirection] = useState<PaymentDirection>("inbound");
  const [method, setMethod] = useState<PaymentMethod>("ach");
  const [status, setStatus] = useState<PaymentStatus>("pending");
  const [amount, setAmount] = useState("0.00");
  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [invoiceTargets, setInvoiceTargets] = useState<InvoiceRecord[]>([]);
  const [vendorBillTargets, setVendorBillTargets] = useState<VendorBillRecord[]>([]);
  const [allocationTargetType, setAllocationTargetType] =
    useState<PaymentAllocationTargetType>("invoice");
  const [allocationTargetId, setAllocationTargetId] = useState("");
  const [allocationAmount, setAllocationAmount] = useState("0.00");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const canMutatePayments = role === "owner" || role === "bookkeeping";
  const selectedPayment = useMemo(
    () => payments.find((payment) => String(payment.id) === selectedPaymentId),
    [payments, selectedPaymentId],
  );

  function hydratePayment(payment: PaymentRecord) {
    setDirection(payment.direction);
    setMethod(payment.method);
    setStatus(payment.status);
    setAmount(payment.amount);
    setPaymentDate(payment.payment_date);
    setReferenceNumber(payment.reference_number);
    setNotes(payment.notes);
    setAllocationTargetType(payment.direction === "inbound" ? "invoice" : "vendor_bill");
  }

  function clearCreateForm() {
    setNewDirection("inbound");
    setNewMethod("ach");
    setNewStatus("pending");
    setNewAmount("0.00");
    setNewPaymentDate(todayIsoDate());
    setNewReferenceNumber("");
    setNewNotes("");
  }

  async function loadProjects() {
    setStatusMessage("Loading projects...");

    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load projects.");
        return;
      }

      const rows = (payload.data as ProjectRecord[]) ?? [];
      setProjects(rows);
      if (rows[0]) {
        setSelectedProjectId(String(rows[0].id));
      } else {
        setSelectedProjectId("");
      }
      setStatusMessage(`Loaded ${rows.length} project(s).`);
    } catch {
      setStatusMessage("Could not reach projects endpoint.");
    }
  }

  async function loadPayments() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading payments...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/payments/`, {
        headers: { Authorization: `Token ${token}` },
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

  async function handleCreatePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutatePayments) {
      setStatusMessage(`Role ${role} is read-only for payment mutations.`);
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
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

  function handleSelectPayment(id: string) {
    setSelectedPaymentId(id);
    const selected = payments.find((payment) => String(payment.id) === id);
    if (!selected) return;
    hydratePayment(selected);
    setInvoiceTargets([]);
    setVendorBillTargets([]);
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
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

  async function loadAllocationTargets() {
    const projectId = Number(selectedProjectId);
    const paymentId = Number(selectedPaymentId);
    if (!projectId || !paymentId || !selectedPayment) {
      setStatusMessage("Select a project and payment first.");
      return;
    }

    setStatusMessage("Loading allocation targets...");
    try {
      if (selectedPayment.direction === "inbound") {
        const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/invoices/`, {
          headers: { Authorization: `Token ${token}` },
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
        headers: { Authorization: `Token ${token}` },
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

  async function handleCreateAllocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutatePayments) {
      setStatusMessage(`Role ${role} is read-only for payment mutations.`);
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
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

  return (
    <section>
      <h2>Payment Recording</h2>
      <p>Record inbound and outbound money movement with method, status, and reference tracking.</p>

      <p>{authMessage}</p>
      {!canMutatePayments ? <p>Role `{role}` can view payments but cannot create, edit, or allocate.</p> : null}

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
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
          </select>
        </label>
        <label>
          Method
          <select value={newMethod} onChange={(event) => setNewMethod(event.target.value as PaymentMethod)}>
            <option value="ach">ach</option>
            <option value="card">card</option>
            <option value="check">check</option>
            <option value="wire">wire</option>
            <option value="cash">cash</option>
            <option value="other">other</option>
          </select>
        </label>
        <label>
          Status
          <select value={newStatus} onChange={(event) => setNewStatus(event.target.value as PaymentStatus)}>
            <option value="pending">pending</option>
            <option value="settled">settled</option>
            <option value="failed">failed</option>
            <option value="void">void</option>
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

        <button type="submit" disabled={!selectedProjectId || !canMutatePayments}>
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
      ) : null}

      <form onSubmit={handleSavePayment}>
        <h3>Update Selected Payment</h3>
        <label>
          Direction
          <select value={direction} onChange={(event) => setDirection(event.target.value as PaymentDirection)}>
            <option value="inbound">inbound</option>
            <option value="outbound">outbound</option>
          </select>
        </label>
        <label>
          Method
          <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
            <option value="ach">ach</option>
            <option value="card">card</option>
            <option value="check">check</option>
            <option value="wire">wire</option>
            <option value="cash">cash</option>
            <option value="other">other</option>
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as PaymentStatus)}>
            <option value="pending">pending</option>
            <option value="settled">settled</option>
            <option value="failed">failed</option>
            <option value="void">void</option>
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

        <button type="submit" disabled={!selectedPaymentId || !canMutatePayments}>
          Save Payment
        </button>
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
              !canMutatePayments ||
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

      <p>{statusMessage}</p>
    </section>
  );
}
