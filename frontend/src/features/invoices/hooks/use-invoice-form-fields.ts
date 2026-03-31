/**
 * Invoice workspace form field state.
 *
 * Owns the editable form fields (dates, tax, terms) and workspace context
 * (source invoice, editing mode, context label). Provides hydration from
 * an existing invoice and reset-to-blank-draft.
 *
 * Consumer: InvoicesConsole (composed alongside useInvoiceData and useLineItems).
 *
 * ## State
 *
 * - issueDate               — issue date input value (YYYY-MM-DD)
 * - dueDate                 — due date input value (YYYY-MM-DD)
 * - taxPercent              — tax percent string (e.g. "8.25")
 * - termsText               — terms & conditions text
 * - workspaceSourceInvoiceId — ID of invoice loaded into workspace (null = new draft)
 * - editingDraftInvoiceId    — ID of draft being edited (null = creating new)
 * - workspaceContext         — human-readable label for workspace state
 *
 * ## Functions
 *
 * - resetCreateDraft()
 *     Resets all form fields to blank-draft defaults using org settings.
 *
 * - loadInvoiceIntoWorkspace(invoice)
 *     Hydrates form fields from an existing InvoiceRecord and sets
 *     workspace context based on invoice status (draft = editing, else = locked view).
 *
 * - invoiceToWorkspaceLines(invoice)
 *     Pure converter: maps API line items to InvoiceLineInput shape.
 */

import { useCallback, useState } from "react";
import { todayDateInput, futureDateInput } from "@/shared/date-format";
import { dueDateFromIssueDate, emptyLine } from "../helpers";
import type { InvoiceLineInput, InvoiceRecord, OrganizationInvoiceDefaults } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UseInvoiceFormFieldsOptions = {
  /** Organization defaults for due-date delta and terms text. */
  organizationInvoiceDefaults: OrganizationInvoiceDefaults | null;
  /** Setter from useLineItems — used by hydrate to load line items. */
  setLineItems: (items: InvoiceLineInput[] | ((current: InvoiceLineInput[]) => InvoiceLineInput[])) => void;
  /** Setter from useLineItems — used by hydrate to sync next ID. */
  setNextLineId: (id: number | ((current: number) => number)) => void;
  /** Reset from useLineItems — used by resetCreateDraft. */
  resetLines: () => void;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manage invoice workspace form fields and workspace context.
 *
 * @param options - Organization defaults and line-item setters from the parent.
 * @returns Form field state, setters, hydration, and reset functions.
 */
export function useInvoiceFormFields({
  organizationInvoiceDefaults,
  setLineItems,
  setNextLineId,
  resetLines,
}: UseInvoiceFormFieldsOptions) {

  // --- State ---

  const [issueDate, setIssueDate] = useState(todayDateInput());
  const [dueDate, setDueDate] = useState(futureDateInput());
  const [taxPercent, setTaxPercent] = useState("0");
  const [termsText, setTermsText] = useState("");
  const [workspaceSourceInvoiceId, setWorkspaceSourceInvoiceId] = useState<number | null>(null);
  const [editingDraftInvoiceId, setEditingDraftInvoiceId] = useState<number | null>(null);
  const [workspaceContext, setWorkspaceContext] = useState("New invoice draft");
  const [relatedEstimate, setRelatedEstimate] = useState<number | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<number | null>(null);

  // --- Functions ---

  /** Convert an invoice's API line items into the workspace InvoiceLineInput shape. */
  const invoiceToWorkspaceLines = useCallback(
    (invoice: InvoiceRecord): InvoiceLineInput[] => {
      const sourceLines = invoice.line_items ?? [];
      if (!sourceLines.length) {
        return [emptyLine(1)];
      }
      return sourceLines.map((line, index) => ({
        localId: index + 1,
        costCode: line.cost_code ? String(line.cost_code) : "",
        description: line.description || "",
        quantity: line.quantity || "1",
        unit: line.unit || "ea",
        unitPrice: line.unit_price || "0",
      }));
    },
    [],
  );

  /** Hydrate workspace form fields from an existing invoice record. */
  const loadInvoiceIntoWorkspace = useCallback(
    (invoice: InvoiceRecord) => {
      const workspaceLines = invoiceToWorkspaceLines(invoice);
      setIssueDate(invoice.issue_date || todayDateInput());
      setDueDate(invoice.due_date || futureDateInput());
      setTaxPercent(invoice.tax_percent || "0");
      setTermsText(invoice.terms_text || "");
      setLineItems(workspaceLines);
      setNextLineId(workspaceLines.length + 1);
      setRelatedEstimate(invoice.related_estimate ?? null);
      setBillingPeriod(invoice.billing_period ?? null);
      setWorkspaceSourceInvoiceId(invoice.id);
      if (invoice.status === "draft") {
        setEditingDraftInvoiceId(invoice.id);
        setWorkspaceContext(`Editing ${invoice.invoice_number}`);
      } else {
        setEditingDraftInvoiceId(null);
        setWorkspaceContext(`Viewing ${invoice.invoice_number} (locked)`);
      }
    },
    [invoiceToWorkspaceLines, setLineItems, setNextLineId],
  );

  /** Pre-fill workspace from an existing invoice for duplication (create mode, not editing). */
  const populateCreateFromInvoice = useCallback(
    (invoice: InvoiceRecord) => {
      const workspaceLines = invoiceToWorkspaceLines(invoice);
      const nextIssueDate = todayDateInput();
      const dueDays = organizationInvoiceDefaults?.default_invoice_due_delta ?? 30;
      setIssueDate(nextIssueDate);
      setDueDate(dueDateFromIssueDate(nextIssueDate, dueDays));
      setTaxPercent(invoice.tax_percent || "0");
      setTermsText(invoice.terms_text || "");
      setLineItems(workspaceLines);
      setNextLineId(workspaceLines.length + 1);
      setRelatedEstimate(null);
      setBillingPeriod(null);
      setWorkspaceSourceInvoiceId(null);
      setEditingDraftInvoiceId(null);
      setWorkspaceContext("New invoice draft");
    },
    [organizationInvoiceDefaults, invoiceToWorkspaceLines, setLineItems, setNextLineId],
  );

  /** Reset workspace to a blank new-draft state using org defaults. */
  function resetCreateDraft() {
    const nextIssueDate = todayDateInput();
    const dueDays = organizationInvoiceDefaults?.default_invoice_due_delta ?? 30;
    setIssueDate(nextIssueDate);
    setDueDate(dueDateFromIssueDate(nextIssueDate, dueDays));
    setTaxPercent("0");
    setTermsText(organizationInvoiceDefaults?.invoice_terms_and_conditions || "");
    resetLines();
    setRelatedEstimate(null);
    setBillingPeriod(null);
    setWorkspaceSourceInvoiceId(null);
    setEditingDraftInvoiceId(null);
    setWorkspaceContext("New invoice draft");
  }

  // --- Return bag ---

  return {
    // State
    issueDate,
    dueDate,
    taxPercent,
    termsText,
    relatedEstimate,
    billingPeriod,
    workspaceSourceInvoiceId,
    editingDraftInvoiceId,
    workspaceContext,

    // Setters
    setIssueDate,
    setDueDate,
    setTaxPercent,
    setTermsText,
    setRelatedEstimate,
    setBillingPeriod,
    setWorkspaceSourceInvoiceId,
    setEditingDraftInvoiceId,
    setWorkspaceContext,

    // Helpers
    invoiceToWorkspaceLines,
    loadInvoiceIntoWorkspace,
    populateCreateFromInvoice,
    resetCreateDraft,
  };
}
