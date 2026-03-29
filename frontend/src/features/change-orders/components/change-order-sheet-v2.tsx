/**
 * Change order line items sheet with flat ordering, sections, and DnD.
 *
 * Mirrors the estimate-sheet-v2 pattern: sections and line items share
 * an ordering space, DnD reordering via drag handles, and an imperative
 * handle (getOrderPayload) for the parent console to read on submit.
 *
 * This is a focused line-items component — the surrounding document chrome
 * (title, reason, terms, submit) stays in the workspace panel.
 */
"use client";

import {
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
import lineStyles from "./co-line-row.module.css";

import { CostCodeCombobox } from "@/features/estimates/components/cost-code-combobox";
import type { ChangeOrderLineInput, ChangeOrderSectionRecord, CostCodeOption } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** Generic sortable wrapper. Drag handle only — inputs/buttons work normally. */
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

type LineValidationResult = {
  issues: Array<{ localId: number; rowNumber: number; message: string }>;
  issuesByLocalId: Map<number, string[]>;
};

/** Payload returned by getOrderPayload() for the parent to include in API requests. */
export type COOrderPayload = {
  lineItemOrders: Map<number, number>;
  sections: { name: string; order: number }[];
};

/** Imperative handle exposed to the parent console via ref. */
export type ChangeOrderSheetV2Handle = {
  getOrderPayload: () => COOrderPayload;
};

type ChangeOrderSheetV2Props = {
  lineItems: ChangeOrderLineInput[];
  costCodes: CostCodeOption[];
  readOnly: boolean;
  lineValidation?: LineValidationResult;
  /** Sections from the API response — used to hydrate local section state. */
  apiSections?: ChangeOrderSectionRecord[];
  /** Stable identifier for hydration gating (e.g. change order ID). */
  changeOrderId: string;
  onLineItemChange: (localId: number, updates: Partial<ChangeOrderLineInput>) => void;
  onAddLineItem: () => void;
  onRemoveLineItem: (localId: number) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ChangeOrderSheetV2 = forwardRef<ChangeOrderSheetV2Handle, ChangeOrderSheetV2Props>(
  function ChangeOrderSheetV2(
    {
      lineItems,
      costCodes,
      readOnly,
      lineValidation,
      apiSections,
      changeOrderId,
      onLineItemChange,
      onAddLineItem,
      onRemoveLineItem,
    },
    ref,
  ) {

    // -----------------------------------------------------------------------
    // Sections + flat ordering
    // -----------------------------------------------------------------------

    const [sections, setSections] = useState<Map<number, string>>(new Map());
    const sectionIdRef = useRef(1);

    // Ordered list of entry keys: "item-{localId}" or "section-{id}".
    const [entryOrder, setEntryOrder] = useState<string[]>(() =>
      lineItems.map((l) => `item-${l.localId}`),
    );

    // Hydrate sections from API response when the CO or its sections change.
    const apiSectionsFingerprint = apiSections
      ? apiSections.map((s) => `${s.id}:${s.name}:${s.order}`).join("|")
      : "";
    const lastHydratedKey = useRef("");
    const hydrationPending = useRef(false);
    useEffect(() => {
      const hydrateKey = `${changeOrderId}::${apiSectionsFingerprint}`;
      if (hydrateKey === lastHydratedKey.current) return;
      lastHydratedKey.current = hydrateKey;

      if (!apiSections?.length) {
        setSections(new Map());
        sectionIdRef.current = 1;
        setEntryOrder(lineItems.map((l) => `item-${l.localId}`));
        hydrationPending.current = true;
        return;
      }

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
    }, [changeOrderId, apiSectionsFingerprint, apiSections, lineItems]);

    // Sync entryOrder when line items are added or removed via user action.
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
      getOrderPayload(): COOrderPayload {
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
      | { type: "item"; line: ChangeOrderLineInput; index: number };

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
          total += Number(item.line.amountDelta || 0);
        }
      }
      sectionTotals.set(entry.id, total);
    }

    // -----------------------------------------------------------------------
    // Render helpers
    // -----------------------------------------------------------------------

    function renderLineItemRow(line: ChangeOrderLineInput, index: number, handleProps: Record<string, unknown>) {
      const rowIssues = lineValidation?.issuesByLocalId.get(line.localId) ?? [];
      const rowClass = `${lineStyles.row} ${rowIssues.length ? lineStyles.rowInvalid : ""}`;
      return (
        <div className={rowClass}>
          {!readOnly ? (
            <button type="button" className={lineStyles.removeX} onClick={() => onRemoveLineItem(line.localId)} aria-label="Remove line item">&times;</button>
          ) : null}
          <span className={lineStyles.rowIndex} {...handleProps}>{!readOnly ? <span className={lineStyles.dragGrip}>⠿</span> : null} Item {index + 1}</span>
          <div className={`${lineStyles.field} ${lineStyles.fieldDesc}`}>
            <span className={lineStyles.fieldLabel}>Description</span>
            <input className={lineStyles.fieldInput} aria-label="Description" value={line.description}
              onChange={(e) => onLineItemChange(line.localId, { description: e.target.value })}
              placeholder="Optional CO scope note"
              disabled={readOnly} />
          </div>
          <div className={`${lineStyles.field} ${lineStyles.fieldCostCode} ${rowIssues.length ? lineStyles.fieldInvalid : ""}`}>
            <span className={lineStyles.fieldLabel}>Cost Code</span>
            <CostCodeCombobox costCodes={costCodes} value={line.costCodeId}
              onChange={(v) => onLineItemChange(line.localId, { costCodeId: v })}
              ariaLabel="Cost code" disabled={readOnly} placeholder="Search cost code" />
          </div>
          <div className={`${lineStyles.field} ${lineStyles.fieldDelta}`}>
            <span className={lineStyles.fieldLabel}>CO Delta ($)</span>
            <input className={lineStyles.fieldInput} aria-label="Amount delta" value={line.amountDelta}
              onChange={(e) => onLineItemChange(line.localId, { amountDelta: e.target.value })}
              placeholder="0.00"
              inputMode="decimal" disabled={readOnly} />
          </div>
          <div className={`${lineStyles.field} ${lineStyles.fieldDays}`}>
            <span className={lineStyles.fieldLabel}>Days</span>
            <input className={lineStyles.fieldInput} aria-label="Schedule delta" value={line.daysDelta}
              onChange={(e) => onLineItemChange(line.localId, { daysDelta: e.target.value })}
              placeholder="0"
              inputMode="numeric" disabled={readOnly} />
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
    // Render
    // -----------------------------------------------------------------------

    return (
      <section className={creatorStyles.sheetSection} style={{ marginTop: "var(--space-lg)" }}>
        <div className={creatorStyles.lineSectionIntro} style={{ marginBottom: 0 }}>
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
            <button type="button" className={creatorStyles.secondaryButton} onClick={onAddLineItem}>
              Add Line Item
            </button>
          </div>
        ) : null}
      </section>
    );
  },
);
