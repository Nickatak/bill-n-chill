/**
 * Dual-mode form state for the change-orders console.
 *
 * Manages both the "create new" and "edit existing" form fields, line items,
 * derived totals, validation, and form-state objects consumed by the
 * document-creator adapter.
 *
 * Consumer: ChangeOrdersConsole (composed alongside useChangeOrderProjectData
 * and useChangeOrderViewer).
 *
 * ## State (useState)
 *
 * - newTitle                — create form: draft title
 * - newTitleManuallyEdited  — whether the user has typed in the title field
 * - newReason               — create form: reason text
 * - newTermsText            — create form: terms and conditions text
 * - editTitle               — edit form: title
 * - editReason              — edit form: reason
 * - editTermsText           — edit form: terms and conditions text
 * - selectedChangeOrderId   — ID of the change order loaded in the edit form
 * - quickStatus             — quick status transition selection
 * - quickStatusNote         — note for quick status transition or standalone note
 * - showAllEvents           — whether to expand the full audit event timeline
 *
 * ## Functions
 *
 * - hydrateEditForm(changeOrder)
 *     Populates (or clears) the edit form from a ChangeOrderRecord.
 *
 * - resetCreateForm(projectName, defaultTerms)
 *     Resets the create form to a fresh state for a new draft.
 *
 * ## Memos
 *
 * - newLineDeltaTotal       — sum of create line item amount deltas
 * - newLineDaysTotal        — sum of create line item days deltas
 * - newLineValidation       — validation result for create line items
 * - editLineDeltaTotal      — sum of edit line item amount deltas
 * - editLineDaysTotal       — sum of edit line item days deltas
 * - editLineValidation      — validation result for edit line items
 * - createChangeOrderCreatorFormState — form state object for create adapter
 * - editChangeOrderCreatorFormState   — form state object for edit adapter
 *
 * @module
 */

import { useCallback, useMemo, useState } from "react";
import { parseAmount, formatDecimal } from "@/shared/money-format";
import { useLineItems } from "@/shared/hooks/use-line-items";
import { defaultChangeOrderTitle, emptyLine, validateLineItems } from "../helpers";
import type {
  ChangeOrderLineInput,
  ChangeOrderRecord,
} from "../types";
import type { ChangeOrderFormState } from "../document-adapter";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manage dual-mode (create + edit) form state for change orders.
 *
 * @returns Form field state, setters, line item bags, derived totals/validation,
 *          and hydration helpers.
 */
export function useChangeOrderForm() {

  // --- State ---

  const [newTitle, setNewTitle] = useState("Change Order");
  const [newTitleManuallyEdited, setNewTitleManuallyEdited] = useState(false);
  const [newReason, setNewReason] = useState("");
  const [newTermsText, setNewTermsText] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editTermsText, setEditTermsText] = useState("");

  const [selectedChangeOrderId, setSelectedChangeOrderId] = useState("");
  const [quickStatus, setQuickStatus] = useState("");
  const [quickStatusNote, setQuickStatusNote] = useState("");
  const [showAllEvents, setShowAllEvents] = useState(false);

  const {
    items: newLineItems, setItems: setNewLineItems,
    setNextId: setNewLineNextLocalId,
    add: addNewLineRaw, remove: removeNewLineRaw,
    update: updateNewLine, move: moveNewLine, reset: resetNewLines,
  } = useLineItems<ChangeOrderLineInput>({ createEmpty: emptyLine });

  const {
    items: editLineItems, setItems: setEditLineItems,
    setNextId: setEditLineNextLocalId,
    add: addEditLineRaw, remove: removeEditLineRaw,
    update: updateEditLine, move: moveEditLine, reset: resetEditLines,
  } = useLineItems<ChangeOrderLineInput>({ createEmpty: emptyLine });

  // --- Functions ---

  /**
   * Populate the edit form from a change order record, or clear it
   * to switch into "create new" mode.
   */
  const hydrateEditForm = useCallback((changeOrder: ChangeOrderRecord | undefined) => {
    if (!changeOrder) {
      setSelectedChangeOrderId("");
      setEditTitle("");
      setEditReason("");
      setEditTermsText("");
      resetEditLines();
      setQuickStatus("");
      setQuickStatusNote("");
      return;
    }

    setSelectedChangeOrderId(String(changeOrder.id));
    setEditTitle(changeOrder.title);
    setEditReason(changeOrder.reason);
    setEditTermsText(changeOrder.terms_text || "");
    const hydratedLines: ChangeOrderLineInput[] =
      changeOrder.line_items.length > 0
        ? changeOrder.line_items.map((line, index) => ({
            localId: index + 1,
            costCodeId: line.cost_code_id ? String(line.cost_code_id) : String(line.cost_code),
            description: line.description ?? "",
            adjustmentReason: line.adjustment_reason ?? "",
            amountDelta: line.amount_delta,
            daysDelta: String(line.days_delta),
          }))
        : [emptyLine(1)];
    setEditLineItems(hydratedLines);
    const maxLocalId = hydratedLines.reduce((maxId, line) => Math.max(maxId, line.localId), 1);
    setEditLineNextLocalId(maxLocalId + 1);
    setQuickStatus("");
    setQuickStatusNote("");
    setShowAllEvents(false);
  }, [resetEditLines, setEditLineItems, setEditLineNextLocalId]);

  /**
   * Pre-fill the create form from an existing change order for duplication.
   * Copies content but puts form in create mode (no selected CO).
   */
  const populateCreateFromChangeOrder = useCallback((changeOrder: ChangeOrderRecord) => {
    setNewTitle(changeOrder.title);
    setNewTitleManuallyEdited(true);
    setNewReason(changeOrder.reason);
    setNewTermsText(changeOrder.terms_text || "");
    const copiedLines: ChangeOrderLineInput[] =
      changeOrder.line_items.length > 0
        ? changeOrder.line_items.map((line, index) => ({
            localId: index + 1,
            costCodeId: line.cost_code_id ? String(line.cost_code_id) : String(line.cost_code),
            description: line.description ?? "",
            adjustmentReason: line.adjustment_reason ?? "",
            amountDelta: line.amount_delta,
            daysDelta: String(line.days_delta),
          }))
        : [emptyLine(1)];
    setNewLineItems(copiedLines);
    setNewLineNextLocalId(copiedLines.length + 1);
    setSelectedChangeOrderId("");
  }, [setNewLineItems, setNewLineNextLocalId]);

  /**
   * Reset the create form to a fresh state for a new draft.
   * Called when switching projects or after successful creation.
   */
  const resetCreateForm = useCallback((projectName: string, defaultTerms: string) => {
    setNewTitleManuallyEdited(false);
    setNewTitle(defaultChangeOrderTitle(projectName));
    setNewReason("");
    setNewTermsText(defaultTerms);
    resetNewLines();
  }, [resetNewLines]);

  // --- Memos ---

  const newLineDeltaTotal = useMemo(
    () => newLineItems.reduce((sum, line) => sum + parseAmount(line.amountDelta), 0),
    [newLineItems],
  );

  const newLineValidation = useMemo(() => validateLineItems(newLineItems), [newLineItems]);

  const editLineDeltaTotal = useMemo(
    () => editLineItems.reduce((sum, line) => sum + parseAmount(line.amountDelta), 0),
    [editLineItems],
  );

  const editLineValidation = useMemo(() => validateLineItems(editLineItems), [editLineItems]);

  const newLineDaysTotal = useMemo(
    () => newLineItems.reduce((sum, line) => sum + Math.trunc(parseAmount(line.daysDelta)), 0),
    [newLineItems],
  );

  const editLineDaysTotal = useMemo(
    () => editLineItems.reduce((sum, line) => sum + Math.trunc(parseAmount(line.daysDelta)), 0),
    [editLineItems],
  );

  const createChangeOrderCreatorFormState: ChangeOrderFormState = useMemo(
    () => ({
      title: newTitle,
      reason: newReason,
      amountDelta: formatDecimal(newLineDeltaTotal),
      daysDelta: String(newLineDaysTotal),
      lineItems: newLineItems,
    }),
    [newLineDaysTotal, newLineDeltaTotal, newLineItems, newReason, newTitle],
  );

  const editChangeOrderCreatorFormState: ChangeOrderFormState = useMemo(
    () => ({
      title: editTitle,
      reason: editReason,
      amountDelta: formatDecimal(editLineDeltaTotal),
      daysDelta: String(editLineDaysTotal),
      lineItems: editLineItems,
    }),
    [editLineDaysTotal, editLineDeltaTotal, editLineItems, editReason, editTitle],
  );

  // --- Return bag ---

  return {
    // State — create form
    newTitle,
    newTitleManuallyEdited,
    newReason,
    newTermsText,
    newLineItems,
    newLineDeltaTotal,
    newLineDaysTotal,
    newLineValidation,
    createChangeOrderCreatorFormState,

    // State — edit form
    editTitle,
    editReason,
    editTermsText,
    editLineItems,
    editLineDeltaTotal,
    editLineDaysTotal,
    editLineValidation,
    editChangeOrderCreatorFormState,
    selectedChangeOrderId,

    // State — status controls
    quickStatus,
    quickStatusNote,
    showAllEvents,

    // Setters — create form
    setNewTitle,
    setNewTitleManuallyEdited,
    setNewReason,
    setNewTermsText,

    // Setters — edit form
    setEditTitle,
    setEditReason,
    setEditTermsText,

    // Setters — status controls
    setQuickStatus,
    setQuickStatusNote,
    setShowAllEvents,

    // Helpers — create line items
    addNewLineRaw,
    removeNewLineRaw,
    updateNewLine,
    moveNewLine,
    resetNewLines,

    // Helpers — edit line items
    addEditLineRaw,
    removeEditLineRaw,
    updateEditLine,
    moveEditLine,

    // Helpers — form lifecycle
    hydrateEditForm,
    populateCreateFromChangeOrder,
    resetCreateForm,
  };
}
