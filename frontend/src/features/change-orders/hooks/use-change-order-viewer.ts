/**
 * Viewer-side derived state for the change-orders console.
 *
 * Computes filtered/sorted change-order lists, pagination, selected viewer
 * records, working totals, status event history, and quick-status options
 * from the raw project data and form selection state.
 *
 * Consumer: ChangeOrdersConsole (composed alongside useChangeOrderProjectData
 * and useChangeOrderForm).
 *
 * ## Memos
 *
 * - viewerChangeOrders               — COs filtered to the selected quote, sorted by created_at/family/revision
 * - approvedCOsForSelectedQuote   — approved subset of viewerChangeOrders
 * - selectedChangeOrderStatusEvents  — audit events for the selected CO, newest first
 * - quickStatusOptions               — available status transitions for the selected viewer CO
 * - selectedViewerWorkingTotals      — pre/post-approval budget totals
 * - changeOrderCreatorStatusPolicy   — status policy for the document-creator adapter
 * - changeOrderCreatorAdapter        — document-creator adapter instance
 *
 * ## Derived
 *
 * - selectedChangeOrder              — the CO matching selectedChangeOrderId
 * - selectedViewerQuote           — the quote matching selectedViewerQuoteId
 * - selectedViewerChangeOrder        — the CO from viewerChangeOrders matching selection, or first
 * - currentAcceptedTotal             — current approved budget for the selected quote
 * - originalQuoteTotal            — original budget for the selected quote
 * - Various workspace display values (context, badge, editable flags)
 *
 * @module
 */

import { useCallback, useMemo } from "react";
import { parseAmount, formatDecimal } from "@/shared/money-format";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { canDo } from "@/shared/session/rbac";
import {
  CHANGE_ORDER_STATUSES_FALLBACK,
  currentApprovedBudgetTotalForQuote,
  originalBudgetTotalForQuote,
} from "../components/change-orders-display";
import {
  createChangeOrderDocumentAdapter,
  toChangeOrderStatusPolicy,
} from "../document-adapter";
import type {
  AuditEventRecord,
  ChangeOrderRecord,
  OriginQuoteRecord,
} from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UseChangeOrderViewerOptions = {
  changeOrders: ChangeOrderRecord[];
  projectQuotes: OriginQuoteRecord[];
  originQuoteOriginalTotals: Record<number, number>;
  projectAuditEvents: AuditEventRecord[];
  selectedProjectId: string;
  selectedViewerQuoteId: string;
  selectedChangeOrderId: string;
  changeOrderStatusLabels: Record<string, string>;
  changeOrderAllowedTransitions: Record<string, string[]>;
  capabilities: Record<string, string[]> | undefined;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Sort change orders by created_at, then family_key, then id. */
export function sortChangeOrdersForViewer(changeOrders: ChangeOrderRecord[]): ChangeOrderRecord[] {
  return [...changeOrders].sort((left, right) => {
    const leftCreatedAt = Date.parse(left.created_at);
    const rightCreatedAt = Date.parse(right.created_at);
    if (Number.isFinite(leftCreatedAt) && Number.isFinite(rightCreatedAt)) {
      const createdAtDelta = leftCreatedAt - rightCreatedAt;
      if (createdAtDelta !== 0) {
        return createdAtDelta;
      }
    }
    const familyDelta = Number(left.family_key) - Number(right.family_key);
    if (familyDelta !== 0) {
      return familyDelta;
    }
    return left.id - right.id;
  });
}

/**
 * Compute pre- and post-approval working budget totals for the selected
 * viewer change order within its origin quote's scope.
 */
export function computeWorkingTotals(
  changeOrders: ChangeOrderRecord[],
  selectedViewerQuoteRecordId: number | null,
  selectedViewerChangeOrderIdValue: number | null,
  selectedViewerChangeOrderLineDelta: number,
  selectedViewerChangeOrderIsApproved: boolean,
  originQuoteOriginalTotals: Record<number, number>,
): { preApproval: string; postApproval: string } {
  if (!selectedViewerQuoteRecordId || !selectedViewerChangeOrderIdValue) {
    return { preApproval: "0.00", postApproval: "0.00" };
  }
  const approvedRollingDelta = changeOrders.reduce((sum, changeOrder) => {
    if (
      changeOrder.origin_quote !== selectedViewerQuoteRecordId ||
      changeOrder.status !== "approved"
    ) {
      return sum;
    }
    return sum + parseAmount(changeOrder.amount_delta);
  }, 0);
  const originalBudgetTotal = originQuoteOriginalTotals[selectedViewerQuoteRecordId] ?? 0;
  const currentApprovedWorkingTotal = originalBudgetTotal + approvedRollingDelta;
  const preApprovalTotal = selectedViewerChangeOrderIsApproved
    ? currentApprovedWorkingTotal - selectedViewerChangeOrderLineDelta
    : currentApprovedWorkingTotal;
  const postApprovalTotal = preApprovalTotal + selectedViewerChangeOrderLineDelta;
  return {
    preApproval: formatDecimal(preApprovalTotal),
    postApproval: formatDecimal(postApprovalTotal),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Compute all viewer-side derived state for the change-orders console.
 *
 * @param options - Raw data and selection state from project-data and form hooks.
 * @returns Derived viewer records, pagination, status policy, adapter, and display values.
 */
export function useChangeOrderViewer({
  changeOrders,
  projectQuotes,
  originQuoteOriginalTotals,
  projectAuditEvents,
  selectedProjectId,
  selectedViewerQuoteId,
  selectedChangeOrderId,
  changeOrderStatusLabels,
  changeOrderAllowedTransitions,
  capabilities,
}: UseChangeOrderViewerOptions) {

  // --- Derived ---

  const canMutateChangeOrders = canDo(capabilities, "change_orders", "create");
  const canSendChangeOrders = canDo(capabilities, "change_orders", "send");
  const canApproveChangeOrders = canDo(capabilities, "change_orders", "approve");

  const selectedChangeOrder =
    changeOrders.find((row) => String(row.id) === selectedChangeOrderId) ?? null;

  const selectedViewerQuote =
    projectQuotes.find((quote) => String(quote.id) === selectedViewerQuoteId) ?? null;

  // Memoized stable sort function for reuse in callbacks.
  const sortCOs = useCallback((rows: ChangeOrderRecord[]) => {
    return sortChangeOrdersForViewer(rows);
  }, []);

  // --- Memos ---

  const viewerChangeOrders = useMemo(() => {
    if (!selectedViewerQuoteId) {
      return [] as ChangeOrderRecord[];
    }
    const originQuoteId = Number(selectedViewerQuoteId);
    return sortCOs(
      changeOrders.filter((changeOrder) => changeOrder.origin_quote === originQuoteId),
    );
  }, [changeOrders, selectedViewerQuoteId, sortCOs]);

  const {
    page: coPage,
    totalPages: coTotalPages,
    totalCount: coTotalCount,
    paginatedItems: paginatedChangeOrders,
    setPage: setCoPage,
  } = useClientPagination(viewerChangeOrders);

  const selectedViewerChangeOrder =
    viewerChangeOrders.find((changeOrder) => String(changeOrder.id) === selectedChangeOrderId) ??
    viewerChangeOrders[0] ??
    null;

  const selectedViewerQuoteRecordId = selectedViewerQuote?.id ?? null;

  const approvedCOsForSelectedQuote = useMemo(() => {
    return viewerChangeOrders.filter((co) => co.status === "approved");
  }, [viewerChangeOrders]);

  const selectedViewerChangeOrderIdValue = selectedViewerChangeOrder?.id ?? null;
  const selectedViewerChangeOrderLineDelta = selectedViewerChangeOrder
    ? parseAmount(selectedViewerChangeOrder.line_total_delta || selectedViewerChangeOrder.amount_delta)
    : 0;
  const selectedViewerChangeOrderIsApproved = Boolean(
    selectedViewerChangeOrder && selectedViewerChangeOrder.status === "approved",
  );

  const quickStatusOptions = useMemo(() => {
    if (!selectedViewerChangeOrder) {
      return [] as string[];
    }
    const base = [...(changeOrderAllowedTransitions[selectedViewerChangeOrder.status] ?? [])];
    const allowResend = selectedViewerChangeOrder.status === "sent";
    if (allowResend && !base.includes(selectedViewerChangeOrder.status)) {
      base.unshift(selectedViewerChangeOrder.status);
    }
    return base.filter((status) => {
      if (status === "sent") return canSendChangeOrders;
      if (status === "approved") return canApproveChangeOrders;
      return true;
    });
  }, [changeOrderAllowedTransitions, selectedViewerChangeOrder, canSendChangeOrders, canApproveChangeOrders]);

  const isSelectedChangeOrderDraft = selectedChangeOrder?.status === "draft";
  const isSelectedChangeOrderEditable =
    canMutateChangeOrders &&
    Boolean(selectedChangeOrderId) &&
    isSelectedChangeOrderDraft;

  const isCreateSubmitDisabled =
    !canMutateChangeOrders ||
    !selectedProjectId ||
    !selectedViewerQuoteId;

  const isEditSubmitDisabled = !isSelectedChangeOrderEditable;

  const currentAcceptedTotal = selectedViewerQuote
    ? currentApprovedBudgetTotalForQuote(selectedViewerQuote.id, changeOrders, originQuoteOriginalTotals)
    : null;

  const originalQuoteTotal = selectedViewerQuote
    ? originalBudgetTotalForQuote(selectedViewerQuote.id, originQuoteOriginalTotals)
    : null;

  const changeOrderCreatorStatusPolicy = useMemo(
    () =>
      toChangeOrderStatusPolicy({
        policy_version: "ui-fallback",
        status_labels: changeOrderStatusLabels,
        statuses: CHANGE_ORDER_STATUSES_FALLBACK,
        default_create_status: "draft",
        allowed_status_transitions: changeOrderAllowedTransitions,
        terminal_statuses: ["approved", "void"],
      }),
    [changeOrderAllowedTransitions, changeOrderStatusLabels],
  );

  const changeOrderCreatorAdapter = useMemo(
    () => createChangeOrderDocumentAdapter(changeOrderCreatorStatusPolicy, []),
    [changeOrderCreatorStatusPolicy],
  );

  const selectedChangeOrderStatusEvents = useMemo(() => {
    if (!selectedViewerChangeOrder) {
      return [] as AuditEventRecord[];
    }
    return projectAuditEvents
      .filter((event) =>
        event.event_type === "change_order_updated" &&
        event.object_type === "change_order" &&
        event.object_id === selectedViewerChangeOrder.id &&
        (Boolean(event.from_status) || Boolean(event.to_status)))
      .sort((left, right) => {
        const leftTime = Date.parse(left.created_at);
        const rightTime = Date.parse(right.created_at);
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
          return rightTime - leftTime;
        }
        return right.id - left.id;
      });
  }, [projectAuditEvents, selectedViewerChangeOrder]);

  const selectedViewerWorkingTotals = useMemo(
    () => computeWorkingTotals(
      changeOrders,
      selectedViewerQuoteRecordId,
      selectedViewerChangeOrderIdValue,
      selectedViewerChangeOrderLineDelta,
      selectedViewerChangeOrderIsApproved,
      originQuoteOriginalTotals,
    ),
    [
      changeOrders,
      selectedViewerQuoteRecordId,
      selectedViewerChangeOrderIdValue,
      selectedViewerChangeOrderLineDelta,
      selectedViewerChangeOrderIsApproved,
      originQuoteOriginalTotals,
    ],
  );

  // --- Return bag ---

  return {
    // Derived records
    selectedChangeOrder,
    selectedViewerQuote,
    selectedViewerChangeOrder,
    viewerChangeOrders,
    paginatedChangeOrders,
    approvedCOsForSelectedQuote,
    selectedChangeOrderStatusEvents,

    // Pagination
    coPage,
    coTotalPages,
    coTotalCount,
    setCoPage,

    // Status/policy
    quickStatusOptions,
    changeOrderCreatorStatusPolicy,
    changeOrderCreatorAdapter,
    selectedViewerWorkingTotals,

    // RBAC
    canMutateChangeOrders,
    canSendChangeOrders,
    canApproveChangeOrders,

    // Editable flags
    isSelectedChangeOrderEditable,
    isSelectedChangeOrderDraft,
    isCreateSubmitDisabled,
    isEditSubmitDisabled,

    // Financial summaries
    currentAcceptedTotal,
    originalQuoteTotal,

    // Utilities
    sortCOs,
  };
}

