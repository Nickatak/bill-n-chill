"use client";

/**
 * Change orders console -- the primary internal workspace for managing change
 * orders within a project. Provides estimate-linked revision browsing,
 * draft creation/editing, status transitions with quick-status pills, audit
 * event history, and budget-line-anchored line-item creators.
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { parseAmount, formatDecimal } from "@/shared/money-format";
import {
  financialBaselineStatus,
  formatFinancialBaselineStatus,
} from "@/shared/financial-baseline";
import {
  coLabel,
  defaultChangeOrderTitle,
  emptyLine,
  publicChangeOrderHref,
  readChangeOrderApiError,
  validateLineItems,
} from "../helpers";
import {
  defaultApiBaseUrl,
  fetchChangeOrderPolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { usePolicyContract } from "@/shared/hooks/use-policy-contract";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { canDo } from "../../session/rbac";
import {
  ApiResponse,
  BudgetLineRecord,
  ChangeOrderLineInput,
  ChangeOrderPolicyContract,
  ChangeOrderRecord,
  CostCodeOption,
} from "../types";
import { usePrintable } from "@/shared/shell/printable-context";
import styles from "./change-orders-console.module.css";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import changeOrderCreatorStyles from "@/shared/document-creator/change-order-creator.module.css";
import stampStyles from "@/shared/styles/decision-stamp.module.css";
import { DocumentCreator } from "@/shared/document-creator";
import { collapseToggleButtonStyles as collapseButtonStyles } from "@/shared/project-list-viewer";
import {
  resolveOrganizationBranding,
  type OrganizationBrandingDefaults,
} from "@/shared/document-creator";
import {
  createChangeOrderDocumentAdapter,
  ChangeOrderFormState,
  toChangeOrderStatusPolicy,
} from "../document-adapter";
import { useClientPagination } from "@/shared/hooks/use-client-pagination";
import { PaginationControls } from "@/shared/components/pagination-controls";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type LineSetter = (
  value:
    | ChangeOrderLineInput[]
    | ((current: ChangeOrderLineInput[]) => ChangeOrderLineInput[]),
) => void;

type ChangeOrdersConsoleProps = {
  scopedProjectId?: number | null;
  initialOriginEstimateId?: number | null;
};

type OriginEstimateRecord = {
  id: number;
  title: string;
  version: number;
  approved_at: string | null;
  approved_by_email: string | null;
  financial_baseline_status?: "none" | "active" | "superseded";
  is_active_financial_baseline?: boolean;
};

type AuditEventRecord = {
  id: number;
  event_type: string;
  object_type: string;
  object_id: number;
  from_status: string;
  to_status: string;
  note: string;
  metadata_json?: Record<string, unknown> | null;
  created_by: number;
  created_by_email: string | null;
  created_by_display?: string | null;
  created_by_customer_id?: number | null;
  created_at: string;
};

type OrganizationDocumentDefaults = OrganizationBrandingDefaults & {
  change_order_terms_and_conditions: string;
};

const CHANGE_ORDER_STATUS_LABELS_FALLBACK: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  void: "Void",
};
const CHANGE_ORDER_STATUSES_FALLBACK = ["draft", "pending_approval", "approved", "rejected", "void"];

const CHANGE_ORDER_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, string[]> = {
  draft: ["pending_approval", "void"],
  pending_approval: ["approved", "rejected", "void"],
  approved: [],
  rejected: ["void"],
  void: [],
};
const CHANGE_ORDER_MIN_LINE_ITEMS_ERROR = "At least one line item is required.";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Internal change-orders workspace: estimate-linked viewer, dual creators (create + edit), and status lifecycle. */
export function ChangeOrdersConsole({
  scopedProjectId: scopedProjectIdProp = null,
  initialOriginEstimateId: initialOriginEstimateIdProp = null,
}: ChangeOrdersConsoleProps) {
  const { token, role, capabilities } = useSharedSessionAuth();
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"error" | "success" | "info">("info");

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [changeOrders, setChangeOrders] = useState<ChangeOrderRecord[]>([]);
  const [selectedChangeOrderId, setSelectedChangeOrderId] = useState("");
  const [selectedViewerEstimateId, setSelectedViewerEstimateId] = useState("");
  const [isViewerExpanded, setIsViewerExpanded] = useState(true);
  const [budgetLines, setBudgetLines] = useState<BudgetLineRecord[]>([]);
  const [costCodes, setCostCodes] = useState<CostCodeOption[]>([]);
  const [originEstimateOriginalTotals, setOriginEstimateOriginalTotals] = useState<
    Record<number, number>
  >({});
  const [projectEstimates, setProjectEstimates] = useState<OriginEstimateRecord[]>([]);
  const [projectAuditEvents, setProjectAuditEvents] = useState<AuditEventRecord[]>([]);
  const [newLineNextLocalId, setNewLineNextLocalId] = useState(2);
  const [editLineNextLocalId, setEditLineNextLocalId] = useState(2);
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [organizationDefaults, setOrganizationDefaults] =
    useState<OrganizationDocumentDefaults | null>(null);

  const [newTitle, setNewTitle] = useState("Change Order");
  const [newTitleManuallyEdited, setNewTitleManuallyEdited] = useState(false);
  const [newReason, setNewReason] = useState("");
  const [newTermsText, setNewTermsText] = useState("");
  const [newLineItems, setNewLineItems] = useState<ChangeOrderLineInput[]>([emptyLine(1)]);

  const [editTitle, setEditTitle] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editTermsText, setEditTermsText] = useState("");
  const [editLineItems, setEditLineItems] = useState<ChangeOrderLineInput[]>([emptyLine(1)]);
  const [quickStatus, setQuickStatus] = useState("");
  const [quickStatusNote, setQuickStatusNote] = useState("");
  const [isStatusSectionOpen, setIsStatusSectionOpen] = useState(true);
  const [isHistorySectionOpen, setIsHistorySectionOpen] = useState(false);
  const [isLineItemsSectionOpen, setIsLineItemsSectionOpen] = useState(true);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [showBudgetColumns, setShowBudgetColumns] = useState(false);
  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const { statusLabels: changeOrderStatusLabels, allowedTransitions: changeOrderAllowedTransitions } =
    usePolicyContract<ChangeOrderPolicyContract>({
      fetchContract: fetchChangeOrderPolicyContract,
      fallbackStatuses: CHANGE_ORDER_STATUSES_FALLBACK,
      fallbackLabels: CHANGE_ORDER_STATUS_LABELS_FALLBACK,
      fallbackTransitions: CHANGE_ORDER_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
      baseUrl: normalizedBaseUrl,
      token,
    });
  const createCreatorRef = useRef<HTMLDivElement | null>(null);
  const editCreatorRef = useRef<HTMLDivElement | null>(null);
  const [createFlashCount, setCreateFlashCount] = useState(0);
  const [editFlashCount, setEditFlashCount] = useState(0);
  const { setPrintable } = usePrintable();

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  useEffect(() => {
    setPrintable(!!selectedChangeOrderId);
    return () => setPrintable(false);
  }, [selectedChangeOrderId, setPrintable]);

  useEffect(() => {
    if (createFlashCount === 0) return;
    const el = createCreatorRef.current;
    if (!el) return;
    el.classList.remove(creatorStyles.sheetFlash);
    void el.offsetWidth;
    el.classList.add(creatorStyles.sheetFlash);
    const cleanup = () => el.classList.remove(creatorStyles.sheetFlash);
    el.addEventListener("animationend", cleanup, { once: true });
    return () => el.removeEventListener("animationend", cleanup);
  }, [createFlashCount]);

  useEffect(() => {
    if (editFlashCount === 0) return;
    const el = editCreatorRef.current;
    if (!el) return;
    el.classList.remove(creatorStyles.sheetFlash);
    void el.offsetWidth;
    el.classList.add(creatorStyles.sheetFlash);
    const cleanup = () => el.classList.remove(creatorStyles.sheetFlash);
    el.addEventListener("animationend", cleanup, { once: true });
    return () => el.removeEventListener("animationend", cleanup);
  }, [editFlashCount]);

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const canMutateChangeOrders = canDo(capabilities, "change_orders", "create");
  const canSendChangeOrders = canDo(capabilities, "change_orders", "send");
  const canApproveChangeOrders = canDo(capabilities, "change_orders", "approve");
  const scopedProjectId = scopedProjectIdProp;
  const initialOriginEstimateId = initialOriginEstimateIdProp;
  const selectedChangeOrder =
    changeOrders.find((row) => String(row.id) === selectedChangeOrderId) ?? null;
  const selectedViewerEstimate =
    projectEstimates.find((estimate) => String(estimate.id) === selectedViewerEstimateId) ?? null;
  const selectedViewerEstimateBaselineStatus = financialBaselineStatus(selectedViewerEstimate);
  const sortChangeOrdersForViewer = useCallback((rows: ChangeOrderRecord[]) => {
    return [...rows].sort((left, right) => {
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
      const revisionDelta = Number(left.revision_number) - Number(right.revision_number);
      if (revisionDelta !== 0) {
        return revisionDelta;
      }
      return left.id - right.id;
    });
  }, []);
  const viewerChangeOrders = useMemo(() => {
    if (!selectedViewerEstimateId) {
      return [] as ChangeOrderRecord[];
    }
    const originEstimateId = Number(selectedViewerEstimateId);
    return sortChangeOrdersForViewer(
      changeOrders.filter((changeOrder) => changeOrder.origin_estimate === originEstimateId),
    );
  }, [changeOrders, selectedViewerEstimateId, sortChangeOrdersForViewer]);
  const { page: coPage, totalPages: coTotalPages, totalCount: coTotalCount, paginatedItems: paginatedChangeOrders, setPage: setCoPage } = useClientPagination(viewerChangeOrders);
  const selectedViewerChangeOrder =
    viewerChangeOrders.find((changeOrder) => String(changeOrder.id) === selectedChangeOrderId) ??
    viewerChangeOrders[0] ??
    null;
  const selectedViewerEstimateRecordId = selectedViewerEstimate?.id ?? null;
  const selectedViewerChangeOrderIdValue = selectedViewerChangeOrder?.id ?? null;
  const selectedViewerChangeOrderLineDelta = selectedViewerChangeOrder
    ? parseAmount(selectedViewerChangeOrder.line_total_delta || selectedViewerChangeOrder.amount_delta)
    : 0;
  const selectedViewerChangeOrderIsApproved = Boolean(
    selectedViewerChangeOrder && ["approved", "accepted"].includes(selectedViewerChangeOrder.status),
  );
  const senderBranding = resolveOrganizationBranding(organizationDefaults);
  const senderName = senderBranding.senderDisplayName;
  const senderEmail = senderBranding.helpEmail;
  const senderAddressLines = senderBranding.senderAddressLines;
  const senderLogoUrl = senderBranding.logoUrl;
  const defaultChangeOrderReason = "";
  const defaultChangeOrderTerms = (organizationDefaults?.change_order_terms_and_conditions || "").trim();
  const newLineDeltaTotal = useMemo(
    () =>
      newLineItems.reduce((sum, line) => sum + parseAmount(line.amountDelta), 0),
    [newLineItems],
  );
  const newLineValidation = useMemo(() => validateLineItems(newLineItems), [newLineItems]);
  const editLineDeltaTotal = useMemo(
    () =>
      editLineItems.reduce((sum, line) => sum + parseAmount(line.amountDelta), 0),
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
  const budgetLineById = useMemo(() => {
    const map = new Map<string, BudgetLineRecord>();
    for (const line of budgetLines) {
      map.set(String(line.id), line);
    }
    return map;
  }, [budgetLines]);
  const quickStatusOptions = useMemo(() => {
    if (!selectedViewerChangeOrder) {
      return [] as string[];
    }
    const base = [...(changeOrderAllowedTransitions[selectedViewerChangeOrder.status] ?? [])];
    const allowResend = selectedViewerChangeOrder.status === "pending_approval";
    if (allowResend && !base.includes(selectedViewerChangeOrder.status)) {
      base.unshift(selectedViewerChangeOrder.status);
    }
    return base.filter((status) => {
      if (status === "pending_approval") return canSendChangeOrders;
      if (status === "approved") return canApproveChangeOrders;
      return true;
    });
  }, [changeOrderAllowedTransitions, selectedViewerChangeOrder, canSendChangeOrders, canApproveChangeOrders]);
  const isCreateSubmitDisabled =
    !canMutateChangeOrders ||
    !selectedProjectId ||
    !selectedViewerEstimateId ||
    newLineValidation.issues.length > 0;
  const isSelectedChangeOrderDraft = selectedChangeOrder?.status === "draft";
  const isSelectedChangeOrderEditable =
    canMutateChangeOrders &&
    Boolean(selectedChangeOrderId) &&
    Boolean(selectedChangeOrder?.is_latest_revision) &&
    isSelectedChangeOrderDraft;
  const workspaceContext = selectedChangeOrder
    ? `${coLabel(selectedChangeOrder)} · ${selectedChangeOrder.title || "Untitled"}`
    : "New change order draft";
  const workspaceBadgeLabel = !selectedChangeOrder
    ? "CREATING"
    : isSelectedChangeOrderEditable
      ? "EDITING"
      : "READ-ONLY";
  const workspaceBadgeClass = !selectedChangeOrder
    ? styles.editStatusDraft
    : isSelectedChangeOrderEditable
      ? styles.editStatusDraft
      : editStatusBadgeClass(selectedChangeOrder.status);
  const isEditSubmitDisabled =
    !isSelectedChangeOrderEditable ||
    editLineValidation.issues.length > 0;
  const currentAcceptedTotal = selectedViewerEstimate
    ? currentApprovedBudgetTotalForEstimate(selectedViewerEstimate.id)
    : null;
  const originalEstimateTotal = selectedViewerEstimate
    ? originalBudgetTotalForEstimate(selectedViewerEstimate.id)
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
  const selectedViewerWorkingTotals = (() => {
    if (!selectedViewerEstimateRecordId || !selectedViewerChangeOrderIdValue) {
      return { preApproval: "0.00", postApproval: "0.00" };
    }
    const approvedRollingDelta = changeOrders.reduce((sum, changeOrder) => {
      if (
        changeOrder.origin_estimate !== selectedViewerEstimateRecordId ||
        !["approved", "accepted"].includes(changeOrder.status)
      ) {
        return sum;
      }
      return sum + parseAmount(changeOrder.amount_delta);
    }, 0);
    const originalBudgetTotal = originEstimateOriginalTotals[selectedViewerEstimateRecordId] ?? 0;
    const currentApprovedWorkingTotal = originalBudgetTotal + approvedRollingDelta;
    const preApprovalTotal = selectedViewerChangeOrderIsApproved
      ? currentApprovedWorkingTotal - selectedViewerChangeOrderLineDelta
      : currentApprovedWorkingTotal;
    const postApprovalTotal = preApprovalTotal + selectedViewerChangeOrderLineDelta;
    return {
      preApproval: formatDecimal(preApprovalTotal),
      postApproval: formatDecimal(postApprovalTotal),
    };
  })();

  // -------------------------------------------------------------------------
  // Display helpers
  // -------------------------------------------------------------------------

  /** Resolve a status value to its human-readable label. */
  function statusLabel(status: string): string {
    const label = changeOrderStatusLabels[status];
    if (label) {
      return label;
    }
    return status
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }


  const setFeedback = useCallback((message: string, tone: "error" | "success" | "info" = "info") => {
    setActionMessage(message);
    setActionTone(tone);
  }, []);

  /** Look up the original approved budget amount for a given budget line. */
  function originalApprovedAmountForLine(budgetLineId: string): string {
    const line = budgetLineById.get(budgetLineId);
    if (!line) {
      return "0.00";
    }
    return line.budget_amount;
  }

  /** Look up the cumulative approved CO delta for a given budget line. */
  function approvedChangeOrderDeltaForLine(budgetLineId: string): string {
    const line = budgetLineById.get(budgetLineId);
    if (!line) {
      return "0.00";
    }
    return line.approved_change_order_delta ?? "0.00";
  }

  /** Look up the current working budget amount for a given budget line. */
  function currentWorkingAmountForLine(budgetLineId: string): string {
    const line = budgetLineById.get(budgetLineId);
    if (!line) {
      return "0.00";
    }
    return line.current_working_amount ?? line.budget_amount;
  }

  function quickStatusToneClass(status: string): string {
    const key = `quickStatus${status
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`;
    return styles[key] ?? "";
  }

  function quickStatusControlLabel(status: string, currentStatus?: string): string {
    if (status === "pending_approval" || status === "sent") {
      return currentStatus === status ? "Re-send" : "Send";
    }
    if (status === "void") {
      return "Void";
    }
    if (status === "approved" || status === "accepted") {
      return "Approved";
    }
    if (status === "rejected") {
      return "Rejected";
    }
    if (status === "draft") {
      return "Draft";
    }
    return statusLabel(status);
  }

  function editStatusBadgeClass(status: string): string {
    const key = `editStatus${status
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`;
    return styles[key] ?? styles.editStatusDraft;
  }

  /** Format an ISO datetime string into a short human-readable date+time. */
  function formatEventDateTime(dateValue: string): string {
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) {
      return "unknown";
    }
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(parsed);
  }

  /** Derive a display name for the actor of an audit event. */
  function eventActorLabel(event: AuditEventRecord): string {
    const actorDisplay = (event.created_by_display || "").trim();
    if (actorDisplay) {
      return actorDisplay;
    }
    const actorEmail = (event.created_by_email || "").trim();
    if (actorEmail) {
      return actorEmail;
    }
    if (Number.isFinite(event.created_by)) {
      return `user #${event.created_by}`;
    }
    return "unknown user";
  }

  /** Build a link to the customer record if the actor was a customer. */
  function eventActorHref(event: AuditEventRecord): string | null {
    const actorCustomerId = Number(event.created_by_customer_id);
    if (Number.isInteger(actorCustomerId) && actorCustomerId > 0) {
      return `/customers?customer=${actorCustomerId}`;
    }
    return null;
  }

  /** Render the actor label, optionally as a customer link. */
  function renderEventActor(event: AuditEventRecord) {
    const label = eventActorLabel(event);
    const href = eventActorHref(event);
    if (!href) {
      return label;
    }
    return (
      <Link href={href} className={styles.eventActorLink}>
        {label}
      </Link>
    );
  }

  /** Sum approved CO deltas for a given origin estimate. */
  function approvedRollingDeltaForEstimate(estimateId: number): string {
    const total = changeOrders.reduce((sum, changeOrder) => {
      if (
        changeOrder.origin_estimate !== estimateId ||
        !["approved", "accepted"].includes(changeOrder.status)
      ) {
        return sum;
      }
      return sum + parseAmount(changeOrder.amount_delta);
    }, 0);
    return formatDecimal(total);
  }

  function originalBudgetTotalForEstimate(estimateId: number): string {
    return formatDecimal(originEstimateOriginalTotals[estimateId] ?? 0);
  }

  function currentApprovedBudgetTotalForEstimate(estimateId: number): string {
    return formatDecimal(
      parseAmount(originalBudgetTotalForEstimate(estimateId)) + parseAmount(approvedRollingDeltaForEstimate(estimateId)),
    );
  }

  function statusEventLabel(status: string): string {
    if (!status) {
      return "Unset";
    }
    return statusLabel(status);
  }

  /** Derive a past-tense action label from a status audit event. */
  function statusEventActionLabel(event: AuditEventRecord): string {
    const fromStatus = event.from_status || "";
    const toStatus = event.to_status || "";
    const statusAction = String(event.metadata_json?.status_action || "").toLowerCase();
    if (statusAction === "notate") {
      return "Notated";
    }
    if (statusAction === "resend") {
      return "Re-sent";
    }
    if (!fromStatus && toStatus === "draft") {
      return "Created";
    }
    if (fromStatus === toStatus && (event.note || "").trim()) {
      return "Notated";
    }
    if (fromStatus === "pending_approval" && toStatus === "pending_approval") {
      return "Re-sent";
    }
    if (fromStatus === "draft" && toStatus === "pending_approval") {
      return "Sent";
    }
    if (toStatus === "approved" || toStatus === "accepted") {
      return "Approved";
    }
    if (toStatus === "rejected") {
      return "Rejected";
    }
    if (toStatus === "void") {
      return "Voided";
    }
    if (toStatus === "draft" && fromStatus) {
      return "Returned to Draft";
    }
    return `${statusEventLabel(fromStatus)} -> ${statusEventLabel(toStatus)}`;
  }

  function statusEventActionClass(event: AuditEventRecord): string {
    const toStatus = event.to_status || "";
    const fromStatus = event.from_status || "";
    const statusAction = String(event.metadata_json?.status_action || "").toLowerCase();
    if (statusAction === "notate") {
      return styles.statusEventNeutral;
    }
    if (statusAction === "resend") {
      return styles.statusEventSent;
    }
    if (!fromStatus && toStatus === "draft") {
      return styles.statusEventCreated;
    }
    if (fromStatus === toStatus && (event.note || "").trim()) {
      return styles.statusEventNeutral;
    }
    if (fromStatus === "pending_approval" && toStatus === "pending_approval") {
      return styles.statusEventSent;
    }
    if (fromStatus === "draft" && toStatus === "pending_approval") {
      return styles.statusEventSent;
    }
    if (toStatus === "approved" || toStatus === "accepted") {
      return styles.statusEventApproved;
    }
    if (toStatus === "rejected") {
      return styles.statusEventRejected;
    }
    if (toStatus === "void") {
      return styles.statusEventVoid;
    }
    if (toStatus === "draft" && fromStatus) {
      return styles.statusEventReturnedDraft;
    }
    return styles.statusEventNeutral;
  }

  function viewerHistoryStatusClass(status: string): string {
    const key = `viewerHistory${status
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`;
    return styles[key] ?? "";
  }

  function lastStatusEventForChangeOrder(changeOrderId: number): AuditEventRecord | null {
    const events = projectAuditEvents
      .filter((event) =>
        event.event_type === "change_order_updated" &&
        event.object_type === "change_order" &&
        event.object_id === changeOrderId &&
        (Boolean(event.from_status) || Boolean(event.to_status)))
      .sort((left, right) => {
        const leftTime = Date.parse(left.created_at);
        const rightTime = Date.parse(right.created_at);
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
          return rightTime - leftTime;
        }
        return right.id - left.id;
      });
    return events[0] ?? null;
  }

  function formatApprovedDate(dateValue: string | null): string {
    if (!dateValue) {
      return "unknown date";
    }
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) {
      return "unknown date";
    }
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(parsed);
  }

  function approvalMeta(estimate: OriginEstimateRecord): string {
    const dateLabel = formatApprovedDate(estimate.approved_at);
    if (estimate.approved_by_email) {
      return `approved on ${dateLabel} by ${estimate.approved_by_email}`;
    }
    return `approved on ${dateLabel}`;
  }

  // -------------------------------------------------------------------------
  // Data loading & form hydration
  // -------------------------------------------------------------------------

  const hydrateEditForm = useCallback((changeOrder: ChangeOrderRecord | undefined) => {
    if (!changeOrder) {
      setSelectedChangeOrderId("");
      setEditTitle("");
      setEditReason("");
      setEditTermsText("");
      setEditLineItems([emptyLine(1)]);
      setEditLineNextLocalId(2);
      setQuickStatus("");
      setQuickStatusNote("");
      return;
    }

    setSelectedChangeOrderId(String(changeOrder.id));
    setFeedback("");
    setEditTitle(changeOrder.title);
    setEditReason(changeOrder.reason);
    setEditTermsText(changeOrder.terms_text || "");
    const hydratedLines: ChangeOrderLineInput[] =
      changeOrder.line_items.length > 0
        ? changeOrder.line_items.map((line, index) => ({
            localId: index + 1,
            lineType: (line.line_type === "new" ? "new" : "original") as "original" | "new",
            adjustmentReason: line.adjustment_reason ?? "",
            budgetLineId: line.budget_line ? String(line.budget_line) : "",
            costCodeId: line.cost_code_id ? String(line.cost_code_id) : "",
            description: line.description ?? "",
            amountDelta: line.amount_delta,
            daysDelta: String(line.days_delta),
          }))
        : [emptyLine(1)];
    setEditLineItems(hydratedLines);
    const maxLocalId = hydratedLines.reduce((maxId, line) => Math.max(maxId, line.localId), 1);
    setEditLineNextLocalId(maxLocalId + 1);
    if (changeOrder.origin_estimate) {
      setSelectedViewerEstimateId(String(changeOrder.origin_estimate));
    }
    setQuickStatus("");
    setQuickStatusNote("");
    setShowAllEvents(false);
  }, [changeOrderAllowedTransitions, setFeedback]);

  const loadBudgetLines = useCallback(async (projectId: number, sourceEstimateId?: number | null) => {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/budgets/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setBudgetLines([]);
        return [] as BudgetLineRecord[];
      }
      const budgets =
        (payload.data as Array<{
          status: string;
          source_estimate?: number | null;
          line_items: BudgetLineRecord[];
        }>) ?? [];
      const nextTotals: Record<number, number> = {};
      for (const budget of budgets) {
        const sourceEstimateId = Number(budget.source_estimate);
        if (!Number.isFinite(sourceEstimateId) || sourceEstimateId <= 0) {
          continue;
        }
        nextTotals[sourceEstimateId] = budget.line_items.reduce(
          (sum, line) => sum + parseAmount(line.budget_amount),
          0,
        );
      }
      setOriginEstimateOriginalTotals(nextTotals);
      const byOriginEstimate =
        sourceEstimateId != null
          ? budgets.find((budget) => Number(budget.source_estimate) === sourceEstimateId)
          : null;
      const activeBudget = budgets.find((budget) => budget.status === "active") ?? budgets[0];
      const selectedBudget = byOriginEstimate ?? activeBudget;
      const nextLines = selectedBudget?.line_items ?? [];
      setBudgetLines(nextLines);
      return nextLines;
    } catch {
      setBudgetLines([]);
      setOriginEstimateOriginalTotals({});
      return [] as BudgetLineRecord[];
    }
  }, [normalizedBaseUrl, token]);

  const loadProjectEstimates = useCallback(async (projectId: number) => {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setProjectEstimates([]);
        return;
      }
      const rows =
        (payload.data as Array<{
          id: number;
          title: string;
          version: number;
          status?: string;
          financial_baseline_status?: "none" | "active" | "superseded";
          is_active_financial_baseline?: boolean;
        }>) ?? [];
      const approvedRows = rows.filter((estimate) => estimate.status === "approved");
      const approvedRowsWithMeta = await Promise.all(
        approvedRows.map(async (estimate) => {
          try {
            const response = await fetch(
              `${normalizedBaseUrl}/estimates/${estimate.id}/status-events/`,
              {
                headers: buildAuthHeaders(token),
              },
            );
            const payload: ApiResponse = await response.json();
            if (!response.ok) {
              return {
                ...estimate,
                approved_at: null,
                approved_by_email: null,
              };
            }
            const events =
              (payload.data as Array<{
                to_status?: string;
                changed_at?: string;
                changed_by_email?: string;
              }>) ?? [];
            const approvedEvent = [...events]
              .reverse()
              .find((event) => event.to_status === "approved");
            return {
              ...estimate,
              approved_at: approvedEvent?.changed_at ?? null,
              approved_by_email: approvedEvent?.changed_by_email ?? null,
            };
          } catch {
            return {
              ...estimate,
              approved_at: null,
              approved_by_email: null,
            };
          }
        }),
      );
      const preferredEstimateId =
        initialOriginEstimateId &&
        approvedRowsWithMeta.some((estimate) => estimate.id === initialOriginEstimateId)
          ? String(initialOriginEstimateId)
          : "";
      setProjectEstimates(approvedRowsWithMeta);
      setSelectedViewerEstimateId((current) => {
        if (preferredEstimateId) {
          return preferredEstimateId;
        }
        if (current && approvedRowsWithMeta.some((estimate) => String(estimate.id) === current)) {
          return current;
        }
        return approvedRowsWithMeta[0] ? String(approvedRowsWithMeta[0].id) : "";
      });
    } catch {
      setProjectEstimates([]);
      setSelectedViewerEstimateId("");
    }
  }, [initialOriginEstimateId, normalizedBaseUrl, token]);

  const loadProjectAuditEvents = useCallback(async (projectId: number) => {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/audit-events/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setProjectAuditEvents([]);
        return;
      }
      const rows =
        (payload.data as Array<{
          id: number;
          event_type: string;
          object_type: string;
          object_id: number;
          from_status: string;
          to_status: string;
          note: string;
          metadata_json?: Record<string, unknown> | null;
          created_by: number;
          created_by_email: string | null;
          created_by_display?: string | null;
          created_by_customer_id?: number | null;
          created_at: string;
        }>) ?? [];
      setProjectAuditEvents(rows);
    } catch {
      setProjectAuditEvents([]);
    }
  }, [normalizedBaseUrl, token]);

  const loadCostCodes = useCallback(async () => {
    try {
      const response = await fetch(`${normalizedBaseUrl}/cost-codes/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setCostCodes([]);
        return;
      }
      const rows = ((payload.data as CostCodeOption[]) ?? []).filter((c) => c.is_active);
      setCostCodes(rows);
    } catch {
      setCostCodes([]);
    }
  }, [normalizedBaseUrl, token]);

  const prefillNewLinesFromBudgetLines = useCallback((lines: BudgetLineRecord[]) => {
    if (!lines.length) {
      setNewLineItems([emptyLine(1)]);
      setNewLineNextLocalId(2);
      return;
    }
    const estimateDerivedLines = lines.filter(
      (line) => line.scope_item !== null && line.scope_item !== undefined,
    );
    const starterLines = estimateDerivedLines.length
      ? estimateDerivedLines
      : lines.filter((line) => !line.description.startsWith("System:"));
    if (!starterLines.length) {
      setNewLineItems([emptyLine(1)]);
      setNewLineNextLocalId(2);
      return;
    }
    const mapped: ChangeOrderLineInput[] = starterLines.map((line, index) => ({
      localId: index + 1,
      lineType: "original",
      adjustmentReason: "",
      budgetLineId: String(line.id),
      costCodeId: "",
      description: line.description || "",
      amountDelta: "0.00",
      daysDelta: "0",
    }));
    setNewLineItems(mapped);
    setNewLineNextLocalId(mapped.length + 1);
  }, []);

  const fetchProjectChangeOrders = useCallback(async (projectId: number) => {
    const response = await fetch(
      `${normalizedBaseUrl}/projects/${projectId}/change-orders/`,
      {
        headers: buildAuthHeaders(token),
      },
    );
    const payload: ApiResponse = await response.json();
    if (!response.ok) {
      return {
        rows: null as ChangeOrderRecord[] | null,
        error: readChangeOrderApiError(payload, "Could not load change orders."),
      };
    }
    return { rows: (payload.data as ChangeOrderRecord[]) ?? [], error: "" };
  }, [normalizedBaseUrl, token]);

  const loadOrganizationDefaults = useCallback(async () => {
    if (!token) {
      return;
    }
    try {
      const response = await fetch(`${normalizedBaseUrl}/organization/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        return;
      }
      const organizationData = (
        payload.data as { organization?: OrganizationDocumentDefaults } | undefined
      )?.organization;
      if (organizationData) {
        setOrganizationDefaults(organizationData);
        setNewTermsText((current) => current || organizationData.change_order_terms_and_conditions || "");
      }
    } catch {
      // Branding defaults are best-effort; change order workflows can continue.
    }
  }, [normalizedBaseUrl, token]);

  const loadProjects = useCallback(async () => {
    if (!token) {
      return;
    }
    setFeedback("");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Could not load projects."), "error");
        return;
      }
      const rows = (payload.data as Array<{ id: number; name: string }>) ?? [];
      setNewLineItems([emptyLine(1)]);
      setNewLineNextLocalId(2);
      if (rows[0]) {
        const scopedMatch = scopedProjectId
          ? rows.find((project) => project.id === scopedProjectId)
          : null;
        const nextProject = scopedMatch ?? rows[0];
        const scopeFallbackNote =
          scopedProjectId && !scopedMatch
            ? ` Project #${scopedProjectId} was not found in scope; defaulted to #${nextProject.id}.`
            : "";
        setSelectedProjectId(String(nextProject.id));
        setSelectedProjectName(nextProject.name || "");
        await Promise.all([
          loadBudgetLines(nextProject.id),
          loadProjectEstimates(nextProject.id),
          loadProjectAuditEvents(nextProject.id),
          loadCostCodes(),
        ]);
        const { rows: changeOrderRows, error } = await fetchProjectChangeOrders(nextProject.id);
        if (!changeOrderRows) {
          setChangeOrders([]);
          hydrateEditForm(undefined);
          setFeedback(`${error}${scopeFallbackNote}`, "error");
          return;
        }
        setChangeOrders(changeOrderRows);
        const initialCO = initialOriginEstimateId
          ? changeOrderRows.find((co) => co.origin_estimate === initialOriginEstimateId)
          : changeOrderRows[0];
        hydrateEditForm(initialCO ?? changeOrderRows[0]);
        setFeedback("");
      } else {
        setSelectedProjectId("");
        setSelectedProjectName("");
        setBudgetLines([]);
        setOriginEstimateOriginalTotals({});
        setProjectEstimates([]);
        setProjectAuditEvents([]);
        setChangeOrders([]);
        hydrateEditForm(undefined);
        setFeedback("No projects found.", "info");
      }
    } catch {
      setFeedback("Could not reach projects endpoint.", "error");
    }
  }, [
    fetchProjectChangeOrders,
    hydrateEditForm,
    initialOriginEstimateId,
    loadBudgetLines,
    loadCostCodes,
    loadProjectAuditEvents,
    loadProjectEstimates,
    normalizedBaseUrl,
    scopedProjectId,
    setFeedback,
    token,
  ]);

  // -------------------------------------------------------------------------
  // Effects (data loading)
  // -------------------------------------------------------------------------

  // Fetch projects and related data on auth.
  useEffect(() => {
    if (!token) {
      return;
    }
    const run = window.setTimeout(() => {
      void loadProjects();
    }, 0);
    return () => window.clearTimeout(run);
  }, [loadProjects, token]);

  // Load organization branding defaults for the creator header.
  useEffect(() => {
    if (!token) {
      return;
    }
    const run = window.setTimeout(() => {
      void loadOrganizationDefaults();
    }, 0);
    return () => window.clearTimeout(run);
  }, [loadOrganizationDefaults, token]);

  // Auto-generate the draft title from the project name until the user edits it.
  useEffect(() => {
    if (newTitleManuallyEdited) {
      return;
    }
    const run = window.setTimeout(() => {
      setNewTitle(defaultChangeOrderTitle(selectedProjectName));
    }, 0);
    return () => window.clearTimeout(run);
  }, [newTitleManuallyEdited, selectedProjectName]);

  // Sync the edit form when the selected CO is no longer in the visible set.
  useEffect(() => {
    // Keep "create new" mode sticky when the user intentionally clears selection.
    if (!selectedChangeOrderId) {
      return;
    }
    if (!viewerChangeOrders.length) {
      return;
    }
    const selectedStillVisible = viewerChangeOrders.some(
      (changeOrder) => String(changeOrder.id) === selectedChangeOrderId,
    );
    if (!selectedStillVisible) {
      const run = window.setTimeout(() => {
        hydrateEditForm(viewerChangeOrders[0]);
      }, 0);
      return () => window.clearTimeout(run);
    }
  }, [hydrateEditForm, selectedChangeOrderId, viewerChangeOrders]);

  // Reload budget lines and prefill new-CO starter rows when the origin estimate changes.
  useEffect(() => {
    const projectId = Number(selectedProjectId);
    if (!projectId || !selectedViewerEstimateId || !/^\d+$/.test(selectedViewerEstimateId)) {
      return;
    }
    const sourceEstimateId = Number(selectedViewerEstimateId);
    void (async () => {
      const nextLines = await loadBudgetLines(projectId, sourceEstimateId);
      prefillNewLinesFromBudgetLines(nextLines);
    })();
  }, [loadBudgetLines, prefillNewLinesFromBudgetLines, selectedProjectId, selectedViewerEstimateId]);

  // -------------------------------------------------------------------------
  // Line item handlers
  // -------------------------------------------------------------------------

  /** Convert local line-item state into the API payload shape. */
  function toLinePayload(lines: ChangeOrderLineInput[]) {
    return lines
      .filter((line) =>
        line.lineType === "original" ? line.budgetLineId.trim() !== "" : line.costCodeId.trim() !== "",
      )
      .map((line) => ({
        line_type: line.lineType,
        budget_line: line.lineType === "original" ? Number(line.budgetLineId) : null,
        cost_code: line.lineType === "new" ? Number(line.costCodeId) : null,
        description: line.description,
        adjustment_reason: line.adjustmentReason,
        amount_delta: line.amountDelta,
        days_delta: Number(line.daysDelta),
      }));
  }

  /** Patch a single field on a line item in a given line-item set. */
  function updateLine(
    setter: LineSetter,
    localId: number,
    patch: Partial<ChangeOrderLineInput>,
  ) {
    setter((current) =>
      current.map((line) => (line.localId === localId ? { ...line, ...patch } : line)),
    );
  }

  /** Append a new blank line to the given line-item set. */
  function addLine(
    setter: LineSetter,
    idCounter: number,
    setIdCounter: React.Dispatch<React.SetStateAction<number>>,
  ) {
    if (actionTone === "error" && actionMessage === CHANGE_ORDER_MIN_LINE_ITEMS_ERROR) {
      setFeedback("");
    }
    const localId = idCounter;
    setIdCounter((current) => current + 1);
    setter((current) => [...current, emptyLine(localId)]);
  }

  /** Remove a line item, enforcing the minimum of one line. */
  function removeLine(
    setter: LineSetter,
    lines: ChangeOrderLineInput[],
    localId: number,
  ) {
    if (lines.length <= 1) {
      setFeedback(CHANGE_ORDER_MIN_LINE_ITEMS_ERROR, "error");
      return;
    }
    setter((current) => current.filter((line) => line.localId !== localId));
  }

  // -------------------------------------------------------------------------
  // Submit & mutation handlers
  // -------------------------------------------------------------------------

  /** Reset the workspace to a fresh "new change order" draft. */
  function handleStartNewChangeOrder() {
    hydrateEditForm(undefined);
    setNewTitleManuallyEdited(false);
    setNewTitle(defaultChangeOrderTitle(selectedProjectName));
    setNewReason(defaultChangeOrderReason);
    setNewTermsText(defaultChangeOrderTerms);
    if (budgetLines.length > 0) {
      prefillNewLinesFromBudgetLines(budgetLines);
    } else {
      setNewLineItems([emptyLine(1)]);
      setNewLineNextLocalId(2);
    }
    setFeedback("Ready for a new change order draft.", "info");
    setCreateFlashCount((c) => c + 1);
  }

  /** Handle form submission for creating a new change order draft. */
  async function handleCreateChangeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateChangeOrders) {
      setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setFeedback("Select a project first.", "error");
      return;
    }

    setFeedback("");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/change-orders/`,
        {
          method: "POST",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({
            title: newTitle,
            reason: newReason,
            terms_text: newTermsText,
            amount_delta: formatDecimal(newLineDeltaTotal),
            days_delta: newLineDaysTotal,
            origin_estimate: selectedViewerEstimateId ? Number(selectedViewerEstimateId) : null,
            line_items: toLinePayload(newLineItems),
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Create change order failed."), "error");
        return;
      }
      const created = payload.data as ChangeOrderRecord;

      const { rows } = await fetchProjectChangeOrders(projectId);

      if (rows) {
        setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === created.id);
        hydrateEditForm(persisted ?? created);
        await loadProjectAuditEvents(projectId);
      } else {
        setChangeOrders((current) => [created, ...current]);
        hydrateEditForm(created);
        await loadProjectAuditEvents(projectId);
      }
      setFeedback(`Created change order #${created.id}.`, "success");
      setNewLineItems([emptyLine(1)]);
      setNewLineNextLocalId(2);
      setNewTitleManuallyEdited(false);
      setNewTitle(defaultChangeOrderTitle(selectedProjectName));
      setNewReason(defaultChangeOrderReason);
      setNewTermsText(defaultChangeOrderTerms);
      setCreateFlashCount((c) => c + 1);
    } catch {
      setFeedback("Could not reach change order create endpoint.", "error");
    }
  }

  /** Clone the selected change order as a new draft revision. */
  async function handleCloneRevision() {
    if (!canMutateChangeOrders) {
      setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const changeOrderId = Number(selectedChangeOrderId);
    if (!changeOrderId) {
      setFeedback("Select a change order first.", "error");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setFeedback("Select a project first.", "error");
      return;
    }

    setFeedback("");
    try {
      const response = await fetch(`${normalizedBaseUrl}/change-orders/${changeOrderId}/clone-revision/`, {
        method: "POST",
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Clone revision failed."), "error");
        return;
      }
      const created = payload.data as ChangeOrderRecord;
      const { rows } = await fetchProjectChangeOrders(projectId);

      if (rows) {
        setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === created.id);
        hydrateEditForm(persisted ?? created);
        await loadProjectAuditEvents(projectId);
      }
      setFeedback(`Duplicated as ${coLabel(created)}.`, "success");
      setEditFlashCount((c) => c + 1);
    } catch {
      setFeedback("Could not reach clone revision endpoint.", "error");
    }
  }

  /** Handle form submission for saving edits to an existing draft change order. */
  async function handleUpdateChangeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateChangeOrders) {
      setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const changeOrderId = Number(selectedChangeOrderId);
    if (!changeOrderId) {
      setFeedback("Select a change order first.", "error");
      return;
    }
    if (!selectedChangeOrder) {
      setFeedback("Selected change order could not be resolved.", "error");
      return;
    }

    setFeedback("");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/change-orders/${changeOrderId}/`,
        {
          method: "PATCH",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({
            title: editTitle,
            reason: editReason,
            terms_text: editTermsText,
            amount_delta: formatDecimal(editLineDeltaTotal),
            days_delta: editLineDaysTotal,
            status: selectedChangeOrder.status,
            line_items: toLinePayload(editLineItems),
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Save change order failed."), "error");
        return;
      }
      const updated = payload.data as ChangeOrderRecord;
      const projectId = Number(selectedProjectId);
      const { rows } = await fetchProjectChangeOrders(projectId);
      if (rows) {
        setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === updated.id);
        hydrateEditForm(persisted ?? updated);
        await loadProjectAuditEvents(projectId);
        setFeedback(`Saved change order ${coLabel(updated)} (${statusLabel(updated.status)}).`, "success");
      } else {
        setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        hydrateEditForm(updated);
        await loadProjectAuditEvents(projectId);
        setFeedback(`Saved change order ${coLabel(updated)} (${statusLabel(updated.status)}).`, "success");
      }
    } catch {
      setFeedback("Could not reach change order detail endpoint.", "error");
    }
  }

  /** Apply a quick status transition (or resend) to the selected viewer change order. */
  async function handleQuickUpdateStatus() {
    if (!canMutateChangeOrders) {
      setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!selectedViewerChangeOrder || !quickStatus) {
      setFeedback("Select a change order and next status first.", "error");
      return;
    }
    if (!projectId) {
      setFeedback("Select a project first.", "error");
      return;
    }

    const isResend =
      selectedViewerChangeOrder.status === quickStatus && quickStatus === "pending_approval";
    setFeedback("");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/change-orders/${selectedViewerChangeOrder.id}/`,
        {
          method: "PATCH",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({ status: quickStatus, status_note: quickStatusNote }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Status update failed."), "error");
        return;
      }
      const updated = payload.data as ChangeOrderRecord;
      const { rows } = await fetchProjectChangeOrders(projectId);
      if (rows) {
        setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === updated.id);
        hydrateEditForm(persisted ?? updated);
        await loadProjectAuditEvents(projectId);
      } else {
        setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        hydrateEditForm(updated);
        await loadProjectAuditEvents(projectId);
      }
      if (isResend) {
        setFeedback(`Re-sent ${coLabel(updated)} for approval. History updated.`, "success");
      } else {
        setFeedback(`Updated ${coLabel(updated)} to ${statusLabel(updated.status)}. History updated.`, "success");
      }
      setQuickStatus("");
      setQuickStatusNote("");
    } catch {
      setFeedback("Could not reach change order detail endpoint.", "error");
    }
  }

  /** Append a status note without changing the change order's current status. */
  async function handleAddChangeOrderStatusNote() {
    if (!canMutateChangeOrders) {
      setFeedback(`Role ${role} is read-only for change order mutations.`, "error");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!selectedViewerChangeOrder) {
      setFeedback("Select a change order first.", "error");
      return;
    }
    if (!projectId) {
      setFeedback("Select a project first.", "error");
      return;
    }
    if (!quickStatusNote.trim()) {
      setFeedback("Enter a status note first.", "error");
      return;
    }

    setFeedback("");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/change-orders/${selectedViewerChangeOrder.id}/`,
        {
          method: "PATCH",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({ status_note: quickStatusNote }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readChangeOrderApiError(payload, "Status note update failed."), "error");
        return;
      }
      const updated = payload.data as ChangeOrderRecord;
      const { rows } = await fetchProjectChangeOrders(projectId);
      if (rows) {
        setChangeOrders(rows);
        const persisted = rows.find((row) => row.id === updated.id);
        hydrateEditForm(persisted ?? updated);
        await loadProjectAuditEvents(projectId);
      } else {
        setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        hydrateEditForm(updated);
        await loadProjectAuditEvents(projectId);
      }
      setQuickStatusNote("");
      setFeedback(`Added status note on ${coLabel(updated)}. History updated.`, "success");
    } catch {
      setFeedback("Could not reach change order detail endpoint.", "error");
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section>
      {actionMessage && actionTone !== "success" ? (
        <p
          className={
            actionTone === "error"
              ? creatorStyles.actionError
              : creatorStyles.inlineHint
          }
        >
          {actionMessage}
        </p>
      ) : null}
      {!canMutateChangeOrders ? (
        <p className={styles.roleReadOnlyNote}>
          Role `{role}` can view change orders but cannot create or update.
        </p>
      ) : null}

      <section className={styles.viewer}>
        <div className={styles.viewerHeader}>
          <div className={styles.viewerHeaderRow}>
            <h3>{selectedProjectName ? `Change Orders for: ${selectedProjectName}` : "Change Orders"}</h3>
            <button
              type="button"
              className={collapseButtonStyles.collapseButton}
              style={{ background: "var(--surface)" }}
              onClick={() => setIsViewerExpanded((current) => !current)}
              aria-expanded={isViewerExpanded}
            >
              {isViewerExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
          <p>
            Select an estimate to view its change orders.
          </p>
        </div>
        {isViewerExpanded ? (projectEstimates.length > 0 ? (
          <div className={styles.viewerGrid}>
            <div className={styles.viewerRail}>
              <div className={styles.viewerRailHeader}>
                <span className={styles.viewerRailHeading}>Approved Estimates</span>
              </div>
              {projectEstimates.map((estimate) => {
                const active = String(estimate.id) === selectedViewerEstimateId;
                const baselineStatus = financialBaselineStatus(estimate);
                const relatedCount = changeOrders.filter(
                  (changeOrder) => changeOrder.origin_estimate === estimate.id,
                ).length;
                return (
                  <div key={estimate.id} className={styles.viewerRailEntry}>
                    <button
                      type="button"
                      className={`${styles.viewerRailItem} ${active ? styles.viewerRailItemActive : ""} ${baselineStatus === "active" ? styles.viewerRailItemActiveBaseline : ""}`}
                      onClick={() => {
                        const nextEstimateId = String(estimate.id);
                        setSelectedViewerEstimateId(nextEstimateId);
                        const related = sortChangeOrdersForViewer(
                          changeOrders.filter(
                            (changeOrder) => String(changeOrder.origin_estimate) === nextEstimateId,
                          ),
                        );
                        if (!related.length) {
                          hydrateEditForm(undefined);
                          return;
                        }
                        const selectedStillValid = related.some(
                          (changeOrder) => String(changeOrder.id) === selectedChangeOrderId,
                        );
                        if (!selectedStillValid) {
                          hydrateEditForm(related[0]);
                        }
                      }}
                    >
                      <span className={styles.viewerRailTitle}>
                        {estimate.title}
                        <span className={styles.viewerRailVersion}>
                          Estimate #{estimate.id} · {relatedCount} COs
                        </span>
                      </span>
                      {baselineStatus !== "none" ? (
                        <span
                          className={`${changeOrderCreatorStyles.viewerBaselineBadge} ${
                            baselineStatus === "active"
                              ? changeOrderCreatorStyles.viewerBaselineBadgeActive
                              : changeOrderCreatorStyles.viewerBaselineBadgeSuperseded
                          }`}
                        >
                          {formatFinancialBaselineStatus(baselineStatus)}
                        </span>
                      ) : null}
                      <span className={styles.viewerRailSubtext}>
                        {approvalMeta(estimate)}
                      </span>
                      <span className={styles.viewerRailMetrics}>
                        <span className={styles.viewerMetricCurrent}>
                          Current ${currentApprovedBudgetTotalForEstimate(estimate.id)}
                        </span>
                        {" · "}
                        <span className={styles.viewerMetricOriginal}>
                          Original ${originalBudgetTotalForEstimate(estimate.id)}
                        </span>
                        {" · "}
                        <span className={styles.viewerMetricDelta}>
                          CO Delta ${approvedRollingDeltaForEstimate(estimate.id)}
                        </span>
                      </span>
                    </button>
                    {selectedProjectId ? (
                      <Link
                        href={`/projects/${selectedProjectId}/estimates?estimate=${estimate.id}`}
                        className={styles.viewerCardLink}
                      >
                        Open Original Estimate ↗
                      </Link>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {selectedViewerEstimate ? (
              <div className={styles.viewerDetail}>
                {viewerChangeOrders.length > 0 ? (
                  <>
                    <h4 className={styles.viewerSectionHeading}>Change Orders</h4>
                    <div className={`${styles.viewerRail} ${styles.viewerHistoryRail}`}>
                      {paginatedChangeOrders.map((changeOrder) => {
                        const active = String(changeOrder.id) === selectedChangeOrderId;
                        const lastStatusEvent = lastStatusEventForChangeOrder(changeOrder.id);
                        return (
                          <div
                            key={changeOrder.id}
                            role="button"
                            tabIndex={0}
                            className={`${styles.viewerRailItem} ${styles.viewerHistoryItem} ${viewerHistoryStatusClass(changeOrder.status)} ${
                              active ? `${styles.viewerRailItemActive} ${styles.viewerHistoryItemActive}` : ""
                            }`}
                            onClick={() => hydrateEditForm(changeOrder)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hydrateEditForm(changeOrder); } }}
                          >
                            {changeOrder.public_ref ? (
                              <div className={styles.viewerCardPublicBar}>
                                <Link
                                  href={publicChangeOrderHref(changeOrder.public_ref)}
                                  className={styles.viewerCardPublicLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`Open customer view for ${coLabel(changeOrder)}`}
                                  title="Open customer view"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Customer View ↗
                                </Link>
                              </div>
                            ) : null}
                            <span className={styles.viewerRailTitle}>
                              {changeOrder.title || "Untitled"} · {coLabel(changeOrder)}
                            </span>
                            <span className={styles.viewerHistoryStatusText}>{statusLabel(changeOrder.status)}</span>
                            <span
                              className={`${styles.viewerHistoryMetaText} ${styles.viewerHistoryLineDelta} ${
                                ["approved", "accepted"].includes(changeOrder.status)
                                  ? styles.viewerHistoryLineDeltaApproved
                                  : ""
                              }`}
                            >
                              Line delta: ${changeOrder.line_total_delta}
                            </span>
                            {lastStatusEvent ? (
                              <span className={styles.viewerHistoryMetaText}>
                                Last action: {statusEventActionLabel(lastStatusEvent)} on{" "}
                                {formatEventDateTime(lastStatusEvent.created_at)} by {eventActorLabel(lastStatusEvent)}
                              </span>
                            ) : (
                              <span className={styles.viewerHistoryMetaText}>No status events yet.</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <PaginationControls page={coPage} totalPages={coTotalPages} totalCount={coTotalCount} onPageChange={setCoPage} />
                    {selectedViewerChangeOrder ? (
                      <>
                        {/* Status & Actions section */}
                        <div className={styles.viewerSection}>
                          <button
                            type="button"
                            className={styles.viewerSectionToggle}
                            onClick={() => setIsStatusSectionOpen((v) => !v)}
                            aria-expanded={isStatusSectionOpen}
                          >
                            <h4>Status &amp; Actions</h4>
                            <span className={styles.viewerSectionArrow}>▼</span>
                          </button>
                          {isStatusSectionOpen ? (
                            <div className={styles.viewerSectionContent}>
                              {quickStatusOptions.length > 0 ? (
                                <>
                                  <span className={creatorStyles.lifecycleFieldLabel}>Next status</span>
                                  <div className={styles.quickStatusPills}>
                                    {quickStatusOptions.map((status) => {
                                      const isSelected = quickStatus === status;
                                      return (
                                        <button
                                          key={status}
                                          type="button"
                                          className={`${styles.quickStatusButton} ${
                                            isSelected
                                              ? `${styles.quickStatusButtonActive} ${quickStatusToneClass(status)}`
                                              : styles.quickStatusButtonInactive
                                          }`}
                                          onClick={() => setQuickStatus(status)}
                                          aria-pressed={isSelected}
                                        >
                                          {quickStatusControlLabel(status, selectedViewerChangeOrder?.status)}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </>
                              ) : null}
                              <label className={creatorStyles.lifecycleField}>
                                Status note
                                <textarea
                                  className={creatorStyles.statusNote}
                                  value={quickStatusNote}
                                  onChange={(event) => setQuickStatusNote(event.target.value)}
                                  placeholder={quickStatusOptions.length > 0 ? "Optional note for this status action." : "Add a note without changing status."}
                                  rows={2}
                                />
                              </label>
                              {actionMessage && actionTone === "success" ? (
                                <p className={creatorStyles.actionSuccess}>{actionMessage}</p>
                              ) : null}
                              {actionMessage && actionTone === "error" ? (
                                <p className={creatorStyles.actionError}>{actionMessage}</p>
                              ) : null}
                              <div className={`${creatorStyles.lifecycleActions} ${styles.viewerStatusActionRow}`}>
                                {quickStatusOptions.length > 0 ? (
                                  <button
                                    type="button"
                                    className={`${styles.viewerStatusActionButton} ${styles.viewerStatusActionButtonPrimary}`}
                                    onClick={handleQuickUpdateStatus}
                                    disabled={!canMutateChangeOrders || !quickStatusOptions.length || !quickStatus}
                                  >
                                    Update CO Status
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className={`${styles.viewerStatusActionButton} ${styles.viewerStatusActionButtonSecondary}`}
                                  onClick={handleAddChangeOrderStatusNote}
                                  disabled={!canMutateChangeOrders || !quickStatusNote.trim()}
                                >
                                  Add CO Status Note
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        {/* History section */}
                        <div className={styles.viewerSection}>
                          <button
                            type="button"
                            className={styles.viewerSectionToggle}
                            onClick={() => setIsHistorySectionOpen((v) => !v)}
                            aria-expanded={isHistorySectionOpen}
                          >
                            <h4>History ({selectedChangeOrderStatusEvents.length})</h4>
                            <span className={styles.viewerSectionArrow}>▼</span>
                          </button>
                          {isHistorySectionOpen ? (
                            <div className={styles.viewerSectionContent}>
                              {selectedChangeOrderStatusEvents.length > 0 ? (
                                <>
                                  <ul className={styles.viewerEventList}>
                                    {(showAllEvents
                                      ? selectedChangeOrderStatusEvents
                                      : selectedChangeOrderStatusEvents.slice(0, 4)
                                    ).map((event) => (
                                      <li key={event.id} className={styles.viewerEventItem}>
                                        <span className={`${styles.viewerEventAction} ${statusEventActionClass(event)}`}>
                                          {statusEventActionLabel(event)}
                                        </span>
                                        <span className={styles.viewerEventMeta}>
                                          {formatEventDateTime(event.created_at)} by {renderEventActor(event)}
                                        </span>
                                        {event.note ? (
                                          <span className={styles.viewerEventNote}>{event.note}</span>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                  {selectedChangeOrderStatusEvents.length > 4 ? (
                                    <button
                                      type="button"
                                      className={styles.showAllToggle}
                                      onClick={() => setShowAllEvents((v) => !v)}
                                    >
                                      {showAllEvents
                                        ? "Show less"
                                        : `Show all ${selectedChangeOrderStatusEvents.length} events`}
                                    </button>
                                  ) : null}
                                </>
                              ) : (
                                <p className={styles.viewerHint}>No status events recorded yet.</p>
                              )}
                            </div>
                          ) : null}
                        </div>

                        {/* Line Items section */}
                        <div className={styles.viewerSection}>
                          <button
                            type="button"
                            className={styles.viewerSectionToggle}
                            onClick={() => setIsLineItemsSectionOpen((v) => !v)}
                            aria-expanded={isLineItemsSectionOpen}
                          >
                            <h4>Line Items ({selectedViewerChangeOrder.line_items.length})</h4>
                            <span className={styles.viewerSectionArrow}>▼</span>
                          </button>
                          {isLineItemsSectionOpen ? (
                            <div className={styles.viewerSectionContent}>
                              {selectedViewerChangeOrder.line_items.length > 0 ? (
                                <>
                                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                    <button
                                      type="button"
                                      className={styles.budgetToggle}
                                      onClick={() => setShowBudgetColumns((v) => !v)}
                                    >
                                      {showBudgetColumns ? "Hide budget context" : "Show budget context"}
                                    </button>
                                  </div>
                                  <div className={styles.lineTableWrap}>
                                    <table className={styles.lineTable}>
                                      <thead>
                                        <tr>
                                          <th>Type</th>
                                          <th>Cost code</th>
                                          <th>CO line note</th>
                                          <th>CO line delta ($)</th>
                                          <th>Days delta</th>
                                          {showBudgetColumns ? (
                                            <>
                                              <th>Adjustment reason</th>
                                              <th>Original approved ($)</th>
                                              <th>Approved CO delta ($)</th>
                                              <th>Working budget ($)</th>
                                            </>
                                          ) : null}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {selectedViewerChangeOrder.line_items.map((line) => (
                                          <tr key={line.id}>
                                            <td>{line.line_type === "new" ? "New" : "Original"}</td>
                                            <td>
                                              {line.line_type === "new"
                                                ? (line.cost_code_code || "—")
                                                : `#${line.budget_line} ${line.budget_line_cost_code}`}
                                            </td>
                                            <td>{line.description || line.budget_line_description}</td>
                                            <td>${line.amount_delta}</td>
                                            <td>{line.days_delta}</td>
                                            {showBudgetColumns ? (
                                              <>
                                                <td>{line.adjustment_reason || "—"}</td>
                                                <td>{line.line_type === "original" ? `$${originalApprovedAmountForLine(String(line.budget_line))}` : "—"}</td>
                                                <td>{line.line_type === "original" ? `$${approvedChangeOrderDeltaForLine(String(line.budget_line))}` : "—"}</td>
                                                <td>{line.line_type === "original" ? `$${currentWorkingAmountForLine(String(line.budget_line))}` : "—"}</td>
                                              </>
                                            ) : null}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </>
                              ) : (
                                <p className={styles.viewerHint}>No line items yet on this change order.</p>
                              )}
                              <div className={styles.viewerMetaRow}>
                                <span className={styles.viewerMetaLabel}>Line delta total</span>
                                <strong>${selectedViewerChangeOrder.line_total_delta}</strong>
                              </div>
                              <div className={styles.viewerMetaRow}>
                                <span className={styles.viewerMetaLabel}>Pre-approval total</span>
                                <strong>${selectedViewerWorkingTotals.preApproval}</strong>
                              </div>
                              <div className={styles.viewerMetaRow}>
                                <span className={styles.viewerMetaLabel}>Post-approval total</span>
                                <strong>${selectedViewerWorkingTotals.postApproval}</strong>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.viewerHint}>
                    No change orders have been created yet for this approved origin estimate.
                  </p>
                )}
              </div>
            ) : (
              <p>Select an approved estimate to view linked change orders.</p>
            )}
          </div>
        ) : (
          <p className={styles.viewerHint}>No approved estimates yet for this project.</p>
        )) : (
          <p className={styles.viewerHint}>Viewer collapsed. Expand when you need linked estimate/CO context.</p>
        )}
      </section>

      {projectEstimates.length === 0 && !selectedChangeOrder ? (
        <p className={styles.viewerHint}>
          Approve an estimate on this project first to start creating change orders.
        </p>
      ) : (
      <>
      <div className={styles.formToolbar}>
        <div className={styles.formContext}>
          <span className={styles.formContextLabel}>
            {!selectedChangeOrder ? "Creating" : isSelectedChangeOrderEditable ? "Editing" : "Viewing"}
          </span>
          <div className={styles.formContextValueRow}>
            <strong>{workspaceContext}</strong>
            <span className={`${styles.editStatusBadge} ${workspaceBadgeClass}`}>
              {workspaceBadgeLabel}
            </span>
          </div>
        </div>
        <div className={styles.formToolbarActions}>
          <button
            type="button"
            className={styles.primaryCreateButton}
            onClick={handleStartNewChangeOrder}
          >
            {selectedChangeOrder ? "Create New Change Order" : "Reset"}
          </button>
          {selectedViewerChangeOrder?.is_latest_revision ? (
            <button
              type="button"
              className={styles.cloneRevisionButton}
              onClick={handleCloneRevision}
              disabled={!canMutateChangeOrders}
            >
              Duplicate as New Revision
            </button>
          ) : null}
        </div>
        {actionMessage && actionTone === "success" && /^Duplicated\b/i.test(actionMessage) ? (
          <p className={creatorStyles.actionSuccess}>{actionMessage}</p>
        ) : null}
      </div>
      {!selectedChangeOrder ? (
        <div ref={createCreatorRef}>
          <DocumentCreator
          adapter={changeOrderCreatorAdapter}
          document={null}
          formState={createChangeOrderCreatorFormState}
          className={`${creatorStyles.sheet} ${changeOrderCreatorStyles.workflowSheet} ${changeOrderCreatorStyles.createSheet}`}
          sectionClassName={changeOrderCreatorStyles.changeOrderCreatorSection}
          onSubmit={handleCreateChangeOrder}
          sections={[{ slot: "context" }]}
          renderers={{
            context: () => (
              <>
                <div className={creatorStyles.sheetHeader}>
                  <div className={creatorStyles.fromBlock}>
                    <span className={creatorStyles.blockLabel}>From</span>
                    <p className={creatorStyles.blockText}>{senderName || "Your Company"}</p>
                    {senderAddressLines.length ? (
                      senderAddressLines.map((line, index) => (
                        <p key={`${line}-${index}`} className={creatorStyles.blockMuted}>
                          {line}
                        </p>
                      ))
                    ) : (
                      <p className={creatorStyles.blockMuted}>
                        Set sender address in Organization settings.
                      </p>
                    )}
                  </div>
                  <div className={creatorStyles.headerRight}>
                    <div className={creatorStyles.logoBox}>
                      {senderLogoUrl ? "Logo" : "No logo set"}
                    </div>
                    <div className={creatorStyles.sheetTitle}>Change Order</div>
                    <div className={`${creatorStyles.sheetTitleValue} ${creatorStyles.printOnly}`}>
                      {newTitle || "Untitled"}
                    </div>
                    <div className={creatorStyles.blockMuted}>Project #{selectedProjectId || "—"}</div>
                    {selectedViewerEstimate ? (
                      <div className={`${creatorStyles.blockMuted} ${creatorStyles.printOnly}`}>
                        Estimate: {selectedViewerEstimate.title || `#${selectedViewerEstimate.id}`} v{selectedViewerEstimate.version}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className={creatorStyles.partyGrid}>
                  <label className={`${creatorStyles.inlineField} ${changeOrderCreatorStyles.coMetaField} ${creatorStyles.screenOnly}`}>
                    <span className={changeOrderCreatorStyles.coMetaLabel}>Title</span>
                    <input
                      className={`${creatorStyles.fieldInput} ${changeOrderCreatorStyles.coMetaInput}`}
                      value={newTitle}
                      onChange={(event) => {
                        setNewTitle(event.target.value);
                        setNewTitleManuallyEdited(true);
                      }}
                      required
                    />
                  </label>
                  <label className={`${creatorStyles.inlineField} ${changeOrderCreatorStyles.coMetaField} ${changeOrderCreatorStyles.coFieldWide}`}>
                    <span className={changeOrderCreatorStyles.coMetaLabel}>Reason</span>
                    <textarea
                      className={`${creatorStyles.fieldInput} ${changeOrderCreatorStyles.coMetaInput}`}
                      value={newReason}
                      onChange={(event) => setNewReason(event.target.value)}
                      rows={3}
                      placeholder="Describe why this change order is needed"
                    />
                  </label>
                </div>

                <div className={changeOrderCreatorStyles.coLineSectionIntro}>
                  <h3>Line Items</h3>
                  <p>
                    {selectedViewerEstimate
                      ? `Starter rows come from estimate-derived lines for origin estimate #${selectedViewerEstimate.id} v${selectedViewerEstimate.version}.`
                      : "Starter rows come from estimate-derived lines once an origin estimate is selected."}
                  </p>
                </div>

                <div className={creatorStyles.lineTable}>
                  <div className={changeOrderCreatorStyles.coLineHeader}>
                    <span>Type</span>
                    <span>Adjustment reason</span>
                    <span>Cost code</span>
                    <span>CO line note</span>
                    <span>Original approved line item amount ($)</span>
                    <span>CO delta ($)</span>
                    <span>Schedule delta (days)</span>
                    <span>Actions</span>
                  </div>
                  {newLineItems.map((line, index) => {
                    const rowIssues = newLineValidation.issuesByLocalId.get(line.localId) ?? [];
                    return (
                      <div key={line.localId} className={changeOrderCreatorStyles.coLineRowGroup}>
                        <div
                          className={`${changeOrderCreatorStyles.coLineRow} ${index % 2 === 1 ? changeOrderCreatorStyles.coLineRowAlt : ""} ${
                            rowIssues.length ? changeOrderCreatorStyles.coLineRowInvalid : ""
                          }`}
                        >
                          <select
                            className={creatorStyles.lineSelect}
                            value={line.lineType}
                            onChange={(event) => {
                              const nextLineType = event.target.value as "original" | "new";
                              updateLine(setNewLineItems, line.localId, {
                                lineType: nextLineType,
                                budgetLineId: nextLineType === "original" ? line.budgetLineId : "",
                                costCodeId: nextLineType === "new" ? line.costCodeId : "",
                              });
                            }}
                          >
                            <option value="original">Original</option>
                            <option value="new">New</option>
                          </select>
                          <input
                            className={creatorStyles.lineInput}
                            value={line.adjustmentReason}
                            placeholder="Optional reason"
                            onChange={(event) =>
                              updateLine(setNewLineItems, line.localId, { adjustmentReason: event.target.value })
                            }
                          />
                          <div>
                            {line.lineType === "original" ? (
                              <>
                                <span className={creatorStyles.printOnly}>
                                  {budgetLines.find((b) => String(b.id) === line.budgetLineId)?.cost_code_code || "—"}
                                </span>
                                <select
                                  className={`${creatorStyles.lineSelect} ${creatorStyles.screenOnly}`}
                                  value={line.budgetLineId}
                                  onChange={(event) =>
                                    updateLine(setNewLineItems, line.localId, { budgetLineId: event.target.value })
                                  }
                                >
                                  <option value="">Select budget line</option>
                                  {budgetLines.map((budgetLine) => (
                                    <option key={budgetLine.id} value={budgetLine.id}>
                                      #{budgetLine.id} {budgetLine.cost_code_code} - {budgetLine.description}
                                    </option>
                                  ))}
                                </select>
                              </>
                            ) : (
                              <>
                                <span className={creatorStyles.printOnly}>
                                  {costCodes.find((c) => String(c.id) === line.costCodeId)?.code || "—"}
                                </span>
                                <select
                                  className={`${creatorStyles.lineSelect} ${creatorStyles.screenOnly}`}
                                  value={line.costCodeId}
                                  onChange={(event) =>
                                    updateLine(setNewLineItems, line.localId, { costCodeId: event.target.value })
                                  }
                                >
                                  <option value="">Select cost code</option>
                                  {costCodes.map((cc) => (
                                    <option key={cc.id} value={cc.id}>
                                      {cc.code} - {cc.name}
                                    </option>
                                  ))}
                                </select>
                              </>
                            )}
                          </div>
                          <input
                            className={creatorStyles.lineInput}
                            value={line.description}
                            placeholder="Optional CO scope note"
                            onChange={(event) =>
                              updateLine(setNewLineItems, line.localId, { description: event.target.value })
                            }
                          />
                          <span className={changeOrderCreatorStyles.coReadValue}>
                            {line.lineType === "original" ? `$${originalApprovedAmountForLine(line.budgetLineId)}` : "—"}
                          </span>
                          <input
                            className={creatorStyles.lineInput}
                            value={line.amountDelta}
                            placeholder="0.00 (USD)"
                            onChange={(event) =>
                              updateLine(setNewLineItems, line.localId, { amountDelta: event.target.value })
                            }
                            inputMode="decimal"
                          />
                          <input
                            className={creatorStyles.lineInput}
                            value={line.daysDelta}
                            placeholder="0 days"
                            onChange={(event) =>
                              updateLine(setNewLineItems, line.localId, { daysDelta: event.target.value })
                            }
                            inputMode="numeric"
                          />
                          <button
                            type="button"
                            className={creatorStyles.smallButton}
                            onClick={() => removeLine(setNewLineItems, newLineItems, line.localId)}
                          >
                            Remove
                          </button>
                        </div>
                        {rowIssues.length ? (
                          <p className={changeOrderCreatorStyles.coLineIssue}>
                            Row {index + 1}: {rowIssues.join(" ")}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className={changeOrderCreatorStyles.coLineActions}>
                  <button
                    type="button"
                    className={`${creatorStyles.secondaryButton} ${changeOrderCreatorStyles.coLineAddButton}`}
                    onClick={() => addLine(setNewLineItems, newLineNextLocalId, setNewLineNextLocalId)}
                  >
                    Add Line Item
                  </button>
                </div>

                <div className={changeOrderCreatorStyles.coSheetFooter}>
                  <div className={changeOrderCreatorStyles.coTotalsColumn}>
                    <div className={`${creatorStyles.summary} ${changeOrderCreatorStyles.coSummaryCard}`}>
                      <div className={creatorStyles.summaryRow}>
                        <span>Original total</span>
                        <span className={changeOrderCreatorStyles.coSummarySecondaryValue}>
                          {originalEstimateTotal ? `$${originalEstimateTotal}` : "—"}
                        </span>
                      </div>
                      <div className={creatorStyles.summaryRow}>
                        <span>Current total (accepted)</span>
                        <span className={changeOrderCreatorStyles.coSummarySecondaryValue}>
                          {currentAcceptedTotal ? `$${currentAcceptedTotal}` : "—"}
                        </span>
                      </div>
                      <div className={creatorStyles.summaryRow}>
                        <span className={changeOrderCreatorStyles.coSummaryPrimaryLabel}>Cost delta ($)</span>
                        <strong>{formatDecimal(newLineDeltaTotal)}</strong>
                      </div>
                      <div className={creatorStyles.summaryRow}>
                        <span className={changeOrderCreatorStyles.coSummaryPrimaryLabel}>Time delta (days)</span>
                        <strong>{newLineDaysTotal}</strong>
                      </div>
                    </div>
                    <div className={changeOrderCreatorStyles.coSheetFooterActions}>
                      {!selectedViewerEstimateId ? (
                        <p className={`${creatorStyles.inlineHint} ${changeOrderCreatorStyles.coFooterHint}`}>
                          Select an approved origin estimate from the history selector before creating a change
                          order.
                        </p>
                      ) : null}
                      {selectedViewerEstimateId && newLineValidation.issues.length ? (
                        <p className={`${creatorStyles.inlineHint} ${changeOrderCreatorStyles.coFooterHint} ${changeOrderCreatorStyles.coFooterErrorHint}`}>
                          Line-level issues are highlighted inline. Fix them before creating this draft.
                        </p>
                      ) : null}
                      {actionMessage && actionTone === "error" ? (
                        <p className={creatorStyles.actionError}>{actionMessage}</p>
                      ) : null}
                      <div className={changeOrderCreatorStyles.coActionButtonRow}>
                        <button
                          type="submit"
                          className={`${creatorStyles.primaryButton} ${changeOrderCreatorStyles.coFooterPrimaryButton}`}
                          disabled={isCreateSubmitDisabled}
                        >
                          Create Change Order
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={creatorStyles.terms}>
                  <h4>Terms and Conditions</h4>
                  {(newTermsText || defaultChangeOrderTerms || "Not set")
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line, index) => (
                      <p key={`${line}-${index}`}>{line}</p>
                    ))}
                </div>

                <div className={creatorStyles.footer}>
                  <span>{senderName || "Your Company"}</span>
                  <span>{senderEmail || "Help email not set"}</span>
                  <span>New Change Order Draft</span>
                </div>
              </>
            ),
          }}
          />
        </div>
      ) : null}

      {selectedChangeOrder ? (
        <div ref={editCreatorRef}>
        <DocumentCreator
          adapter={changeOrderCreatorAdapter}
          document={selectedChangeOrder}
          formState={editChangeOrderCreatorFormState}
          className={`${creatorStyles.sheet} ${changeOrderCreatorStyles.workflowSheet} ${changeOrderCreatorStyles.editSheet} ${!isSelectedChangeOrderEditable ? changeOrderCreatorStyles.editSheetLocked : ""}`}
          sectionClassName={changeOrderCreatorStyles.changeOrderCreatorSection}
          onSubmit={handleUpdateChangeOrder}
          sections={[{ slot: "context" }]}
          renderers={{
            context: () => (
              <>
                <div className={creatorStyles.sheetHeader}>
                  <div className={creatorStyles.fromBlock}>
                    <span className={creatorStyles.blockLabel}>From</span>
                    <p className={creatorStyles.blockText}>{senderName || "Your Company"}</p>
                    {senderAddressLines.length ? (
                      senderAddressLines.map((line, index) => (
                        <p key={`${line}-${index}`} className={creatorStyles.blockMuted}>
                          {line}
                        </p>
                      ))
                    ) : (
                      <p className={creatorStyles.blockMuted}>
                        Set sender address in Organization settings.
                      </p>
                    )}
                  </div>
                  <div className={creatorStyles.headerRight}>
                    <div className={creatorStyles.logoBox}>
                      {senderLogoUrl ? "Logo" : "No logo set"}
                    </div>
                    <div className={`${creatorStyles.sheetTitle} ${creatorStyles.screenOnly}`}>Change Order Revision</div>
                    <div className={`${creatorStyles.sheetTitle} ${creatorStyles.printOnly}`}>Change Order</div>
                    <div className={`${creatorStyles.sheetTitleValue} ${creatorStyles.printOnly}`}>
                      {editTitle || "Untitled"}
                    </div>
                    {(() => {
                      const originEst = selectedChangeOrder?.origin_estimate
                        ? projectEstimates.find((e) => e.id === selectedChangeOrder.origin_estimate)
                        : null;
                      return originEst ? (
                        <div className={`${creatorStyles.blockMuted} ${creatorStyles.printOnly}`}>
                          Estimate: {originEst.title || `#${originEst.id}`} v{originEst.version}
                        </div>
                      ) : null;
                    })()}
                  </div>
                </div>

                <div className={creatorStyles.partyGrid}>
                  <label className={`${creatorStyles.inlineField} ${changeOrderCreatorStyles.coMetaField} ${creatorStyles.screenOnly}`}>
                    <span className={changeOrderCreatorStyles.coMetaLabel}>Title</span>
                    <input
                      className={`${creatorStyles.fieldInput} ${changeOrderCreatorStyles.coMetaInput} ${changeOrderCreatorStyles.lockableControl}`}
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      disabled={!isSelectedChangeOrderEditable}
                      required
                    />
                  </label>
                  <label className={`${creatorStyles.inlineField} ${changeOrderCreatorStyles.coMetaField} ${changeOrderCreatorStyles.coFieldWide}`}>
                    <span className={changeOrderCreatorStyles.coMetaLabel}>Reason</span>
                    <textarea
                      className={`${creatorStyles.fieldInput} ${changeOrderCreatorStyles.coMetaInput} ${changeOrderCreatorStyles.lockableControl}`}
                      value={editReason}
                      onChange={(event) => setEditReason(event.target.value)}
                      rows={3}
                      placeholder="Describe why this change order revision is needed"
                      disabled={!isSelectedChangeOrderEditable}
                    />
                  </label>
                </div>

                <div className={changeOrderCreatorStyles.coLineSectionIntro}>
                  <h3>Line Items</h3>
                  <p>
                    Original lines adjust existing budget items. New lines add scope not in the original estimate.
                  </p>
                </div>

                <div className={creatorStyles.lineTable}>
                  <div className={changeOrderCreatorStyles.coLineHeader}>
                    <span>Type</span>
                    <span>Adjustment reason</span>
                    <span>Cost code</span>
                    <span>CO line note</span>
                    <span>Original approved line item amount ($)</span>
                    <span>CO delta ($)</span>
                    <span>Schedule delta (days)</span>
                    <span>{isSelectedChangeOrderEditable ? "Actions" : ""}</span>
                  </div>
                  {editLineItems.map((line, index) => {
                    const rowIssues = editLineValidation.issuesByLocalId.get(line.localId) ?? [];
                    return (
                      <div key={line.localId} className={changeOrderCreatorStyles.coLineRowGroup}>
                        <div
                          className={`${changeOrderCreatorStyles.coLineRow} ${index % 2 === 1 ? changeOrderCreatorStyles.coLineRowAlt : ""} ${
                            rowIssues.length ? changeOrderCreatorStyles.coLineRowInvalid : ""
                          }`}
                        >
                          <select
                            className={`${creatorStyles.lineSelect} ${changeOrderCreatorStyles.lockableControl}`}
                            value={line.lineType}
                            onChange={(event) => {
                              const nextLineType = event.target.value as "original" | "new";
                              updateLine(setEditLineItems, line.localId, {
                                lineType: nextLineType,
                                budgetLineId: nextLineType === "original" ? line.budgetLineId : "",
                                costCodeId: nextLineType === "new" ? line.costCodeId : "",
                              });
                            }}
                            disabled={!isSelectedChangeOrderEditable}
                          >
                            <option value="original">Original</option>
                            <option value="new">New</option>
                          </select>
                          <input
                            className={`${creatorStyles.lineInput} ${changeOrderCreatorStyles.lockableControl}`}
                            value={line.adjustmentReason}
                            placeholder="Optional reason"
                            onChange={(event) =>
                              updateLine(setEditLineItems, line.localId, { adjustmentReason: event.target.value })
                            }
                            disabled={!isSelectedChangeOrderEditable}
                          />
                          <div>
                            {line.lineType === "original" ? (
                              <>
                                <span className={creatorStyles.printOnly}>
                                  {budgetLines.find((b) => String(b.id) === line.budgetLineId)?.cost_code_code || "—"}
                                </span>
                                <select
                                  className={`${creatorStyles.lineSelect} ${changeOrderCreatorStyles.lockableControl} ${creatorStyles.screenOnly}`}
                                  value={line.budgetLineId}
                                  onChange={(event) =>
                                    updateLine(setEditLineItems, line.localId, { budgetLineId: event.target.value })
                                  }
                                  disabled={!isSelectedChangeOrderEditable}
                                >
                                  <option value="">Select budget line</option>
                                  {budgetLines.map((budgetLine) => (
                                    <option key={budgetLine.id} value={budgetLine.id}>
                                      #{budgetLine.id} {budgetLine.cost_code_code} - {budgetLine.description}
                                    </option>
                                  ))}
                                </select>
                              </>
                            ) : (
                              <>
                                <span className={creatorStyles.printOnly}>
                                  {costCodes.find((c) => String(c.id) === line.costCodeId)?.code || "—"}
                                </span>
                                <select
                                  className={`${creatorStyles.lineSelect} ${changeOrderCreatorStyles.lockableControl} ${creatorStyles.screenOnly}`}
                                  value={line.costCodeId}
                                  onChange={(event) =>
                                    updateLine(setEditLineItems, line.localId, { costCodeId: event.target.value })
                                  }
                                  disabled={!isSelectedChangeOrderEditable}
                                >
                                  <option value="">Select cost code</option>
                                  {costCodes.map((cc) => (
                                    <option key={cc.id} value={cc.id}>
                                      {cc.code} - {cc.name}
                                    </option>
                                  ))}
                                </select>
                              </>
                            )}
                          </div>
                          <input
                            className={`${creatorStyles.lineInput} ${changeOrderCreatorStyles.lockableControl}`}
                            value={line.description}
                            placeholder="Optional CO scope note"
                            onChange={(event) =>
                              updateLine(setEditLineItems, line.localId, { description: event.target.value })
                            }
                            disabled={!isSelectedChangeOrderEditable}
                          />
                          <span className={changeOrderCreatorStyles.coReadValue}>
                            {line.lineType === "original" ? `$${originalApprovedAmountForLine(line.budgetLineId)}` : "—"}
                          </span>
                          <input
                            className={`${creatorStyles.lineInput} ${changeOrderCreatorStyles.lockableControl}`}
                            value={line.amountDelta}
                            placeholder="0.00 (USD)"
                            onChange={(event) =>
                              updateLine(setEditLineItems, line.localId, { amountDelta: event.target.value })
                            }
                            inputMode="decimal"
                            disabled={!isSelectedChangeOrderEditable}
                          />
                          <input
                            className={`${creatorStyles.lineInput} ${changeOrderCreatorStyles.lockableControl}`}
                            value={line.daysDelta}
                            placeholder="0 days"
                            onChange={(event) =>
                              updateLine(setEditLineItems, line.localId, { daysDelta: event.target.value })
                            }
                            inputMode="numeric"
                            disabled={!isSelectedChangeOrderEditable}
                          />
                          {isSelectedChangeOrderEditable ? (
                            <button
                              type="button"
                              className={creatorStyles.smallButton}
                              onClick={() => removeLine(setEditLineItems, editLineItems, line.localId)}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                        {rowIssues.length ? (
                          <p className={changeOrderCreatorStyles.coLineIssue}>
                            Row {index + 1}: {rowIssues.join(" ")}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {isSelectedChangeOrderEditable ? (
                  <div className={changeOrderCreatorStyles.coLineActions}>
                    <button
                      type="button"
                      className={`${creatorStyles.secondaryButton} ${changeOrderCreatorStyles.coLineAddButton}`}
                      onClick={() => addLine(setEditLineItems, editLineNextLocalId, setEditLineNextLocalId)}
                    >
                      Add Line Item
                    </button>
                  </div>
                ) : null}

                <div className={changeOrderCreatorStyles.coSheetFooter}>
                  <div className={changeOrderCreatorStyles.coTotalsColumn}>
                    <div className={`${creatorStyles.summary} ${changeOrderCreatorStyles.coSummaryCard}`}>
                      <div className={creatorStyles.summaryRow}>
                        <span>Original total</span>
                        <span className={changeOrderCreatorStyles.coSummarySecondaryValue}>
                          {originalEstimateTotal ? `$${originalEstimateTotal}` : "—"}
                        </span>
                      </div>
                      <div className={creatorStyles.summaryRow}>
                        <span>Current total (accepted)</span>
                        <span className={changeOrderCreatorStyles.coSummarySecondaryValue}>
                          {currentAcceptedTotal ? `$${currentAcceptedTotal}` : "—"}
                        </span>
                      </div>
                      <div className={creatorStyles.summaryRow}>
                        <span className={changeOrderCreatorStyles.coSummaryPrimaryLabel}>Cost delta ($)</span>
                        <strong>{formatDecimal(editLineDeltaTotal)}</strong>
                      </div>
                      <div className={creatorStyles.summaryRow}>
                        <span className={changeOrderCreatorStyles.coSummaryPrimaryLabel}>Time delta (days)</span>
                        <strong>{editLineDaysTotal}</strong>
                      </div>
                    </div>
                    <div className={changeOrderCreatorStyles.coSheetFooterActions}>
                      {isSelectedChangeOrderEditable && editLineValidation.issues.length ? (
                        <p className={`${creatorStyles.inlineHint} ${changeOrderCreatorStyles.coFooterHint} ${changeOrderCreatorStyles.coFooterErrorHint}`}>
                          Line-level issues are highlighted inline. Fix them before saving this revision.
                        </p>
                      ) : null}
                      {selectedChangeOrder && !selectedChangeOrder.is_latest_revision ? (
                        <p className={`${creatorStyles.inlineHint} ${changeOrderCreatorStyles.coFooterHint} ${changeOrderCreatorStyles.coFooterErrorHint}`}>
                          This revision is historical and read-only. Save/update actions are available on the latest revision only.
                        </p>
                      ) : null}
                      {actionMessage && actionTone === "success" ? (
                        <p className={creatorStyles.actionSuccess}>{actionMessage}</p>
                      ) : null}
                      {actionMessage && actionTone === "error" ? (
                        <p className={creatorStyles.actionError}>{actionMessage}</p>
                      ) : null}
                      {isSelectedChangeOrderEditable ? (
                        <div className={changeOrderCreatorStyles.coActionButtonRow}>
                          <button
                            type="submit"
                            className={`${creatorStyles.primaryButton} ${changeOrderCreatorStyles.coFooterPrimaryButton}`}
                            disabled={isEditSubmitDisabled}
                          >
                            Save Change Order
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className={creatorStyles.terms}>
                  <h4>Terms and Conditions</h4>
                  {(editTermsText || defaultChangeOrderTerms || "Not set")
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line, index) => (
                      <p key={`${line}-${index}`}>{line}</p>
                    ))}
                </div>

                <div className={creatorStyles.footer}>
                  <span>{senderName || "Your Company"}</span>
                  <span>{senderEmail || "Help email not set"}</span>
                  <span>
                    {selectedChangeOrder
                      ? `CO-${selectedChangeOrder.family_key} v${selectedChangeOrder.revision_number}`
                      : "Change Order"}
                  </span>
                </div>
              </>
            ),
          }}
        />
        {selectedChangeOrder && (selectedChangeOrder.status === "approved" || selectedChangeOrder.status === "rejected") ? (
          <div
            className={`${stampStyles.decisionStamp} ${
              selectedChangeOrder.status === "approved" ? stampStyles.decisionStampApproved
              : stampStyles.decisionStampRejected
            }`}
          >
            <p className={stampStyles.decisionStampLabel}>
              {selectedChangeOrder.status === "approved" ? "Approved" : "Rejected"}
            </p>
          </div>
        ) : null}
        </div>
      ) : null}
      </>
      )}
    </section>
  );
}
