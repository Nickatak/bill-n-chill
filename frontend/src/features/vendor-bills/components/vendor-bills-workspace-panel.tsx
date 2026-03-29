/**
 * Vendor bills workspace panel — WYSIWYG bill form (create/edit mode),
 * toolbar actions, vendor combobox, line items, summary, and duplicate
 * candidate display.
 *
 * Pure presentational: all state and handlers come from the console orchestrator.
 */

import { FormEvent, RefObject, useEffect, useMemo } from "react";
import { useCombobox } from "@/shared/hooks/use-combobox";
import { MobileLineItemCard } from "@/shared/document-creator/mobile-line-card";
import mobileCardStyles from "@/shared/document-creator/mobile-line-card.module.css";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import type {
  VendorBillLineInput,
  VendorBillRecord,
  VendorRecord,
} from "../types";
import styles from "./vendor-bills-console.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VendorBillsWorkspacePanelProps = {
  isMobile: boolean;
  canMutateVendorBills: boolean;
  role: string;
  selectedProjectId: string;

  // Workspace state
  selectedVendorBill: VendorBillRecord | null;
  workspaceIsLocked: boolean;
  workspaceContext: string;
  workspaceBadgeLabel: string;
  workspaceBadgeClass: string;
  isEditingMode: boolean;

  // Toolbar actions
  onStartNew: () => void;
  onDuplicate: () => void;
  onResetCreate: () => void;

  // Scan
  scanInputRef: RefObject<HTMLInputElement | null>;
  isScanning: boolean;
  onScanFile: (file: File) => void;

  // Form ref + submit
  billFormRef: RefObject<HTMLFormElement | null>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;

  // Vendor combobox
  vendors: VendorRecord[];
  formVendorId: string;
  setFormVendorId: (id: string) => void;

  // Form fields
  formBillNumber: string;
  setFormBillNumber: (v: string) => void;
  formIssueDate: string;
  setFormIssueDate: (v: string) => void;
  formDueDate: string;
  setFormDueDate: (v: string) => void;
  formReceivedDate: string;
  setFormReceivedDate: (v: string) => void;
  formTaxAmount: string;
  setFormTaxAmount: (v: string) => void;
  formShippingAmount: string;
  setFormShippingAmount: (v: string) => void;
  formNotes: string;
  setFormNotes: (v: string) => void;

  // Line items
  formLineItems: VendorBillLineInput[];
  updateFormLineItem: (index: number, patch: Partial<VendorBillLineInput>) => void;
  removeFormLineItem: (index: number) => void;
  addFormLineItem: () => void;

  // Totals
  computedSubtotal: number;
  computedTotal: number;

  // Duplicates
  duplicateCandidates: VendorBillRecord[];

  // Status message
  formMessage: string;
  formTone: string;

  // Status display
  billStatusLabels: Record<string, string>;

  // Scan vendor prefill
  scanUnmatchedVendorName: string;
  onScanUnmatchedConsumed: () => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VendorBillsWorkspacePanel(props: VendorBillsWorkspacePanelProps) {
  const {
    isMobile,
    canMutateVendorBills,
    role,
    selectedProjectId,
    selectedVendorBill,
    workspaceIsLocked,
    workspaceContext,
    workspaceBadgeLabel,
    workspaceBadgeClass,
    isEditingMode,
    onStartNew,
    onDuplicate,
    onResetCreate,
    scanInputRef,
    isScanning,
    onScanFile,
    billFormRef,
    onSubmit,
    vendors,
    formVendorId,
    setFormVendorId,
    formBillNumber,
    setFormBillNumber,
    formIssueDate,
    setFormIssueDate,
    formDueDate,
    setFormDueDate,
    formReceivedDate,
    setFormReceivedDate,
    formTaxAmount,
    setFormTaxAmount,
    formShippingAmount,
    setFormShippingAmount,
    formNotes,
    setFormNotes,
    formLineItems,
    updateFormLineItem,
    removeFormLineItem,
    addFormLineItem,
    computedSubtotal,
    computedTotal,
    duplicateCandidates,
    formMessage,
    formTone,
    billStatusLabels,
    scanUnmatchedVendorName,
    onScanUnmatchedConsumed,
  } = props;

  // -------------------------------------------------------------------------
  // Vendor combobox
  // -------------------------------------------------------------------------

  type VendorOption = { id: number; name: string; label: string };

  const vendorComboItems: VendorOption[] = useMemo(() => {
    return vendors.map((v) => ({
      id: v.id,
      name: v.name,
      label: v.name,
    }));
  }, [vendors]);

  const { inputRef: vendorInputRef, menuRef: vendorMenuRef, ...vendorCombobox } = useCombobox<VendorOption>({
    items: vendorComboItems,
    getLabel: (item) => item.label,
    onCommit: (item) => {
      setFormVendorId(item ? String(item.id) : "");
      vendorCombobox.close(item !== null);
    },
  });

  const selectedVendorOption: VendorOption | null = useMemo(() => {
    if (formVendorId) {
      return vendorComboItems.find((o) => String(o.id) === formVendorId) ?? null;
    }
    return null;
  }, [formVendorId, vendorComboItems]);

  // Seed combobox query from scan result when an unmatched vendor name arrives.
  useEffect(() => {
    if (scanUnmatchedVendorName) {
      vendorCombobox.setQuery(scanUnmatchedVendorName);
      onScanUnmatchedConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanUnmatchedVendorName]);

  function statusDisplayLabel(value: string): string {
    return billStatusLabels[value] ?? value;
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      <div className={styles.workspace}>
        <div className={styles.workspaceToolbar}>
          <div className={styles.workspaceContext}>
            <span className={styles.workspaceContextLabel}>
              {!selectedVendorBill ? "Creating" : workspaceIsLocked ? "Viewing" : "Editing"}
            </span>
            <div className={styles.workspaceContextValueRow}>
              <strong>{workspaceContext}</strong>
              <span className={`${styles.workspaceBadge} ${workspaceBadgeClass}`}>{workspaceBadgeLabel}</span>
            </div>
          </div>
          <div className={styles.workspaceToolbarActions}>
            {isEditingMode ? (
              <>
                <button
                  type="button"
                  className={styles.toolbarActionButton}
                  onClick={onDuplicate}
                  disabled={!selectedVendorBill}
                >
                  Duplicate Bill
                </button>
                <button
                  type="button"
                  className={styles.toolbarActionButton}
                  onClick={onStartNew}
                >
                  New Bill
                </button>
              </>
            ) : (
              <button
                type="button"
                className={styles.toolbarActionButton}
                onClick={onResetCreate}
              >
                Reset
              </button>
            )}
            {canMutateVendorBills ? (
              <>
                <input
                  ref={scanInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  className={styles.hiddenInput}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onScanFile(file);
                  }}
                />
                <button
                  type="button"
                  className={`${styles.toolbarActionButton} ${isScanning ? styles.scanningPulse : ""}`}
                  onClick={() => scanInputRef.current?.click()}
                  disabled={isScanning || !selectedProjectId}
                >
                  {isScanning ? "Scanning…" : "Scan Bill/Receipt"}
                </button>
              </>
            ) : null}
          </div>
        </div>

        {/* ── WYSIWYG Bill Document Form ───────────────────────────── */}
        <form ref={billFormRef} className={styles.billDocument} onSubmit={onSubmit}>

          {/* Header: vendor (letterhead) + bill number */}
          <div className={styles.billDocHeader}>
            <div className={styles.billDocFrom}>
              <span className={styles.billDocFieldLabel}>From</span>
              <div className={styles.vendorCombobox}>
                <div className={styles.vendorInputWrap}>
                  <input
                    ref={vendorInputRef}
                    className={styles.vendorInput}
                    role="combobox"
                    aria-expanded={vendorCombobox.isOpen}
                    aria-controls="vendor-combobox-listbox"
                    value={vendorCombobox.isOpen ? vendorCombobox.query : (selectedVendorOption ? selectedVendorOption.name : vendorCombobox.query)}
                    placeholder="Select vendor..."
                    onFocus={() => vendorCombobox.open(selectedVendorOption ? selectedVendorOption.name : "")}
                    onChange={(e) => {
                      vendorCombobox.handleInput(e.target.value);
                      if (formVendorId) setFormVendorId("");
                    }}
                    onKeyDown={vendorCombobox.handleKeyDown}
                    autoComplete="off"
                    disabled={workspaceIsLocked}
                  />
                  {!workspaceIsLocked ? (
                    <button
                      type="button"
                      className={styles.vendorChevron}
                      aria-label={selectedVendorOption ? "Clear selection" : "Open list"}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        if (selectedVendorOption) {
                          setFormVendorId("");
                          vendorCombobox.close(false);
                        } else {
                          vendorInputRef.current?.focus();
                          vendorCombobox.open("");
                        }
                      }}
                    >
                      {selectedVendorOption ? "×" : "▾"}
                    </button>
                  ) : null}
                </div>
                {vendorCombobox.isOpen && !workspaceIsLocked ? (
                  <div
                    ref={vendorMenuRef}
                    id="vendor-combobox-listbox"
                    className={styles.vendorMenu}
                    role="listbox"
                  >
                    {vendorCombobox.filteredItems.map((item, i) => (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={String(item.id) === formVendorId}
                        className={`${styles.vendorOption} ${vendorCombobox.highlightIndex === i ? styles.vendorOptionActive : ""}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => vendorCombobox.setHighlightIndex(i)}
                        onClick={() => {
                          setFormVendorId(String(item.id));
                          vendorCombobox.close(true);
                        }}
                      >
                        {item.name}
                      </button>
                    ))}
                    {vendorCombobox.filteredItems.length === 0 && vendorCombobox.query.trim() ? (
                      <div className={styles.vendorNoResults}>No matches.</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div className={styles.billDocBillNum}>
              <span className={styles.billDocFieldLabel}>Bill #</span>
              <input
                className={styles.billDocBillNumInput}
                value={formBillNumber}
                onChange={(event) => setFormBillNumber(event.target.value)}
                placeholder="e.g. INV-001"
                disabled={workspaceIsLocked || !selectedProjectId}
              />
            </div>
          </div>

          {/* Dates row */}
          <div className={styles.billDocDates}>
            <label className={styles.billDocDateField}>
              <span className={styles.billDocFieldLabel}>Date</span>
              <input
                type="date"
                value={formIssueDate}
                onChange={(event) => setFormIssueDate(event.target.value)}
                disabled={workspaceIsLocked || !selectedProjectId}
              />
            </label>
            <label className={styles.billDocDateField}>
              <span className={styles.billDocFieldLabel}>Due Date</span>
              <input
                type="date"
                value={formDueDate}
                onChange={(event) => setFormDueDate(event.target.value)}
                disabled={workspaceIsLocked || !selectedProjectId}
              />
            </label>
            <label className={styles.billDocDateField}>
              <span className={styles.billDocFieldLabel}>Received</span>
              <input
                type="date"
                value={formReceivedDate}
                onChange={(event) => setFormReceivedDate(event.target.value)}
                disabled={workspaceIsLocked || !selectedProjectId}
              />
            </label>
          </div>

          {/* Line items */}
          {isMobile ? (
            <div className={mobileCardStyles.cardList}>
              {formLineItems.map((row, index) => (
                <MobileLineItemCard
                  key={`line-${index}`}
                  index={index}
                  readOnly={workspaceIsLocked}
                  isFirst={index === 0}
                  isLast={index === formLineItems.length - 1}
                  onRemove={workspaceIsLocked ? undefined : () => removeFormLineItem(index)}
                  fields={[
                    {
                      label: "Description",
                      key: "description",
                      span: "full",
                      render: () => (
                        <input
                          className={mobileCardStyles.fieldInput}
                          value={row.description}
                          onChange={(event) => updateFormLineItem(index, { description: event.target.value })}
                          placeholder="Description"
                          disabled={workspaceIsLocked}
                        />
                      ),
                    },
                    {
                      label: "Qty",
                      key: "quantity",
                      render: () => (
                        <input
                          className={mobileCardStyles.fieldInput}
                          value={row.quantity}
                          onChange={(event) => updateFormLineItem(index, { quantity: event.target.value })}
                          placeholder="1"
                          inputMode="decimal"
                          disabled={workspaceIsLocked}
                        />
                      ),
                    },
                    {
                      label: "Unit Price",
                      key: "unit_price",
                      render: () => (
                        <input
                          className={mobileCardStyles.fieldInput}
                          value={row.unit_price}
                          onChange={(event) => updateFormLineItem(index, { unit_price: event.target.value })}
                          placeholder="0.00"
                          inputMode="decimal"
                          disabled={workspaceIsLocked}
                        />
                      ),
                    },
                    {
                      label: "Amount",
                      key: "amount",
                      align: "right",
                      render: () => (
                        <span className={`${mobileCardStyles.fieldStatic} ${mobileCardStyles.fieldStaticRight}`}>
                          ${((Number(row.quantity) || 0) * (Number(row.unit_price) || 0)).toFixed(2)}
                        </span>
                      ),
                    },
                  ]}
                />
              ))}
            </div>
          ) : (
            <div className={`${creatorStyles.lineTable} ${styles.billLineTable}`}>
              <div className={workspaceIsLocked ? creatorStyles.lineHeaderSimpleReadOnly : creatorStyles.lineHeaderSimple}>
                <div className={creatorStyles.lineHeaderCell}><span>Description</span></div>
                <div className={creatorStyles.lineHeaderCell}><span>Qty</span></div>
                <div className={creatorStyles.lineHeaderCell}><span>Unit Price</span></div>
                <div className={creatorStyles.lineHeaderCell}><span>Amount</span></div>
                {!workspaceIsLocked ? <div className={creatorStyles.lineHeaderCell} /> : null}
              </div>
              {formLineItems.map((row, index) => (
                <div
                  key={`line-${index}`}
                  className={workspaceIsLocked ? creatorStyles.lineRowSimpleReadOnly : creatorStyles.lineRowSimple}
                >
                  <div className={creatorStyles.lineCell}>
                    <input
                      className={creatorStyles.lineInput}
                      value={row.description}
                      onChange={(event) => updateFormLineItem(index, { description: event.target.value })}
                      placeholder="Description"
                      disabled={workspaceIsLocked}
                    />
                  </div>
                  <div className={creatorStyles.lineCell}>
                    <input
                      className={creatorStyles.lineInput}
                      value={row.quantity}
                      onChange={(event) => updateFormLineItem(index, { quantity: event.target.value })}
                      placeholder="1"
                      inputMode="decimal"
                      disabled={workspaceIsLocked}
                      style={{ textAlign: "right" }}
                    />
                  </div>
                  <div className={creatorStyles.lineCell}>
                    <input
                      className={creatorStyles.lineInput}
                      value={row.unit_price}
                      onChange={(event) => updateFormLineItem(index, { unit_price: event.target.value })}
                      placeholder="0.00"
                      inputMode="decimal"
                      disabled={workspaceIsLocked}
                      style={{ textAlign: "right" }}
                    />
                  </div>
                  <div className={creatorStyles.lineCell}>
                    <div className={creatorStyles.amountCell}>
                      ${((Number(row.quantity) || 0) * (Number(row.unit_price) || 0)).toFixed(2)}
                    </div>
                  </div>
                  {!workspaceIsLocked ? (
                    <div className={creatorStyles.lineCell}>
                      <button
                        type="button"
                        className={creatorStyles.removeButton}
                        onClick={() => removeFormLineItem(index)}
                        disabled={formLineItems.length <= 1}
                        aria-label="Remove line"
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {/* Add line + summary */}
          {!workspaceIsLocked ? (
            <div className={creatorStyles.lineActions}>
              <button
                type="button"
                className={creatorStyles.secondaryButton}
                onClick={addFormLineItem}
              >
                Add Line Item
              </button>
            </div>
          ) : null}

          <div className={creatorStyles.summary}>
            <div className={creatorStyles.summaryRow}>
              <span>Subtotal</span>
              <span>${computedSubtotal.toFixed(2)}</span>
            </div>
            <div className={creatorStyles.summaryRow}>
              <span>Tax</span>
              <span className={creatorStyles.summaryTaxLine}>
                <input
                  className={`${creatorStyles.summaryTaxInput} ${styles.billSummaryDollarInput}`}
                  value={formTaxAmount}
                  onChange={(event) => setFormTaxAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={workspaceIsLocked}
                />
              </span>
            </div>
            <div className={creatorStyles.summaryRow}>
              <span>Shipping / Freight</span>
              <span className={creatorStyles.summaryTaxLine}>
                <input
                  className={`${creatorStyles.summaryTaxInput} ${styles.billSummaryDollarInput}`}
                  value={formShippingAmount}
                  onChange={(event) => setFormShippingAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={workspaceIsLocked}
                />
              </span>
            </div>
            <div className={`${creatorStyles.summaryRow} ${creatorStyles.summaryTotal}`}>
              <span>Total</span>
              <strong>${computedTotal.toFixed(2)}</strong>
            </div>
          </div>

          {/* Notes */}
          <div className={styles.billDocNotes}>
            <span className={styles.billDocFieldLabel}>Notes</span>
            <textarea
              className={styles.billDocNotesInput}
              value={formNotes}
              onChange={(event) => setFormNotes(event.target.value)}
              disabled={workspaceIsLocked}
              placeholder="Optional notes from the vendor bill..."
            />
          </div>

          {/* Submit */}
          {!workspaceIsLocked ? (
            <div className={styles.submitRow}>
              {formMessage ? (
                <p className={formTone === "error" ? styles.submitErrorText : styles.submitSuccessText} role="alert" aria-live="polite">
                  {formMessage}
                </p>
              ) : null}
              <button
                type="submit"
                className={styles.formPrimaryButton}
                disabled={!canMutateVendorBills || !selectedProjectId || !formVendorId}
              >
                {isEditingMode ? "Save Vendor Bill" : "Create Vendor Bill"}
              </button>
            </div>
          ) : null}
        </form>

        {duplicateCandidates.length > 0 ? (
          <div className={styles.impactCard}>
            <p><strong>Duplicate candidates:</strong></p>
            {duplicateCandidates.map((candidate) => (
              <p key={candidate.id}>
                #{candidate.id} {candidate.vendor_name || "Expense"} / {candidate.bill_number} (
                {statusDisplayLabel(candidate.status)})
              </p>
            ))}
            <p>Void matching bill(s) first if you need to reuse this bill number.</p>
          </div>
        ) : null}
      </div>

      {!canMutateVendorBills ? <p className={styles.inlineHint}>Role `{role}` can view bills but cannot create or update.</p> : null}
    </>
  );
}
