/**
 * Payment form field state and lifecycle helpers.
 *
 * Owns every editable field in the Record Payment / Edit Payment form,
 * including the optional inline allocation disclosure fields. Provides
 * `resetToCreate()` to clear all fields back to defaults and
 * `hydrateFromPayment()` to populate fields from an existing record.
 *
 * Consumer: PaymentsConsole (composed alongside usePaymentData and
 * usePaymentFilters).
 *
 * ## State (useState)
 *
 * - workspaceMode       — "create" | "edit"; controls form heading and submit behavior
 * - formMethod          — payment method pill selection (check, ach, etc.)
 * - formStatus          — status dropdown value (edit mode only)
 * - formAmount          — dollar amount input
 * - formPaymentDate     — date input (defaults to today)
 * - formReferenceNumber — optional reference / check number
 * - formNotes           — optional notes textarea
 * - showAllocation      — disclosure toggle for inline allocation
 * - allocTargetId       — selected invoice id for allocation
 * - allocAmount         — dollar amount for allocation
 *
 * ## Functions
 *
 * - resetToCreate(defaultMethod)
 *     Clears all form fields to create-mode defaults. Accepts the
 *     current default method from the policy contract so it stays
 *     in sync with server-driven options.
 *
 * - hydrateFromPayment(payment)
 *     Populates form fields from an existing PaymentRecord for editing.
 *     Resets allocation disclosure state.
 */

import { useState } from "react";

import { todayDateInput } from "@/shared/date-format";

import type { PaymentMethod, PaymentRecord, PaymentStatus } from "../types";

/**
 * Manage payment form field state and mode transitions.
 *
 * @param initialMethod - Default payment method for new payments (from policy contract).
 * @returns Form field state, setters, and lifecycle helpers.
 */
export function usePaymentForm(initialMethod: PaymentMethod = "check") {

  // --- State ---

  const [workspaceMode, setWorkspaceMode] = useState<"create" | "edit">("create");
  const [formMethod, setFormMethod] = useState<PaymentMethod>(initialMethod);
  const [formStatus, setFormStatus] = useState<PaymentStatus>("settled");
  const [formAmount, setFormAmount] = useState("");
  const [formPaymentDate, setFormPaymentDate] = useState(todayDateInput());
  const [formReferenceNumber, setFormReferenceNumber] = useState("");
  const [formNotes, setFormNotes] = useState("");

  // Allocation disclosure (inline on create form)
  const [showAllocation, setShowAllocation] = useState(false);
  const [allocTargetId, setAllocTargetId] = useState("");
  const [allocAmount, setAllocAmount] = useState("");

  // --- Functions ---

  /** Clear all form fields to create-mode defaults. */
  function resetToCreate(defaultMethod: PaymentMethod) {
    setWorkspaceMode("create");
    setFormMethod(defaultMethod);
    setFormStatus("settled");
    setFormAmount("");
    setFormPaymentDate(todayDateInput());
    setFormReferenceNumber("");
    setFormNotes("");
    setShowAllocation(false);
    setAllocTargetId("");
    setAllocAmount("");
  }

  /** Populate form fields from an existing payment record (edit mode). */
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

  // --- Return bag ---

  return {
    // State
    workspaceMode,
    formMethod,
    formStatus,
    formAmount,
    formPaymentDate,
    formReferenceNumber,
    formNotes,
    showAllocation,
    allocTargetId,
    allocAmount,

    // Setters
    setWorkspaceMode,
    setFormMethod,
    setFormStatus,
    setFormAmount,
    setFormPaymentDate,
    setFormReferenceNumber,
    setFormNotes,
    setShowAllocation,
    setAllocTargetId,
    setAllocAmount,

    // Helpers
    resetToCreate,
    hydrateFromPayment,
  };
}
