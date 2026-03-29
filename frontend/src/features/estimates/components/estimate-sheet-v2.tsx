/**
 * Estimate sheet v2 — responsive line items with flat ordering and sections.
 *
 * Sections are visual dividers that share an ordering space with line items.
 * DnD reordering via drag handles on both desktop and mobile.
 * Sections and order state live here; the parent console reads them via
 * an imperative handle (getOrderPayload) when building the submit payload.
 */
"use client";

import {
  FormEvent,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { DndContext, closestCenter, DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatDecimal } from "@/shared/money-format";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import lineStyles from "./line-item-row.module.css";

import { CostCode, EstimateLineInput, EstimateSectionRecord, ProjectRecord } from "../types";
import { computeLineTotal } from "../helpers";
import { CostCodeCombobox } from "./cost-code-combobox";
import {
  resolveOrganizationBranding,
  type OrganizationBrandingDefaults,
} from "@/shared/document-creator";
import type { LineValidationResult } from "../helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** Generic sortable wrapper for any entry in the flat list. Drag handle only. */
function SortableEntry({ id, disabled, children }: { id: string; disabled?: boolean; children: (handleProps: Record<string, unknown>) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    position: "relative",
    zIndex: isDragging ? 1 : undefined,
  };
  const handleProps = !disabled ? { ...attributes, ...listeners } : {};
  return (
    <div ref={setNodeRef} style={style}>
      {children(handleProps)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OrganizationDocumentDefaults = OrganizationBrandingDefaults & {
  estimate_terms_and_conditions: string;
  default_estimate_valid_delta: number;
};

/** Payload returned by getOrderPayload() for the parent to include in API requests. */
export type OrderPayload = {
  lineItemOrders: Map<number, number>;
  sections: { name: string; order: number }[];
};

/** Imperative handle exposed to the parent console via ref. */
export type EstimateSheetV2Handle = {
  getOrderPayload: () => OrderPayload;
};

type EstimateSheetV2Props = {
  project: ProjectRecord | null;
  organizationDefaults?: OrganizationDocumentDefaults | null;
  estimateId: string;
  estimateTitle: string;
  estimateDate: string;
  validThrough: string;
  termsText: string;
  notesText: string;
  taxPercent: string;
  lineItems: EstimateLineInput[];
  lineTotals: number[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  costCodes: CostCode[];
  canSubmit: boolean;
  isSubmitting: boolean;
  isEditingDraft: boolean;
  readOnly: boolean;
  titleLocked?: boolean;
  duplicateHint?: string;
  formErrorMessage?: string;
  formSuccessMessage?: string;
  lineValidation?: LineValidationResult;
  showMarkupColumn?: boolean;
  /** Sections from the API response — used to hydrate local section state. */
  apiSections?: EstimateSectionRecord[];
  onTitleChange: (value: string) => void;
  onValidThroughChange: (value: string) => void;
  onTaxPercentChange: (value: string) => void;
  onNotesTextChange: (value: string) => void;
  onLineItemChange: (
    localId: number,
    key: keyof Omit<EstimateLineInput, "localId">,
    value: string,
  ) => void;
  onAddLineItem: () => void;
  onRemoveLineItem: (localId: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const EstimateSheetV2 = forwardRef<EstimateSheetV2Handle, EstimateSheetV2Props>(
  function EstimateSheetV2(
    {
      project,
      organizationDefaults = null,
      estimateId,
      estimateTitle,
      estimateDate,
      validThrough,
      termsText,
      notesText,
      taxPercent,
      lineItems,
      lineTotals,
      subtotal,
      taxAmount,
      totalAmount,
      costCodes,
      canSubmit,
      isSubmitting,
      isEditingDraft,
      readOnly,
      titleLocked = false,
      duplicateHint = "",
      formErrorMessage = "",
      formSuccessMessage = "",
      lineValidation,
      showMarkupColumn = true,
      apiSections,
      onTitleChange,
      onValidThroughChange,
      onTaxPercentChange,
      onNotesTextChange,
      onLineItemChange,
      onAddLineItem,
      onRemoveLineItem,
      onSubmit,
    },
    ref,
  ) {
    const customerName = (project?.customer_display_name || "Customer name").trim();
    const rawBillingAddress = (project?.customer_billing_address || "").trim();
    const isExistingEstimate = Boolean(estimateId);
    const titleReadOnly = readOnly || isExistingEstimate || titleLocked;
    const mailingLines = rawBillingAddress
      ? rawBillingAddress.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      : ["Customer address"];
    const senderBranding = resolveOrganizationBranding(organizationDefaults);
    const senderName = senderBranding.senderDisplayName;
    const senderEmail = senderBranding.helpEmail;
    const senderAddressLines = senderBranding.senderAddressLines;
    const senderLogoUrl = senderBranding.logoUrl;


    // -----------------------------------------------------------------------
    // Sections + flat ordering
    // -----------------------------------------------------------------------

    const [sections, setSections] = useState<Map<number, string>>(new Map());
    const sectionIdRef = useRef(1);

    // Ordered list of entry keys: "item-{localId}" or "section-{id}".
    const [entryOrder, setEntryOrder] = useState<string[]>(() =>
      lineItems.map((l) => `item-${l.localId}`),
    );

    // Hydrate sections from API response when the estimate or its sections change.
    // Build a stable fingerprint so we only re-hydrate when the data actually differs.
    const apiSectionsFingerprint = apiSections
      ? apiSections.map((s) => `${s.id}:${s.name}:${s.order}`).join("|")
      : "";
    const lastHydratedKey = useRef("");
    const hydrationPending = useRef(false);
    useEffect(() => {
      const hydrateKey = `${estimateId}::${apiSectionsFingerprint}`;
      if (hydrateKey === lastHydratedKey.current) return;
      lastHydratedKey.current = hydrateKey;

      if (!apiSections?.length) {
        setSections(new Map());
        sectionIdRef.current = 1;
        setEntryOrder(lineItems.map((l) => `item-${l.localId}`));
        hydrationPending.current = true;
        return;
      }

      // Reconstruct sections map and entryOrder from API data.
      // Section order values are known; line items fill the remaining slots.
      const nextSections = new Map<number, string>();
      let maxSectionId = 0;
      for (const section of apiSections) {
        nextSections.set(section.id, section.name);
        if (section.id >= maxSectionId) maxSectionId = section.id;
      }

      const sectionsByOrder = new Map(apiSections.map((s) => [s.order, s]));
      const totalEntries = lineItems.length + apiSections.length;
      const sortedEntries: string[] = [];
      let lineIdx = 0;
      for (let order = 0; order < totalEntries; order++) {
        const section = sectionsByOrder.get(order);
        if (section) {
          sortedEntries.push(`section-${section.id}`);
        } else if (lineIdx < lineItems.length) {
          sortedEntries.push(`item-${lineItems[lineIdx].localId}`);
          lineIdx++;
        }
      }
      while (lineIdx < lineItems.length) {
        sortedEntries.push(`item-${lineItems[lineIdx].localId}`);
        lineIdx++;
      }

      setSections(nextSections);
      sectionIdRef.current = maxSectionId + 1;
      setEntryOrder(sortedEntries);
      hydrationPending.current = true;
    }, [estimateId, apiSectionsFingerprint, apiSections, lineItems]);

    // Sync entryOrder when line items are added or removed via user action.
    // Skip the render immediately after hydration — the hydration effect
    // already set the correct entryOrder but the sections state update
    // hasn't flushed yet, so the closure here sees the old Map.
    const lineKeys = new Set(lineItems.map((l) => `item-${l.localId}`));
    useEffect(() => {
      if (hydrationPending.current) {
        hydrationPending.current = false;
        return;
      }
      setEntryOrder((prev) => {
        const existing = new Set(prev);
        const toAdd = lineItems
          .map((l) => `item-${l.localId}`)
          .filter((k) => !existing.has(k));
        const pruned = prev.filter((key) => {
          if (key.startsWith("item-")) return lineKeys.has(key);
          if (key.startsWith("section-")) return sections.has(Number(key.replace("section-", "")));
          return false;
        });
        if (!toAdd.length && pruned.length === prev.length) return prev;
        return [...pruned, ...toAdd];
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lineItems.length, sections.size]);

    // -----------------------------------------------------------------------
    // Imperative handle — exposes order payload for submit
    // -----------------------------------------------------------------------

    useImperativeHandle(ref, () => ({
      getOrderPayload(): OrderPayload {
        const lineItemOrders = new Map<number, number>();
        const sectionPayloads: { name: string; order: number }[] = [];

        entryOrder.forEach((key, index) => {
          if (key.startsWith("item-")) {
            const localId = Number(key.replace("item-", ""));
            lineItemOrders.set(localId, index);
          } else if (key.startsWith("section-")) {
            const sectionId = Number(key.replace("section-", ""));
            const name = sections.get(sectionId);
            if (name != null) {
              sectionPayloads.push({ name, order: index });
            }
          }
        });

        return { lineItemOrders, sections: sectionPayloads };
      },
    }), [entryOrder, sections]);

    // -----------------------------------------------------------------------
    // Entry building
    // -----------------------------------------------------------------------

    const linesByLocalId = new Map(lineItems.map((l) => [`item-${l.localId}`, l]));
    const lineIndexByLocalId = new Map(lineItems.map((l, i) => [l.localId, i]));

    type Entry =
      | { type: "section"; id: number; name: string }
      | { type: "item"; line: EstimateLineInput; index: number };

    const entries: Entry[] = entryOrder.map((key: string): Entry | null => {
      if (key.startsWith("section-")) {
        const id = Number(key.replace("section-", ""));
        const name = sections.get(id);
        if (name == null) return null;
        return { type: "section", id, name };
      }
      const line = linesByLocalId.get(key);
      if (!line) return null;
      return { type: "item", line, index: lineIndexByLocalId.get(line.localId) ?? 0 };
    }).filter((e: Entry | null): e is Entry => e !== null);

    // -----------------------------------------------------------------------
    // Section CRUD
    // -----------------------------------------------------------------------

    function addSection() {
      const id = sectionIdRef.current++;
      setSections((prev) => new Map(prev).set(id, `Section ${id}`));
      setEntryOrder((prev) => [...prev, `section-${id}`]);
    }

    function removeSection(id: number) {
      setSections((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      setEntryOrder((prev) => prev.filter((k) => k !== `section-${id}`));
    }

    function renameSection(id: number, name: string) {
      setSections((prev) => new Map(prev).set(id, name));
    }

    // -----------------------------------------------------------------------
    // DnD
    // -----------------------------------------------------------------------

    function handleDragEnd(event: DragEndEvent) {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setEntryOrder((prev) => {
        const activeKey = String(active.id);
        const overKey = String(over.id);
        const from = prev.indexOf(activeKey);
        const to = prev.indexOf(overKey);
        if (from === -1 || to === -1) return prev;
        const next = [...prev];
        next.splice(from, 1);
        next.splice(to, 0, activeKey);
        return next;
      });
    }

    // -----------------------------------------------------------------------
    // Section totals (frontend display — also computed server-side on save)
    // -----------------------------------------------------------------------

    const sectionTotals = new Map<number, number>();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.type !== "section") continue;
      let total = 0;
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[j].type === "section") break;
        const item = entries[j];
        if (item.type === "item") {
          total += computeLineTotal(item.line);
        }
      }
      sectionTotals.set(entry.id, total);
    }

    // -----------------------------------------------------------------------
    // Render helpers
    // -----------------------------------------------------------------------

    function renderLineItemRow(line: EstimateLineInput, index: number, handleProps: Record<string, unknown>) {
      const rowIssues = lineValidation?.issuesByLocalId.get(line.localId) ?? [];
      const rowClass = `${lineStyles.row} ${!showMarkupColumn ? lineStyles.rowNoMarkup : ""} ${rowIssues.length ? lineStyles.rowInvalid : ""}`;
      return (
        <div className={rowClass}>
          {!readOnly ? (
            <button type="button" className={lineStyles.removeX} onClick={() => onRemoveLineItem(line.localId)} aria-label="Remove line item">&times;</button>
          ) : null}
          <span className={lineStyles.rowIndex} {...handleProps}>{!readOnly ? <span className={lineStyles.dragGrip}>⠿</span> : null} Item {index + 1}</span>
          <div className={`${lineStyles.field} ${lineStyles.fieldDesc}`}>
            <span className={lineStyles.fieldLabel}>Description</span>
            <input className={lineStyles.fieldInput} aria-label="Description" value={line.description}
              onChange={(e) => onLineItemChange(line.localId, "description", e.target.value)}
              disabled={readOnly} required />
          </div>
          <div className={`${lineStyles.field} ${lineStyles.fieldCostCode} ${rowIssues.length ? lineStyles.fieldInvalid : ""}`}>
            <span className={lineStyles.fieldLabel}>
              Cost Code
              {line.costCodeId ? (
                <span className={costCodes.find((c) => String(c.id) === line.costCodeId)?.taxable !== false ? lineStyles.taxBadgeTaxable : lineStyles.taxBadgeExempt}>
                  {costCodes.find((c) => String(c.id) === line.costCodeId)?.taxable !== false ? "TAX" : "NO TAX"}
                </span>
              ) : null}
            </span>
            <CostCodeCombobox costCodes={costCodes} value={line.costCodeId}
              onChange={(v) => onLineItemChange(line.localId, "costCodeId", v)}
              ariaLabel="Cost code" disabled={readOnly} placeholder="Search cost code" />
          </div>
          <div className={`${lineStyles.field} ${lineStyles.fieldQty}`}>
            <span className={lineStyles.fieldLabel}>Qty</span>
            <input className={lineStyles.fieldInput} aria-label="Quantity" value={line.quantity}
              onChange={(e) => onLineItemChange(line.localId, "quantity", e.target.value)}
              inputMode="decimal" disabled={readOnly} required />
          </div>
          <div className={`${lineStyles.field} ${lineStyles.fieldUnit}`}>
            <span className={lineStyles.fieldLabel}>Unit</span>
            <input className={lineStyles.fieldInput} aria-label="Unit" value={line.unit}
              onChange={(e) => onLineItemChange(line.localId, "unit", e.target.value)}
              disabled={readOnly} required />
          </div>
          <div className={`${lineStyles.field} ${lineStyles.fieldPrice}`}>
            <span className={lineStyles.fieldLabel}>Price</span>
            <input className={lineStyles.fieldInput} aria-label="Unit cost" value={line.unitCost}
              onChange={(e) => onLineItemChange(line.localId, "unitCost", e.target.value)}
              inputMode="decimal" disabled={readOnly} required />
          </div>
          {showMarkupColumn ? (
            <div className={`${lineStyles.field} ${lineStyles.fieldMarkup}`}>
              <span className={lineStyles.fieldLabel}>Markup %</span>
              <input className={lineStyles.fieldInput} aria-label="Markup percent" value={line.markupPercent}
                onChange={(e) => onLineItemChange(line.localId, "markupPercent", e.target.value)}
                inputMode="decimal" disabled={readOnly} required />
            </div>
          ) : null}
          <div className={`${lineStyles.field} ${lineStyles.fieldAmount}`}>
            <span className={lineStyles.fieldLabel}>Amount</span>
            <span className={lineStyles.amountValue}>${formatDecimal(lineTotals[index] || 0)}</span>
          </div>
        </div>
      );
    }

    function renderSectionHeader(section: { id: number; name: string }, handleProps: Record<string, unknown>) {
      const total = sectionTotals.get(section.id) ?? 0;
      return (
        <div className={lineStyles.sectionHeader}>
          {!readOnly ? (
            <button type="button" className={lineStyles.removeX} onClick={() => removeSection(section.id)} aria-label="Remove section">&times;</button>
          ) : null}
          <div className={lineStyles.sectionNameRow}>
            {!readOnly ? <span className={lineStyles.sectionDragHandle} {...handleProps}><span className={lineStyles.dragGrip}>⠿</span></span> : null}
            <input
              className={lineStyles.sectionNameInput}
              value={section.name}
              onChange={(e) => renameSection(section.id, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
              disabled={readOnly}
              aria-label="Section name"
            />
            <span className={lineStyles.sectionTotal}>${formatDecimal(total)}</span>
          </div>
        </div>
      );
    }

    // -----------------------------------------------------------------------
    // Layout sections
    // -----------------------------------------------------------------------

    const headerSection = (
      <section className={creatorStyles.sheetSection}>
        <div className={creatorStyles.sheetHeader}>
          <div className={creatorStyles.partyStack}>
            <div className={creatorStyles.fromBlock}>
              <span className={creatorStyles.blockLabel}>From</span>
              <p className={creatorStyles.blockText}>{senderName || "Your Company"}</p>
              {senderAddressLines.length ? (
                senderAddressLines.map((line, index) => (
                  <p key={`${line}-${index}`} className={creatorStyles.blockMuted}>{line}</p>
                ))
              ) : (
                <p className={creatorStyles.blockMuted}>Set sender address in Organization settings.</p>
              )}
            </div>
            <div className={creatorStyles.toBlock}>
              <span className={creatorStyles.blockLabel}>To</span>
              <p className={creatorStyles.blockText}>{customerName}</p>
              {mailingLines.map((line, index) => (
                <p key={`${line}-${index}`} className={creatorStyles.blockMuted}>{line}</p>
              ))}
            </div>
          </div>
          <div className={creatorStyles.headerRight}>
            <div className={`${creatorStyles.logoBox} ${senderLogoUrl ? creatorStyles.logoBoxHasImage : ""}`}>
              {senderLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={creatorStyles.logoImage} src={senderLogoUrl} alt={`${senderName || "Company"} logo`} />
              ) : "No logo set"}
            </div>
            <div className={creatorStyles.sheetTitle}>Estimate</div>
            <div className={`${creatorStyles.sheetTitleValue} ${creatorStyles.printOnly}`}>
              {estimateTitle || "Untitled"}
            </div>
          </div>
        </div>
      </section>
    );

    const metaSection = (
      <section className={creatorStyles.sheetSection}>
        <div className={creatorStyles.metaOnlyRow}>
          <div className={creatorStyles.metaBlock}>
            <div className={creatorStyles.metaTitle}>Estimate Details</div>
            <label className={`${creatorStyles.inlineField} ${creatorStyles.screenOnly}`}>
              Estimate title
              <input
                className={creatorStyles.fieldInput}
                value={estimateTitle}
                onChange={(event) => onTitleChange(event.target.value)}
                placeholder="Enter estimate title"
                disabled={titleReadOnly}
                aria-disabled={titleReadOnly}
              />
            </label>
            {duplicateHint ? <p className={creatorStyles.duplicateHint}>{duplicateHint}</p> : null}
            <div className={creatorStyles.metaLine}>
              <span>Estimate date</span>
              <input className={creatorStyles.fieldInput} type="date" value={estimateDate} disabled aria-disabled="true" />
            </div>
            <div className={creatorStyles.metaLine}>
              <span>Valid through</span>
              <input
                className={creatorStyles.fieldInput}
                type="date"
                value={validThrough}
                onChange={(event) => onValidThroughChange(event.target.value)}
                disabled={readOnly}
                aria-disabled={readOnly}
              />
            </div>
          </div>
        </div>
      </section>
    );

    const lineItemsSection = (
      <section className={creatorStyles.sheetSection}>
        <div className={creatorStyles.lineSectionIntro}>
          <h3>Line Items</h3>
          {!readOnly ? (
            <button type="button" className={creatorStyles.secondaryButton} onClick={addSection}>
              + Add Section
            </button>
          ) : null}
        </div>
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[verticalOnly]}>
          <SortableContext items={entryOrder} strategy={verticalListSortingStrategy}>
            <div className={lineStyles.list}>
              {entries.map((entry) => {
                const key = entry.type === "section" ? `section-${entry.id}` : `item-${entry.line.localId}`;
                return (
                  <SortableEntry key={key} id={key} disabled={readOnly}>
                    {(hProps) =>
                      entry.type === "section"
                        ? renderSectionHeader(entry, hProps)
                        : renderLineItemRow(entry.line, entry.index, hProps)
                    }
                  </SortableEntry>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        {!readOnly ? (
          <div className={creatorStyles.lineActions}>
            <button type="button" className={creatorStyles.secondaryButton}
              onClick={onAddLineItem}>
              Add Line Item
            </button>
          </div>
        ) : null}
      </section>
    );

    const totalsSection = (
      <section className={creatorStyles.sheetSection}>
        <div className={creatorStyles.summary}>
          <div className={creatorStyles.summaryRow}>
            <span>Subtotal</span>
            <span>${formatDecimal(subtotal)}</span>
          </div>
          <div className={creatorStyles.summaryRow}>
            <span>Sales Tax</span>
            <div className={creatorStyles.summaryTaxLine}>
              {!readOnly ? (
                <span className={creatorStyles.summaryTaxRate}>
                  <input
                    className={creatorStyles.summaryTaxInput}
                    value={taxPercent}
                    onChange={(event) => onTaxPercentChange(event.target.value)}
                    inputMode="decimal"
                    aria-label="Sales tax percent"
                    disabled={readOnly}
                    aria-disabled={readOnly}
                  />
                  <span className={creatorStyles.summaryTaxSuffix}>%</span>
                </span>
              ) : null}
              <span className={creatorStyles.summaryTaxAmount}>${formatDecimal(taxAmount)}</span>
            </div>
          </div>
          <div className={`${creatorStyles.summaryRow} ${creatorStyles.summaryTotal}`}>
            <span>Total</span>
            <span>${formatDecimal(totalAmount)}</span>
          </div>
        </div>
      </section>
    );

    const notesSection = (
      <section className={creatorStyles.sheetSection}>
        <div className={creatorStyles.terms}>
          <h4>Notes &amp; Exclusions</h4>
          {readOnly ? (
            (notesText || "None")
              .split("\n")
              .filter((line) => line.trim())
              .map((line, index) => <p key={`notes-${index}`}>{line}</p>)
          ) : (
            <textarea
              className={creatorStyles.termsInput}
              value={notesText}
              onChange={(e) => onNotesTextChange(e.target.value)}
              placeholder="General notes, scope exclusions, assumptions..."
              rows={3}
            />
          )}
        </div>
      </section>
    );

    const termsSection = (
      <section className={creatorStyles.sheetSection}>
        <div className={creatorStyles.terms}>
          <h4>Terms and Conditions</h4>
          {(termsText || organizationDefaults?.estimate_terms_and_conditions || "Not set")
            .split("\n")
            .filter((line) => line.trim())
            .map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
        </div>
      </section>
    );

    const footerSection = (
      <section className={creatorStyles.sheetSection}>
        <div className={creatorStyles.footer}>
          <span>{senderName || "Your Company"}</span>
          <span>{senderEmail || "Help email not set"}</span>
          <span>{estimateId ? "Estimate" : "Draft estimate"}</span>
        </div>
      </section>
    );

    const submitSection = !readOnly ? (
      <section className={creatorStyles.sheetSection}>
        <div className={creatorStyles.finalizeActions}>
          {formErrorMessage ? <p className={creatorStyles.actionError}>{formErrorMessage}</p> : null}
          {!formErrorMessage && formSuccessMessage ? (
            <p className={creatorStyles.actionSuccess}>{formSuccessMessage}</p>
          ) : null}
          <button type="submit" className={creatorStyles.primaryButton} disabled={!canSubmit || isSubmitting}>
            {isSubmitting
              ? isEditingDraft ? "Saving..." : "Creating..."
              : isEditingDraft ? "Save Draft Changes" : "Create Estimate"}
          </button>
        </div>
      </section>
    ) : null;

    // -----------------------------------------------------------------------
    // Layout
    // -----------------------------------------------------------------------

    return (
      <form
        className={`${creatorStyles.sheet} ${readOnly ? creatorStyles.sheetReadOnly : ""}`}
        onSubmit={onSubmit}
      >
        {headerSection}
        {metaSection}
        {lineItemsSection}
        {totalsSection}
        {submitSection}
        {notesSection}
        {termsSection}
        {footerSection}
      </form>
    );
  },
);
