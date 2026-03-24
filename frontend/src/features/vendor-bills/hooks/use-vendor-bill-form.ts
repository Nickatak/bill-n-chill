/**
 * Vendor bill create/edit form state.
 *
 * Manages two parallel sets of form fields — one for creating new bills,
 * one for editing existing bills — and routes reads/writes through unified
 * accessors based on the current mode. Also owns line item manipulation,
 * computed totals, and the duplicate-candidate list surfaced by 409s.
 *
 * Consumer: VendorBillsConsole (composed alongside useVendorBillViewer).
 *
 * ## State (useState)
 *
 * Create-mode fields:
 * - newVendorId, newBillNumber, newReceivedDate, newIssueDate, newDueDate
 * - newTaxAmount, newShippingAmount, newNotes, newLineItems
 *
 * Edit-mode fields:
 * - vendorId, billNumber, receivedDate, issueDate, dueDate
 * - taxAmount, shippingAmount, notes, lineItems, status
 *
 * Shared:
 * - duplicateCandidates — VendorBillRecord[] surfaced by 409 responses
 *
 * ## Functions
 *
 * - setForm*(value) — unified setters that route to create or edit state
 * - updateFormLineItem(index, patch) — patches a single row by index
 * - removeFormLineItem(index) — removes a row, keeping at least one
 * - addFormLineItem() — appends a blank row
 * - hydrate(item) — populates edit-mode fields from a VendorBillRecord
 * - resetCreateForm(options?) — clears create-mode to defaults
 *
 * ## Memos
 *
 * - computedSubtotal — sum of qty * unit_price across active line items
 */

import { useMemo, useState } from "react";
import { todayDateInput, futureDateInput } from "@/shared/date-format";
import {
  VendorBillLineFormRow,
  createEmptyVendorBillLineRow,
} from "../helpers";
import type { VendorBillRecord, VendorRecord } from "../types";

type UseVendorBillFormOptions = {
  /** Whether the form is in edit mode (true) or create mode (false). */
  isEditingMode: boolean;
  /** Active vendors, used by resetCreateForm to pre-select the first. */
  activeVendors: VendorRecord[];
};

/**
 * Manage vendor bill form fields for both create and edit modes.
 *
 * @param options - Mode flag and active vendor list.
 * @returns Unified form accessors, line item helpers, computed totals,
 *          hydrate/reset functions, and duplicate-candidate state.
 */
export function useVendorBillForm({
  isEditingMode,
  activeVendors,
}: UseVendorBillFormOptions) {

  // --- State (create-mode) ---

  const [newVendorId, setNewVendorId] = useState("");
  const [newBillNumber, setNewBillNumber] = useState("");
  const [newReceivedDate, setNewReceivedDate] = useState(todayDateInput());
  const [newIssueDate, setNewIssueDate] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newTaxAmount, setNewTaxAmount] = useState("0.00");
  const [newShippingAmount, setNewShippingAmount] = useState("0.00");
  const [newNotes, setNewNotes] = useState("");
  const [newLineItems, setNewLineItems] = useState<VendorBillLineFormRow[]>([
    createEmptyVendorBillLineRow(),
  ]);

  // --- State (edit-mode) ---

  const [vendorId, setVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayDateInput());
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [taxAmount, setTaxAmount] = useState("0.00");
  const [shippingAmount, setShippingAmount] = useState("0.00");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<VendorBillLineFormRow[]>([
    createEmptyVendorBillLineRow(),
  ]);
  const [status, setStatus] = useState<string>("open");

  // --- State (shared) ---

  const [duplicateCandidates, setDuplicateCandidates] = useState<VendorBillRecord[]>([]);

  // --- Derived (unified accessors) ---

  const formVendorId = isEditingMode ? vendorId : newVendorId;
  const formBillNumber = isEditingMode ? billNumber : newBillNumber;
  const formReceivedDate = isEditingMode ? receivedDate : newReceivedDate;
  const formIssueDate = isEditingMode ? issueDate : newIssueDate;
  const formDueDate = isEditingMode ? dueDate : newDueDate;
  const formTaxAmount = isEditingMode ? taxAmount : newTaxAmount;
  const formShippingAmount = isEditingMode ? shippingAmount : newShippingAmount;
  const formNotes = isEditingMode ? notes : newNotes;
  const formLineItems = isEditingMode ? lineItems : newLineItems;
  const formTaxAmountValue = Number(formTaxAmount || 0);
  const formShippingAmountValue = Number(formShippingAmount || 0);

  // --- Memos ---

  const computedSubtotal = useMemo(
    () => formLineItems.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.unit_price) || 0), 0),
    [formLineItems],
  );

  const computedTotal = computedSubtotal + formTaxAmountValue + formShippingAmountValue;

  // --- Functions (unified setters) ---

  /** Routes vendor ID changes to the correct create/edit state. */
  function setFormVendorId(value: string) {
    if (isEditingMode) { setVendorId(value); } else { setNewVendorId(value); }
  }

  function setFormBillNumber(value: string) {
    if (isEditingMode) { setBillNumber(value); } else { setNewBillNumber(value); }
  }

  function setFormReceivedDate(value: string) {
    if (isEditingMode) { setReceivedDate(value); } else { setNewReceivedDate(value); }
  }

  function setFormIssueDate(value: string) {
    if (isEditingMode) { setIssueDate(value); } else { setNewIssueDate(value); }
  }

  function setFormDueDate(value: string) {
    if (isEditingMode) { setDueDate(value); } else { setNewDueDate(value); }
  }

  function setFormTaxAmount(value: string) {
    if (isEditingMode) { setTaxAmount(value); } else { setNewTaxAmount(value); }
  }

  function setFormShippingAmount(value: string) {
    if (isEditingMode) { setShippingAmount(value); } else { setNewShippingAmount(value); }
  }

  function setFormNotes(value: string) {
    if (isEditingMode) { setNotes(value); } else { setNewNotes(value); }
  }

  function setFormLineItems(next: VendorBillLineFormRow[]) {
    if (isEditingMode) { setLineItems(next); } else { setNewLineItems(next); }
  }

  // --- Functions (line item helpers) ---

  /** Patches a single line item row by index. */
  function updateFormLineItem(index: number, patch: Partial<VendorBillLineFormRow>) {
    const next = [...formLineItems];
    next[index] = { ...next[index], ...patch };
    setFormLineItems(next);
  }

  /** Removes a line item row, keeping at least one row. */
  function removeFormLineItem(index: number) {
    const current = formLineItems;
    setFormLineItems(
      current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current,
    );
  }

  /** Appends a new blank line item row to the form. */
  function addFormLineItem() {
    setFormLineItems([...formLineItems, createEmptyVendorBillLineRow()]);
  }

  // --- Functions (hydrate / reset) ---

  /** Populates the edit form fields from a vendor bill record. */
  function hydrate(item: VendorBillRecord) {
    setVendorId(String(item.vendor));
    setBillNumber(item.bill_number);
    setReceivedDate(item.received_date ?? "");
    setIssueDate(item.issue_date ?? "");
    setDueDate(item.due_date ?? "");
    setTaxAmount(item.tax_amount);
    setShippingAmount(item.shipping_amount);
    setNotes(item.notes);
    setStatus(item.status);
    const mapped = (item.line_items ?? []).map((row) => ({
      description: row.description,
      quantity: row.quantity,
      unit_price: row.unit_price,
    }));
    setLineItems(mapped.length > 0 ? mapped : [createEmptyVendorBillLineRow()]);
  }

  /** Resets the create-mode form to default values. */
  function resetCreateForm(options?: { preserveDates?: boolean }) {
    const today = todayDateInput();
    const due = futureDateInput();
    setNewBillNumber("");
    setNewNotes("");
    setNewLineItems([createEmptyVendorBillLineRow()]);
    setDuplicateCandidates([]);
    if (!options?.preserveDates) {
      setNewReceivedDate(today);
      setNewIssueDate(today);
      setNewDueDate(due);
      setNewTaxAmount("0.00");
      setNewShippingAmount("0.00");
    }
    if (activeVendors[0]) {
      setNewVendorId(String(activeVendors[0].id));
    }
  }

  /** Copies a bill record into the create-mode fields for a "recreate as new" workflow. */
  function populateCreateFromBill(bill: VendorBillRecord) {
    setNewVendorId(String(bill.vendor));
    setNewBillNumber("");
    setNewReceivedDate(bill.received_date ?? "");
    setNewIssueDate(bill.issue_date ?? "");
    setNewDueDate(bill.due_date ?? "");
    setNewTaxAmount(bill.tax_amount);
    setNewShippingAmount(bill.shipping_amount);
    setNewNotes(bill.notes || "");
    const copiedLineItems = (bill.line_items ?? []).map((row) => ({
      description: row.description,
      quantity: row.quantity,
      unit_price: row.unit_price,
    }));
    setNewLineItems(
      copiedLineItems.length > 0 ? copiedLineItems : [createEmptyVendorBillLineRow()],
    );
    setDuplicateCandidates([]);
  }

  /** Ensures date fields have sensible defaults (called once on mount). */
  function ensureDateDefaults() {
    const today = todayDateInput();
    const due = futureDateInput();
    setNewReceivedDate((current) => current || today);
    setNewIssueDate((current) => current || today);
    setNewDueDate((current) => current || due);
    setReceivedDate((current) => current || today);
    setIssueDate((current) => current || today);
    setDueDate((current) => current || due);
  }

  // --- Return bag ---

  return {
    // State (unified read accessors)
    formVendorId,
    formBillNumber,
    formReceivedDate,
    formIssueDate,
    formDueDate,
    formTaxAmount,
    formShippingAmount,
    formNotes,
    formLineItems,
    computedSubtotal,
    computedTotal,
    duplicateCandidates,
    status,

    // State (raw — needed by mutation handlers in console)
    newVendorId,
    newBillNumber,
    newReceivedDate,
    newIssueDate,
    newDueDate,
    newTaxAmount,
    newShippingAmount,
    newNotes,
    newLineItems,
    vendorId,
    billNumber,
    receivedDate,
    issueDate,
    dueDate,
    taxAmount,
    shippingAmount,
    notes,
    lineItems,

    // Setters (unified)
    setFormVendorId,
    setFormBillNumber,
    setFormReceivedDate,
    setFormIssueDate,
    setFormDueDate,
    setFormTaxAmount,
    setFormShippingAmount,
    setFormNotes,
    setFormLineItems,
    setStatus,
    setDuplicateCandidates,
    setNewBillNumber,
    setNewNotes,
    setNewLineItems,
    setNewVendorId,

    // Helpers
    updateFormLineItem,
    removeFormLineItem,
    addFormLineItem,
    hydrate,
    resetCreateForm,
    populateCreateFromBill,
    ensureDateDefaults,
  };
}
