"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  defaultApiBaseUrl,
  fetchChangeOrderPolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { hasAnyRole } from "../../session/rbac";
import {
  ApiResponse,
  BudgetLineRecord,
  ChangeOrderPolicyContract,
  ChangeOrderRecord,
} from "../types";
import styles from "./change-orders-console.module.css";
import composerStyles from "@/shared/document-composer/composer-foundation.module.css";
import changeOrderComposerStyles from "@/shared/document-composer/change-order-composer.module.css";
import { DocumentComposer } from "@/shared/document-composer";
import collapseButtonStyles from "@/shared/collapse-toggle-button.module.css";
import {
  resolveOrganizationBranding,
  type OrganizationBrandingDefaults,
} from "@/shared/document-composer";
import {
  createChangeOrderDocumentAdapter,
  ChangeOrderFormState,
  toChangeOrderStatusPolicy,
} from "../document-adapter";

type ChangeOrderLineInput = {
  localId: number;
  lineType: "scope" | "adjustment";
  adjustmentReason: string;
  budgetLineId: string;
  description: string;
  amountDelta: string;
  daysDelta: string;
};

type LineSetter = (
  value:
    | ChangeOrderLineInput[]
    | ((current: ChangeOrderLineInput[]) => ChangeOrderLineInput[]),
) => void;

type LineValidationIssue = {
  localId: number;
  rowNumber: number;
  message: string;
};

type LineValidationResult = {
  issues: LineValidationIssue[];
  issuesByLocalId: Map<number, string[]>;
};

function isFiniteNumericInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed);
}

function validateLineItems(lines: ChangeOrderLineInput[]): LineValidationResult {
  const budgetLineCounts = new Map<string, number>();
  for (const line of lines) {
    const budgetLineId = line.budgetLineId.trim();
    if (!budgetLineId) {
      continue;
    }
    budgetLineCounts.set(budgetLineId, (budgetLineCounts.get(budgetLineId) ?? 0) + 1);
  }

  const issues: LineValidationIssue[] = [];
  const issuesByLocalId = new Map<number, string[]>();
  lines.forEach((line, index) => {
    const rowNumber = index + 1;
    const rowIssues: string[] = [];
    const budgetLineId = line.budgetLineId.trim();

    if (!budgetLineId) {
      rowIssues.push("Select a budget line.");
    } else if ((budgetLineCounts.get(budgetLineId) ?? 0) > 1) {
      rowIssues.push("Budget line is duplicated in this change order.");
    }

    if (line.lineType === "adjustment" && !line.adjustmentReason.trim()) {
      rowIssues.push("Adjustment lines require a reason.");
    }

    if (!isFiniteNumericInput(line.amountDelta)) {
      rowIssues.push("Amount delta must be a number.");
    }

    if (!isFiniteNumericInput(line.daysDelta) || !Number.isInteger(Number(line.daysDelta))) {
      rowIssues.push("Days delta must be a whole number.");
    }

    if (!rowIssues.length) {
      return;
    }

    issuesByLocalId.set(line.localId, rowIssues);
    for (const message of rowIssues) {
      issues.push({
        localId: line.localId,
        rowNumber,
        message,
      });
    }
  });

  return {
    issues,
    issuesByLocalId,
  };
}

function emptyLine(localId: number): ChangeOrderLineInput {
  return {
    localId,
    lineType: "scope",
    adjustmentReason: "",
    budgetLineId: "",
    description: "",
    amountDelta: "0.00",
    daysDelta: "0",
  };
}

function defaultChangeOrderTitle(projectName?: string): string {
  const trimmed = (projectName || "").trim();
  if (!trimmed) {
    return "Change Order";
  }
  return `Change Order: ${trimmed}`;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  return value.toFixed(2);
}

function coLabel(changeOrder: Pick<ChangeOrderRecord, "family_key" | "revision_number">): string {
  return `CO-${changeOrder.family_key} v${changeOrder.revision_number}`;
}

function publicChangeOrderHref(publicRef?: string): string {
  if (!publicRef) {
    return "";
  }
  return `/change-order/${publicRef}`;
}

function readApiErrorMessage(payload: ApiResponse | undefined, fallback: string): string {
  const withStaleTransitionHint = (message: string): string => {
    if (
      /invalid .*status transition/i.test(message) &&
      !/refresh/i.test(message)
    ) {
      return `${message} This change order may have changed from a client action on the public page. Refresh to load the latest status.`;
    }
    return message;
  };

  const topLevelMessage = payload?.error?.message?.trim();
  if (topLevelMessage) {
    return withStaleTransitionHint(topLevelMessage);
  }
  const fieldEntries = Object.entries(payload?.error?.fields ?? {});
  for (const [fieldName, fieldMessages] of fieldEntries) {
    if (!Array.isArray(fieldMessages)) {
      continue;
    }
    const firstFieldMessage = fieldMessages.find((message) => Boolean((message || "").trim()));
    if (firstFieldMessage) {
      return withStaleTransitionHint(`${fieldName}: ${firstFieldMessage}`);
    }
  }
  return fallback;
}

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

type FinancialBaselineStatusValue = "none" | "active" | "superseded";

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
  change_order_default_reason: string;
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
const CO_GENERIC_BUDGET_LINE_CODES = new Set(["99-901", "99-902", "99-903"]);

export function ChangeOrdersConsole({
  scopedProjectId: scopedProjectIdProp = null,
  initialOriginEstimateId: initialOriginEstimateIdProp = null,
}: ChangeOrdersConsoleProps) {
  const { token, role } = useSharedSessionAuth();
  const [actionMessage, setActionMessage] = useState("");
  const [actionTone, setActionTone] = useState<"error" | "success" | "info">("info");

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [changeOrders, setChangeOrders] = useState<ChangeOrderRecord[]>([]);
  const [selectedChangeOrderId, setSelectedChangeOrderId] = useState("");
  const [selectedViewerEstimateId, setSelectedViewerEstimateId] = useState("");
  const [isViewerExpanded, setIsViewerExpanded] = useState(true);
  const [budgetLines, setBudgetLines] = useState<BudgetLineRecord[]>([]);
  const [originEstimateOriginalTotals, setOriginEstimateOriginalTotals] = useState<
    Record<number, number>
  >({});
  const [projectEstimates, setProjectEstimates] = useState<OriginEstimateRecord[]>([]);
  const [projectAuditEvents, setProjectAuditEvents] = useState<AuditEventRecord[]>([]);
  const [nextLineLocalId, setNextLineLocalId] = useState(2);
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [organizationDefaults, setOrganizationDefaults] =
    useState<OrganizationDocumentDefaults | null>(null);

  const [newTitle, setNewTitle] = useState("Change Order");
  const [newTitleManuallyEdited, setNewTitleManuallyEdited] = useState(false);
  const [newReason, setNewReason] = useState("");
  const [newLineItems, setNewLineItems] = useState<ChangeOrderLineInput[]>([emptyLine(1)]);

  const [editTitle, setEditTitle] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editLineItems, setEditLineItems] = useState<ChangeOrderLineInput[]>([emptyLine(1)]);
  const [quickStatus, setQuickStatus] = useState("pending_approval");
  const [quickStatusNote, setQuickStatusNote] = useState("");
  const [changeOrderStatusLabels, setChangeOrderStatusLabels] = useState<
    Record<string, string>
  >(CHANGE_ORDER_STATUS_LABELS_FALLBACK);
  const [changeOrderAllowedTransitions, setChangeOrderAllowedTransitions] = useState<
    Record<string, string[]>
  >(CHANGE_ORDER_ALLOWED_STATUS_TRANSITIONS_FALLBACK);
  const createComposerRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToCreateComposerRef = useRef(false);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const canMutateChangeOrders = hasAnyRole(role, ["owner", "pm"]);
  const scopedProjectId = scopedProjectIdProp;
  const initialOriginEstimateId = initialOriginEstimateIdProp;
  const selectedChangeOrder =
    changeOrders.find((row) => String(row.id) === selectedChangeOrderId) ?? null;
  const selectedViewerEstimate =
    projectEstimates.find((estimate) => String(estimate.id) === selectedViewerEstimateId) ?? null;
  const activeFinancialBaselineEstimate =
    projectEstimates.find(
      (estimate) => estimateFinancialBaselineStatus(estimate) === "active",
    ) ?? null;
  const selectedViewerEstimateBaselineStatus = estimateFinancialBaselineStatus(selectedViewerEstimate);
  const selectedViewerEstimateIsActiveBaseline = selectedViewerEstimateBaselineStatus === "active";
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
  const selectedViewerChangeOrder =
    viewerChangeOrders.find((changeOrder) => String(changeOrder.id) === selectedChangeOrderId) ??
    viewerChangeOrders[0] ??
    null;
  const selectedViewerEstimateRecordId = selectedViewerEstimate?.id ?? null;
  const selectedViewerChangeOrderIdValue = selectedViewerChangeOrder?.id ?? null;
  const selectedViewerChangeOrderLineDelta = selectedViewerChangeOrder
    ? toNumber(selectedViewerChangeOrder.line_total_delta || selectedViewerChangeOrder.amount_delta)
    : 0;
  const selectedViewerChangeOrderIsApproved = Boolean(
    selectedViewerChangeOrder && ["approved", "accepted"].includes(selectedViewerChangeOrder.status),
  );
  const scopedProjectLabel = selectedProjectId
    ? `Project #${selectedProjectId}${selectedProjectName ? ` · ${selectedProjectName}` : ""}`
    : "No project selected";
  const senderBranding = resolveOrganizationBranding(organizationDefaults);
  const senderName = senderBranding.senderDisplayName;
  const senderEmail = senderBranding.senderEmail;
  const senderAddressLines = senderBranding.senderAddressLines;
  const senderLogoUrl = senderBranding.logoUrl;
  const defaultChangeOrderReason = (organizationDefaults?.change_order_default_reason || "").trim();
  const newLineDeltaTotal = useMemo(
    () =>
      newLineItems.reduce((sum, line) => sum + toNumber(line.amountDelta), 0),
    [newLineItems],
  );
  const newLineValidation = useMemo(() => validateLineItems(newLineItems), [newLineItems]);
  const editLineDeltaTotal = useMemo(
    () =>
      editLineItems.reduce((sum, line) => sum + toNumber(line.amountDelta), 0),
    [editLineItems],
  );
  const editLineValidation = useMemo(() => validateLineItems(editLineItems), [editLineItems]);
  const newLineDaysTotal = useMemo(
    () => newLineItems.reduce((sum, line) => sum + Math.trunc(toNumber(line.daysDelta)), 0),
    [newLineItems],
  );
  const editLineDaysTotal = useMemo(
    () => editLineItems.reduce((sum, line) => sum + Math.trunc(toNumber(line.daysDelta)), 0),
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
    return base;
  }, [changeOrderAllowedTransitions, selectedViewerChangeOrder]);
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
    ? "NEW CHANGE ORDER"
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
  const changeOrderComposerStatusPolicy = useMemo(
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
  const createChangeOrderComposerFormState: ChangeOrderFormState = useMemo(
    () => ({
      title: newTitle,
      reason: newReason,
      amountDelta: formatMoney(newLineDeltaTotal),
      daysDelta: String(newLineDaysTotal),
      lineItems: newLineItems,
    }),
    [newLineDaysTotal, newLineDeltaTotal, newLineItems, newReason, newTitle],
  );
  const editChangeOrderComposerFormState: ChangeOrderFormState = useMemo(
    () => ({
      title: editTitle,
      reason: editReason,
      amountDelta: formatMoney(editLineDeltaTotal),
      daysDelta: String(editLineDaysTotal),
      lineItems: editLineItems,
    }),
    [editLineDaysTotal, editLineDeltaTotal, editLineItems, editReason, editTitle],
  );
  const changeOrderComposerAdapter = useMemo(
    () => createChangeOrderDocumentAdapter(changeOrderComposerStatusPolicy, []),
    [changeOrderComposerStatusPolicy],
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
      return sum + toNumber(changeOrder.amount_delta);
    }, 0);
    const originalBudgetTotal = originEstimateOriginalTotals[selectedViewerEstimateRecordId] ?? 0;
    const currentApprovedWorkingTotal = originalBudgetTotal + approvedRollingDelta;
    const preApprovalTotal = selectedViewerChangeOrderIsApproved
      ? currentApprovedWorkingTotal - selectedViewerChangeOrderLineDelta
      : currentApprovedWorkingTotal;
    const postApprovalTotal = preApprovalTotal + selectedViewerChangeOrderLineDelta;
    return {
      preApproval: formatMoney(preApprovalTotal),
      postApproval: formatMoney(postApprovalTotal),
    };
  })();

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

  function isGenericBudgetLine(line: BudgetLineRecord | undefined): boolean {
    return Boolean(line?.cost_code_code && CO_GENERIC_BUDGET_LINE_CODES.has(line.cost_code_code));
  }

  const setFeedback = useCallback((message: string, tone: "error" | "success" | "info" = "info") => {
    setActionMessage(message);
    setActionTone(tone);
  }, []);

  function originalApprovedAmountForLine(budgetLineId: string): string {
    const line = budgetLineById.get(budgetLineId);
    if (!line) {
      return "0.00";
    }
    return line.budget_amount;
  }

  function approvedChangeOrderDeltaForLine(budgetLineId: string): string {
    const line = budgetLineById.get(budgetLineId);
    if (!line) {
      return "0.00";
    }
    return line.approved_change_order_delta ?? "0.00";
  }

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

  function quickStatusControlLabel(status: string): string {
    if (status === "pending_approval" || status === "sent") {
      return "Sent";
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

  function eventActorHref(event: AuditEventRecord): string | null {
    const actorCustomerId = Number(event.created_by_customer_id);
    if (Number.isInteger(actorCustomerId) && actorCustomerId > 0) {
      return `/customers?customer=${actorCustomerId}`;
    }
    return null;
  }

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

  function approvedRollingDeltaForEstimate(estimateId: number): string {
    const total = changeOrders.reduce((sum, changeOrder) => {
      if (
        changeOrder.origin_estimate !== estimateId ||
        !["approved", "accepted"].includes(changeOrder.status)
      ) {
        return sum;
      }
      return sum + toNumber(changeOrder.amount_delta);
    }, 0);
    return formatMoney(total);
  }

  function originalBudgetTotalForEstimate(estimateId: number): string {
    return formatMoney(originEstimateOriginalTotals[estimateId] ?? 0);
  }

  function currentApprovedBudgetTotalForEstimate(estimateId: number): string {
    return formatMoney(
      toNumber(originalBudgetTotalForEstimate(estimateId)) + toNumber(approvedRollingDeltaForEstimate(estimateId)),
    );
  }

  function statusEventLabel(status: string): string {
    if (!status) {
      return "Unset";
    }
    return statusLabel(status);
  }

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

  function estimateFinancialBaselineStatus(
    estimate?: OriginEstimateRecord | null,
  ): FinancialBaselineStatusValue {
    if (!estimate) {
      return "none";
    }
    if (estimate.is_active_financial_baseline) {
      return "active";
    }
    if (estimate.financial_baseline_status === "active" || estimate.financial_baseline_status === "superseded") {
      return estimate.financial_baseline_status;
    }
    return "none";
  }

  function financialBaselineLabel(status: FinancialBaselineStatusValue): string {
    if (status === "active") {
      return "Active Estimate";
    }
    if (status === "superseded") {
      return "Superseded Estimate";
    }
    return "";
  }

  const hydrateEditForm = useCallback((changeOrder: ChangeOrderRecord | undefined) => {
    if (!changeOrder) {
      setSelectedChangeOrderId("");
      setEditTitle("");
      setEditReason("");
      setEditLineItems([emptyLine(1)]);
      setNextLineLocalId(2);
      setQuickStatus(changeOrderAllowedTransitions.draft?.[0] ?? "pending_approval");
      setQuickStatusNote("");
      return;
    }

    setSelectedChangeOrderId(String(changeOrder.id));
    setEditTitle(changeOrder.title);
    setEditReason(changeOrder.reason);
    const hydratedLines: ChangeOrderLineInput[] =
      changeOrder.line_items.length > 0
        ? changeOrder.line_items.map((line, index) => ({
            localId: index + 1,
            lineType: (line.line_type === "adjustment" ? "adjustment" : "scope") as
              | "scope"
              | "adjustment",
            adjustmentReason: line.adjustment_reason ?? "",
            budgetLineId: String(line.budget_line),
            description: line.description ?? "",
            amountDelta: line.amount_delta,
            daysDelta: String(line.days_delta),
          }))
        : [emptyLine(1)];
    setEditLineItems(hydratedLines);
    const maxLocalId = hydratedLines.reduce((maxId, line) => Math.max(maxId, line.localId), 1);
    setNextLineLocalId(maxLocalId + 1);
    if (changeOrder.origin_estimate) {
      setSelectedViewerEstimateId(String(changeOrder.origin_estimate));
    }
    const nextQuickStatuses = changeOrderAllowedTransitions[changeOrder.status] ?? [];
    if (changeOrder.status === "pending_approval") {
      setQuickStatus("pending_approval");
    } else {
      setQuickStatus(nextQuickStatuses[0] ?? changeOrder.status);
    }
    setQuickStatusNote("");
  }, [changeOrderAllowedTransitions]);

  const loadChangeOrderPolicy = useCallback(async () => {
    try {
      const response = await fetchChangeOrderPolicyContract({
        baseUrl: normalizedBaseUrl,
        token,
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        return;
      }
      const contract = payload.data as ChangeOrderPolicyContract;
      if (
        !Array.isArray(contract.statuses) ||
        !contract.statuses.length ||
        !contract.allowed_status_transitions
      ) {
        return;
      }
      const normalizedTransitions = contract.statuses.reduce<Record<string, string[]>>(
        (acc, status) => {
          const nextStatuses = contract.allowed_status_transitions[status];
          acc[status] = Array.isArray(nextStatuses) ? nextStatuses : [];
          return acc;
        },
        {},
      );
      setChangeOrderStatusLabels({
        ...CHANGE_ORDER_STATUS_LABELS_FALLBACK,
        ...(contract.status_labels || {}),
      });
      setChangeOrderAllowedTransitions(normalizedTransitions);
    } catch {
      // Policy contract fetch is best-effort; fallback map remains active.
    }
  }, [normalizedBaseUrl, token]);

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
          (sum, line) => sum + toNumber(line.budget_amount),
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

  const prefillNewLinesFromBudgetLines = useCallback((lines: BudgetLineRecord[]) => {
    if (!lines.length) {
      setNewLineItems([emptyLine(1)]);
      setNextLineLocalId(2);
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
      setNextLineLocalId(2);
      return;
    }
    const mapped: ChangeOrderLineInput[] = starterLines.map((line, index) => ({
      localId: index + 1,
      lineType: "scope",
      adjustmentReason: "",
      budgetLineId: String(line.id),
      description: line.description || "",
      amountDelta: "0.00",
      daysDelta: "0",
    }));
    setNewLineItems(mapped);
    setNextLineLocalId(mapped.length + 1);
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
        error: readApiErrorMessage(payload, "Could not load change orders."),
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
        setNewReason((current) => current || organizationData.change_order_default_reason || "");
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
        setFeedback(readApiErrorMessage(payload, "Could not load projects."), "error");
        return;
      }
      const rows = (payload.data as Array<{ id: number; name: string }>) ?? [];
      setNewLineItems([emptyLine(1)]);
      setNextLineLocalId(2);
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
        ]);
        const { rows: changeOrderRows, error } = await fetchProjectChangeOrders(nextProject.id);
        if (!changeOrderRows) {
          setChangeOrders([]);
          hydrateEditForm(undefined);
          setFeedback(`${error}${scopeFallbackNote}`, "error");
          return;
        }
        setChangeOrders(changeOrderRows);
        hydrateEditForm(changeOrderRows[0]);
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
    loadBudgetLines,
    loadProjectAuditEvents,
    loadProjectEstimates,
    normalizedBaseUrl,
    scopedProjectId,
    setFeedback,
    token,
  ]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const run = window.setTimeout(() => {
      void loadChangeOrderPolicy();
    }, 0);
    return () => window.clearTimeout(run);
  }, [loadChangeOrderPolicy, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const run = window.setTimeout(() => {
      void loadProjects();
    }, 0);
    return () => window.clearTimeout(run);
  }, [loadProjects, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const run = window.setTimeout(() => {
      void loadOrganizationDefaults();
    }, 0);
    return () => window.clearTimeout(run);
  }, [loadOrganizationDefaults, token]);

  useEffect(() => {
    if (newTitleManuallyEdited) {
      return;
    }
    const run = window.setTimeout(() => {
      setNewTitle(defaultChangeOrderTitle(selectedProjectName));
    }, 0);
    return () => window.clearTimeout(run);
  }, [newTitleManuallyEdited, selectedProjectName]);

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

  function toLinePayload(lines: ChangeOrderLineInput[]) {
    return lines
      .filter((line) => line.budgetLineId.trim() !== "")
      .map((line) => ({
        line_type: line.lineType,
        budget_line: Number(line.budgetLineId),
        description: line.description,
        adjustment_reason: line.adjustmentReason,
        amount_delta: line.amountDelta,
        days_delta: Number(line.daysDelta),
      }));
  }

  function updateLine(
    setter: LineSetter,
    localId: number,
    patch: Partial<ChangeOrderLineInput>,
  ) {
    setter((current) =>
      current.map((line) => (line.localId === localId ? { ...line, ...patch } : line)),
    );
  }

  function addLine(setter: LineSetter) {
    if (actionTone === "error" && actionMessage === CHANGE_ORDER_MIN_LINE_ITEMS_ERROR) {
      setFeedback("");
    }
    const localId = nextLineLocalId;
    setNextLineLocalId((current) => current + 1);
    setter((current) => [...current, emptyLine(localId)]);
  }

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

  function handleStartNewChangeOrder() {
    pendingScrollToCreateComposerRef.current = true;
    hydrateEditForm(undefined);
    setNewTitleManuallyEdited(false);
    setNewTitle(defaultChangeOrderTitle(selectedProjectName));
    setNewReason(defaultChangeOrderReason);
    if (budgetLines.length > 0) {
      prefillNewLinesFromBudgetLines(budgetLines);
    } else {
      setNewLineItems([emptyLine(1)]);
      setNextLineLocalId(2);
    }
    setFeedback("Ready for a new change order draft.", "info");
  }

  useEffect(() => {
    if (!pendingScrollToCreateComposerRef.current) {
      return;
    }
    if (selectedChangeOrder) {
      return;
    }
    const target = createComposerRef.current;
    if (!target) {
      return;
    }
    pendingScrollToCreateComposerRef.current = false;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [selectedChangeOrder]);

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
            amount_delta: formatMoney(newLineDeltaTotal),
            days_delta: newLineDaysTotal,
            origin_estimate: selectedViewerEstimateId ? Number(selectedViewerEstimateId) : null,
            line_items: toLinePayload(newLineItems),
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readApiErrorMessage(payload, "Create change order failed."), "error");
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
      setFeedback(`Created change order ${coLabel(created)} (${statusLabel(created.status)}).`, "success");
      setNewLineItems([emptyLine(1)]);
      setNextLineLocalId(2);
      setNewTitleManuallyEdited(false);
      setNewTitle(defaultChangeOrderTitle(selectedProjectName));
      setNewReason(defaultChangeOrderReason);
    } catch {
      setFeedback("Could not reach change order create endpoint.", "error");
    }
  }

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
        setFeedback(readApiErrorMessage(payload, "Clone revision failed."), "error");
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
      setFeedback(`Created ${coLabel(created)} in Draft.`, "success");
    } catch {
      setFeedback("Could not reach clone revision endpoint.", "error");
    }
  }

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
            amount_delta: formatMoney(editLineDeltaTotal),
            days_delta: editLineDaysTotal,
            status: selectedChangeOrder.status,
            line_items: toLinePayload(editLineItems),
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFeedback(readApiErrorMessage(payload, "Save change order failed."), "error");
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
        setFeedback(readApiErrorMessage(payload, "Status update failed."), "error");
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
        setFeedback(`Re-sent ${coLabel(updated)} for approval.`, "success");
      } else {
        setFeedback(`Updated ${coLabel(updated)} to ${statusLabel(updated.status)}.`, "success");
      }
      setQuickStatusNote("");
    } catch {
      setFeedback("Could not reach change order detail endpoint.", "error");
    }
  }

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
        setFeedback(readApiErrorMessage(payload, "Status note update failed."), "error");
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
      setFeedback(`Added status note on ${coLabel(updated)}.`, "success");
    } catch {
      setFeedback("Could not reach change order detail endpoint.", "error");
    }
  }

  return (
    <section>
      {actionMessage && actionTone !== "success" ? (
        <p
          className={
            actionTone === "error"
              ? composerStyles.actionError
              : composerStyles.inlineHint
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

      <section className={styles.consoleTop}>
        <div className={styles.consoleIntro}>
          <p className={styles.consoleEyebrow}>Change Orders</p>
          <h3 className={styles.consoleHeading}>{scopedProjectLabel}</h3>
          <p className={styles.consoleCopy}>
            Track project scope deltas, preserve revision history, and carry approved CO values into
            billing.
          </p>
        </div>
      </section>

      <section className={styles.viewer}>
        <div className={styles.viewerHeader}>
          <div className={styles.viewerHeaderRow}>
            <h3>Estimate-linked Revisions</h3>
            <button
              type="button"
              className={collapseButtonStyles.collapseButton}
              onClick={() => setIsViewerExpanded((current) => !current)}
              aria-expanded={isViewerExpanded}
            >
              {isViewerExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
          <p>
            Select an approved origin estimate on the left. Change-order families are grouped by
            that origin anchor.
          </p>
        </div>
        {isViewerExpanded ? (projectEstimates.length > 0 ? (
          <div className={styles.viewerGrid}>
            <div className={styles.viewerRail}>
              <div className={styles.viewerRailHeader}>
                <span className={styles.viewerRailHeading}>Origin Estimates</span>
              </div>
              {projectEstimates.map((estimate) => {
                const active = String(estimate.id) === selectedViewerEstimateId;
                const baselineStatus = estimateFinancialBaselineStatus(estimate);
                const relatedCount = changeOrders.filter(
                  (changeOrder) => changeOrder.origin_estimate === estimate.id,
                ).length;
                return (
                  <div key={estimate.id} className={styles.viewerRailEntry}>
                    <button
                      type="button"
                      className={`${styles.viewerRailItem} ${active ? styles.viewerRailItemActive : ""}`}
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
                          Estimate #{estimate.id} · v{estimate.version} · History: {relatedCount} COs
                        </span>
                      </span>
                      {baselineStatus !== "none" ? (
                        <span
                          className={`${changeOrderComposerStyles.viewerBaselineBadge} ${
                            baselineStatus === "active"
                              ? changeOrderComposerStyles.viewerBaselineBadgeActive
                              : changeOrderComposerStyles.viewerBaselineBadgeSuperseded
                          }`}
                        >
                          {financialBaselineLabel(baselineStatus)}
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
                        Open Original Estimate <span aria-hidden="true">↗</span>
                      </Link>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {selectedViewerEstimate ? (
              <div className={styles.viewerDetail}>
                <p
                  className={`${styles.viewerBaselineHint} ${
                    selectedViewerEstimateIsActiveBaseline
                      ? styles.viewerBaselineHintActive
                      : styles.viewerBaselineHintWarning
                  }`}
                >
                  {selectedViewerEstimateIsActiveBaseline
                    ? `This origin estimate (#${selectedViewerEstimate.id} v${selectedViewerEstimate.version}) is the active estimate for this project.`
                    : activeFinancialBaselineEstimate
                      ? `This origin estimate is not the active estimate. Current active estimate is #${activeFinancialBaselineEstimate.id} v${activeFinancialBaselineEstimate.version}.`
                      : "This project currently has no active estimate."}
                </p>
                {viewerChangeOrders.length > 0 ? (
                  <>
                    <h4 className={styles.viewerSectionHeading}>Linked Change Orders</h4>
                    <div className={`${styles.viewerRail} ${styles.viewerHistoryRail}`}>
                      {viewerChangeOrders.map((changeOrder) => {
                        const active = String(changeOrder.id) === selectedChangeOrderId;
                        const lastStatusEvent = lastStatusEventForChangeOrder(changeOrder.id);
                        return (
                          <div key={changeOrder.id} className={styles.viewerHistoryCardWrap}>
                            {changeOrder.public_ref ? (
                              <Link
                                href={publicChangeOrderHref(changeOrder.public_ref)}
                                className={styles.viewerHistoryPublicLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Open public view for ${coLabel(changeOrder)}`}
                                title="Open public view"
                              >
                                Public
                              </Link>
                            ) : null}
                            <button
                              type="button"
                              className={`${styles.viewerRailItem} ${styles.viewerHistoryItem} ${viewerHistoryStatusClass(changeOrder.status)} ${
                                active ? `${styles.viewerRailItemActive} ${styles.viewerHistoryItemActive}` : ""
                              }`}
                              onClick={() => {
                                hydrateEditForm(changeOrder);
                              }}
                            >
                              <span className={styles.viewerRailTitle}>
                                {coLabel(changeOrder)} {changeOrder.title}
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
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {selectedViewerChangeOrder ? (
                      <>
                        {quickStatusOptions.length > 0 ? (
                          <div className={styles.quickStatusPanel}>
                            <span className={composerStyles.lifecycleFieldLabel}>Next status</span>
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
                                    {quickStatusControlLabel(status)}
                                  </button>
                                );
                              })}
                            </div>
                            <div className={`${composerStyles.lifecycleActions} ${styles.viewerStatusActionRow}`}>
                              <button
                                type="button"
                                className={`${styles.viewerStatusActionButton} ${styles.viewerStatusActionButtonPrimary}`}
                                onClick={handleQuickUpdateStatus}
                                disabled={!canMutateChangeOrders || !quickStatusOptions.length}
                              >
                                Update CO Status
                              </button>
                              <button
                                type="button"
                                className={`${styles.viewerStatusActionButton} ${styles.viewerStatusActionButtonSecondary}`}
                                onClick={handleAddChangeOrderStatusNote}
                                disabled={!canMutateChangeOrders || !quickStatusNote.trim()}
                              >
                                Add CO Status Note
                              </button>
                            </div>
                            <label className={composerStyles.lifecycleField}>
                              Status note
                              <textarea
                                className={composerStyles.statusNote}
                                value={quickStatusNote}
                                onChange={(event) => setQuickStatusNote(event.target.value)}
                                placeholder="Optional note for this status action or history-only note."
                                rows={3}
                              />
                            </label>
                          </div>
                        ) : (
                          <div className={styles.quickStatusPanel}>
                            <label className={composerStyles.lifecycleField}>
                              Status note
                              <textarea
                                className={composerStyles.statusNote}
                                value={quickStatusNote}
                                onChange={(event) => setQuickStatusNote(event.target.value)}
                                placeholder="Add a note without changing status."
                                rows={3}
                              />
                            </label>
                            <div className={`${composerStyles.lifecycleActions} ${styles.viewerStatusActionRow}`}>
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
                        )}
                        <div className={styles.viewerEventPanel}>
                          <span className={styles.viewerMetaLabel}>Status events</span>
                          <p className={styles.viewerHint}>Newest first.</p>
                          {selectedChangeOrderStatusEvents.length > 0 ? (
                            <ul className={styles.viewerEventList}>
                              {selectedChangeOrderStatusEvents.slice(0, 6).map((event) => (
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
                          ) : (
                            <p className={styles.viewerHint}>No status events recorded for this change order yet.</p>
                          )}
                        </div>
                        {selectedViewerChangeOrder.line_items.length > 0 ? (
                          <div className={styles.lineTableWrap}>
                            <table className={styles.lineTable}>
                              <caption className={styles.lineTableCaption}>
                                Budget-line context for this revision. Money columns are USD flat amounts;
                                schedule delta is calendar days.
                              </caption>
                              <thead>
                                <tr>
                                  <th>Type</th>
                                  <th>Adjustment reason</th>
                                  <th>Budget line</th>
                                  <th>CO line note</th>
                                  <th>CO line delta ($)</th>
                                  <th>Original approved line item amount ($)</th>
                                  <th>Approved CO delta ($)</th>
                                  <th>Current working budget ($)</th>
                                  <th>Schedule delta (days)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedViewerChangeOrder.line_items.map((line) => (
                                  <tr key={line.id}>
                                    <td>{line.line_type === "adjustment" ? "Adjustment" : "Scope"}</td>
                                    <td>{line.adjustment_reason || "—"}</td>
                                    <td>
                                      #{line.budget_line} {line.budget_line_cost_code}
                                    </td>
                                    <td>{line.description || line.budget_line_description}</td>
                                    <td>${line.amount_delta}</td>
                                    <td>${originalApprovedAmountForLine(String(line.budget_line))}</td>
                                    <td>${approvedChangeOrderDeltaForLine(String(line.budget_line))}</td>
                                    <td>${currentWorkingAmountForLine(String(line.budget_line))}</td>
                                    <td>{line.days_delta}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p>No line items yet on this change order.</p>
                        )}
                        <div className={styles.viewerMetaRow}>
                          <span className={styles.viewerMetaLabel}>Line delta total</span>
                          <strong>${selectedViewerChangeOrder.line_total_delta}</strong>
                        </div>
                        <div className={styles.viewerMetaRow}>
                          <span className={styles.viewerMetaLabel}>Working total pre-approval (this CO)</span>
                          <strong>${selectedViewerWorkingTotals.preApproval}</strong>
                        </div>
                        <div className={styles.viewerMetaRow}>
                          <span className={styles.viewerMetaLabel}>Working total post-approval (this CO)</span>
                          <strong>${selectedViewerWorkingTotals.postApproval}</strong>
                        </div>
                        <p className={styles.viewerHint}>
                          Post-approval total = pre-approval total + this CO line delta.
                        </p>
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

      <div className={styles.formToolbar}>
        <div className={styles.formContext}>
          <span className={styles.formContextLabel}>Editing</span>
          <div className={styles.formContextValueRow}>
            <strong>{workspaceContext}</strong>
            <span className={`${styles.editStatusBadge} ${workspaceBadgeClass}`}>
              {workspaceBadgeLabel}
            </span>
          </div>
          <p className={styles.formContextHint}>
            Add New Change Order opens a fresh draft workspace. Clone as New Revision copies the selected change order into a new draft revision.
          </p>
        </div>
        <div className={styles.formToolbarActions}>
          {selectedViewerChangeOrder?.is_latest_revision ? (
            <button
              type="button"
              className={styles.cloneRevisionButton}
              onClick={handleCloneRevision}
              disabled={!canMutateChangeOrders}
            >
              Clone as New Revision
            </button>
          ) : null}
          <button
            type="button"
            className={styles.primaryCreateButton}
            onClick={handleStartNewChangeOrder}
          >
            Add New Change Order
          </button>
          {actionMessage && actionTone === "success" ? (
            <p className={`${composerStyles.actionSuccess} ${styles.toolbarFeedbackMessage}`}>
              {actionMessage}
            </p>
          ) : null}
        </div>
      </div>

      {!selectedChangeOrder ? (
        <div ref={createComposerRef}>
          <DocumentComposer
          adapter={changeOrderComposerAdapter}
          document={null}
          formState={createChangeOrderComposerFormState}
          className={`${composerStyles.sheet} ${changeOrderComposerStyles.workflowSheet} ${changeOrderComposerStyles.createSheet}`}
          sectionClassName={changeOrderComposerStyles.changeOrderComposerSection}
          onSubmit={handleCreateChangeOrder}
          sections={[{ slot: "context" }]}
          renderers={{
            context: () => (
              <>
                <div className={composerStyles.sheetHeader}>
                  <div className={composerStyles.fromBlock}>
                    <span className={composerStyles.blockLabel}>From</span>
                    <p className={composerStyles.blockText}>{senderName || "Your Company"}</p>
                    {senderEmail ? (
                      <p className={composerStyles.blockMuted}>{senderEmail}</p>
                    ) : null}
                    {senderAddressLines.length ? (
                      senderAddressLines.map((line, index) => (
                        <p key={`${line}-${index}`} className={composerStyles.blockMuted}>
                          {line}
                        </p>
                      ))
                    ) : (
                      <p className={composerStyles.blockMuted}>
                        Set sender address in Organization settings.
                      </p>
                    )}
                    <p className={composerStyles.blockMuted}>Prepared for approved estimate scope changes</p>
                  </div>
                  <div className={composerStyles.headerRight}>
                    <div className={composerStyles.logoBox}>
                      {senderLogoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={senderLogoUrl} alt="Organization logo" className={composerStyles.logoImage} />
                      ) : (
                        "Logo"
                      )}
                    </div>
                    <div className={composerStyles.sheetTitle}>Change Order</div>
                    <div className={composerStyles.blockMuted}>Project #{selectedProjectId || "—"}</div>
                  </div>
                </div>

                <div className={composerStyles.partyGrid}>
                  <label className={`${composerStyles.inlineField} ${changeOrderComposerStyles.coMetaField}`}>
                    <span className={changeOrderComposerStyles.coMetaLabel}>Title</span>
                    <input
                      className={`${composerStyles.fieldInput} ${changeOrderComposerStyles.coMetaInput}`}
                      value={newTitle}
                      onChange={(event) => {
                        setNewTitle(event.target.value);
                        setNewTitleManuallyEdited(true);
                      }}
                      required
                    />
                  </label>
                  <label className={`${composerStyles.inlineField} ${changeOrderComposerStyles.coMetaField} ${changeOrderComposerStyles.coFieldWide}`}>
                    <span className={changeOrderComposerStyles.coMetaLabel}>Reason</span>
                    <textarea
                      className={`${composerStyles.fieldInput} ${changeOrderComposerStyles.coMetaInput}`}
                      value={newReason}
                      onChange={(event) => setNewReason(event.target.value)}
                      rows={3}
                      placeholder="Describe why this change order is needed"
                    />
                  </label>
                </div>

                <div className={changeOrderComposerStyles.coLineSectionIntro}>
                  <h3>Line Items</h3>
                  <p>
                    {selectedViewerEstimate
                      ? `Starter rows come from estimate-derived lines for origin estimate #${selectedViewerEstimate.id} v${selectedViewerEstimate.version}.`
                      : "Starter rows come from estimate-derived lines once an origin estimate is selected."}
                  </p>
                  <p className={changeOrderComposerStyles.coLineLegend}>
                    Original approved line item amount is the approved baseline for the line before
                    approved CO deltas. CO Delta is a flat USD change (not a percent). Schedule Delta is
                    calendar days.
                  </p>
                </div>

                <div className={composerStyles.lineTable}>
                  <div className={changeOrderComposerStyles.coLineHeader}>
                    <span>Type</span>
                    <span>Adjustment reason</span>
                    <span>Budget line</span>
                    <span>CO line note</span>
                    <span>Original approved line item amount ($)</span>
                    <span>CO delta ($)</span>
                    <span>Schedule delta (days)</span>
                    <span>Actions</span>
                  </div>
                  {newLineItems.map((line, index) => {
                    const rowIssues = newLineValidation.issuesByLocalId.get(line.localId) ?? [];
                    const availableBudgetLines = budgetLines.filter((budgetLine) =>
                      line.lineType === "adjustment"
                        ? isGenericBudgetLine(budgetLine)
                        : !isGenericBudgetLine(budgetLine),
                    );
                    return (
                      <div key={line.localId} className={changeOrderComposerStyles.coLineRowGroup}>
                        <div
                          className={`${changeOrderComposerStyles.coLineRow} ${index % 2 === 1 ? changeOrderComposerStyles.coLineRowAlt : ""} ${
                            rowIssues.length ? changeOrderComposerStyles.coLineRowInvalid : ""
                          }`}
                        >
                          <select
                            className={composerStyles.lineSelect}
                            value={line.lineType}
                            onChange={(event) => {
                              const nextLineType = event.target.value as "scope" | "adjustment";
                              const selectedBudgetLine = budgetLineById.get(line.budgetLineId);
                              const selectedIsGeneric = isGenericBudgetLine(selectedBudgetLine);
                              const keepBudgetSelection = nextLineType === "adjustment"
                                ? selectedIsGeneric
                                : !selectedIsGeneric;
                              updateLine(setNewLineItems, line.localId, {
                                lineType: nextLineType,
                                adjustmentReason:
                                  nextLineType === "adjustment" ? line.adjustmentReason : "",
                                budgetLineId: keepBudgetSelection ? line.budgetLineId : "",
                              });
                            }}
                          >
                            <option value="scope">Scope</option>
                            <option value="adjustment">Adjustment</option>
                          </select>
                          <input
                            className={composerStyles.lineInput}
                            value={line.adjustmentReason}
                            placeholder={line.lineType === "adjustment" ? "Required reason" : "Not used for scope"}
                            onChange={(event) =>
                              updateLine(setNewLineItems, line.localId, { adjustmentReason: event.target.value })
                            }
                            disabled={line.lineType !== "adjustment"}
                          />
                          <select
                            className={composerStyles.lineSelect}
                            value={line.budgetLineId}
                            onChange={(event) =>
                              updateLine(setNewLineItems, line.localId, { budgetLineId: event.target.value })
                            }
                          >
                            <option value="">
                              {line.lineType === "adjustment" ? "Select adjustment bin" : "Select budget line"}
                            </option>
                            {availableBudgetLines.map((budgetLine) => (
                              <option key={budgetLine.id} value={budgetLine.id}>
                                #{budgetLine.id} {budgetLine.cost_code_code} - {budgetLine.description}
                              </option>
                            ))}
                          </select>
                          <input
                            className={composerStyles.lineInput}
                            value={line.description}
                            placeholder={
                              line.lineType === "adjustment"
                                ? "Optional adjustment note"
                                : "Optional CO scope note"
                            }
                            onChange={(event) =>
                              updateLine(setNewLineItems, line.localId, { description: event.target.value })
                            }
                          />
                          <span className={changeOrderComposerStyles.coReadValue}>${originalApprovedAmountForLine(line.budgetLineId)}</span>
                          <input
                            className={composerStyles.lineInput}
                            value={line.amountDelta}
                            placeholder="0.00 (USD)"
                            onChange={(event) =>
                              updateLine(setNewLineItems, line.localId, { amountDelta: event.target.value })
                            }
                            inputMode="decimal"
                          />
                          <input
                            className={composerStyles.lineInput}
                            value={line.daysDelta}
                            placeholder="0 days"
                            onChange={(event) =>
                              updateLine(setNewLineItems, line.localId, { daysDelta: event.target.value })
                            }
                            inputMode="numeric"
                          />
                          <button
                            type="button"
                            className={composerStyles.smallButton}
                            onClick={() => removeLine(setNewLineItems, newLineItems, line.localId)}
                          >
                            Remove
                          </button>
                        </div>
                        {rowIssues.length ? (
                          <p className={changeOrderComposerStyles.coLineIssue}>
                            Row {index + 1}: {rowIssues.join(" ")}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className={changeOrderComposerStyles.coLineActions}>
                  <button
                    type="button"
                    className={`${composerStyles.secondaryButton} ${changeOrderComposerStyles.coLineAddButton}`}
                    onClick={() => addLine(setNewLineItems)}
                  >
                    Add Line Item
                  </button>
                </div>

                <div className={changeOrderComposerStyles.coSheetFooter}>
                  <div className={`${composerStyles.summary} ${changeOrderComposerStyles.coSummaryCard}`}>
                    <div className={composerStyles.summaryRow}>
                      <span>Original total</span>
                      <span className={changeOrderComposerStyles.coSummarySecondaryValue}>
                        {originalEstimateTotal ? `$${originalEstimateTotal}` : "—"}
                      </span>
                    </div>
                    <div className={composerStyles.summaryRow}>
                      <span>Current total (accepted)</span>
                      <span className={changeOrderComposerStyles.coSummarySecondaryValue}>
                        {currentAcceptedTotal ? `$${currentAcceptedTotal}` : "—"}
                      </span>
                    </div>
                    <div className={composerStyles.summaryRow}>
                      <span className={changeOrderComposerStyles.coSummaryPrimaryLabel}>Cost delta ($)</span>
                      <strong>{formatMoney(newLineDeltaTotal)}</strong>
                    </div>
                    <div className={composerStyles.summaryRow}>
                      <span className={changeOrderComposerStyles.coSummaryPrimaryLabel}>Time delta (days)</span>
                      <strong>{newLineDaysTotal}</strong>
                    </div>
                  </div>
                  <div className={changeOrderComposerStyles.coSheetFooterActions}>
                    {!selectedViewerEstimateId ? (
                      <p className={`${composerStyles.inlineHint} ${changeOrderComposerStyles.coFooterHint}`}>
                        Select an approved origin estimate from the history selector before creating a change
                        order.
                      </p>
                    ) : null}
                    {selectedViewerEstimateId && newLineValidation.issues.length ? (
                      <p className={`${composerStyles.inlineHint} ${changeOrderComposerStyles.coFooterHint} ${changeOrderComposerStyles.coFooterErrorHint}`}>
                        Line-level issues are highlighted inline. Fix them before creating this draft.
                      </p>
                    ) : null}
                    <div className={changeOrderComposerStyles.coActionButtonRow}>
                      <button
                        type="submit"
                        className={`${composerStyles.primaryButton} ${changeOrderComposerStyles.coFooterPrimaryButton}`}
                        disabled={isCreateSubmitDisabled}
                      >
                        Create Change Order
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ),
          }}
          />
        </div>
      ) : null}

      {selectedChangeOrder ? (
        <DocumentComposer
          adapter={changeOrderComposerAdapter}
          document={selectedChangeOrder}
          formState={editChangeOrderComposerFormState}
          className={`${composerStyles.sheet} ${changeOrderComposerStyles.workflowSheet} ${changeOrderComposerStyles.editSheet} ${!isSelectedChangeOrderEditable ? changeOrderComposerStyles.editSheetLocked : ""}`}
          sectionClassName={changeOrderComposerStyles.changeOrderComposerSection}
          onSubmit={handleUpdateChangeOrder}
          sections={[{ slot: "context" }]}
          renderers={{
            context: () => (
              <>
                <div className={composerStyles.sheetHeader}>
                  <div className={composerStyles.fromBlock}>
                    <span className={composerStyles.blockLabel}>From</span>
                    <p className={composerStyles.blockText}>{senderName || "Your Company"}</p>
                    {senderEmail ? (
                      <p className={composerStyles.blockMuted}>{senderEmail}</p>
                    ) : null}
                    {senderAddressLines.length ? (
                      senderAddressLines.map((line, index) => (
                        <p key={`${line}-${index}`} className={composerStyles.blockMuted}>
                          {line}
                        </p>
                      ))
                    ) : (
                      <p className={composerStyles.blockMuted}>
                        Set sender address in Organization settings.
                      </p>
                    )}
                  </div>
                  <div className={composerStyles.headerRight}>
                    <div className={composerStyles.logoBox}>
                      {senderLogoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={senderLogoUrl} alt="Organization logo" className={composerStyles.logoImage} />
                      ) : (
                        "Logo"
                      )}
                    </div>
                    <div className={composerStyles.sheetTitle}>Change Order Revision</div>
                  </div>
                </div>

                <div className={composerStyles.partyGrid}>
                  <label className={`${composerStyles.inlineField} ${changeOrderComposerStyles.coMetaField}`}>
                    <span className={changeOrderComposerStyles.coMetaLabel}>Title</span>
                    <input
                      className={`${composerStyles.fieldInput} ${changeOrderComposerStyles.coMetaInput} ${changeOrderComposerStyles.lockableControl}`}
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      disabled={!isSelectedChangeOrderEditable}
                      required
                    />
                  </label>
                  <label className={`${composerStyles.inlineField} ${changeOrderComposerStyles.coMetaField} ${changeOrderComposerStyles.coFieldWide}`}>
                    <span className={changeOrderComposerStyles.coMetaLabel}>Reason</span>
                    <textarea
                      className={`${composerStyles.fieldInput} ${changeOrderComposerStyles.coMetaInput} ${changeOrderComposerStyles.lockableControl}`}
                      value={editReason}
                      onChange={(event) => setEditReason(event.target.value)}
                      rows={3}
                      placeholder="Describe why this change order revision is needed"
                      disabled={!isSelectedChangeOrderEditable}
                    />
                  </label>
                </div>

                <div className={changeOrderComposerStyles.coLineSectionIntro}>
                  <h3>Line Items</h3>
                  <p>
                    These rows are budget-line anchored. Update flat USD deltas and schedule days for this
                    revision.
                  </p>
                  <p className={changeOrderComposerStyles.coLineLegend}>
                    Original approved line item amount is the approved baseline for the line before
                    approved CO deltas. CO Delta is a flat USD change (not a percent). Schedule Delta is
                    calendar days.
                  </p>
                </div>

                <div className={composerStyles.lineTable}>
                  <div className={changeOrderComposerStyles.coLineHeader}>
                    <span>Type</span>
                    <span>Adjustment reason</span>
                    <span>Budget line</span>
                    <span>CO line note</span>
                    <span>Original approved line item amount ($)</span>
                    <span>CO delta ($)</span>
                    <span>Schedule delta (days)</span>
                    <span>{isSelectedChangeOrderEditable ? "Actions" : ""}</span>
                  </div>
                  {editLineItems.map((line, index) => {
                    const rowIssues = editLineValidation.issuesByLocalId.get(line.localId) ?? [];
                    const availableBudgetLines = budgetLines.filter((budgetLine) =>
                      line.lineType === "adjustment"
                        ? isGenericBudgetLine(budgetLine)
                        : !isGenericBudgetLine(budgetLine),
                    );
                    return (
                      <div key={line.localId} className={changeOrderComposerStyles.coLineRowGroup}>
                        <div
                          className={`${changeOrderComposerStyles.coLineRow} ${index % 2 === 1 ? changeOrderComposerStyles.coLineRowAlt : ""} ${
                            rowIssues.length ? changeOrderComposerStyles.coLineRowInvalid : ""
                          }`}
                        >
                          <select
                            className={`${composerStyles.lineSelect} ${changeOrderComposerStyles.lockableControl}`}
                            value={line.lineType}
                            onChange={(event) => {
                              const nextLineType = event.target.value as "scope" | "adjustment";
                              const selectedBudgetLine = budgetLineById.get(line.budgetLineId);
                              const selectedIsGeneric = isGenericBudgetLine(selectedBudgetLine);
                              const keepBudgetSelection = nextLineType === "adjustment"
                                ? selectedIsGeneric
                                : !selectedIsGeneric;
                              updateLine(setEditLineItems, line.localId, {
                                lineType: nextLineType,
                                adjustmentReason:
                                  nextLineType === "adjustment" ? line.adjustmentReason : "",
                                budgetLineId: keepBudgetSelection ? line.budgetLineId : "",
                              });
                            }}
                            disabled={!isSelectedChangeOrderEditable}
                          >
                            <option value="scope">Scope</option>
                            <option value="adjustment">Adjustment</option>
                          </select>
                          <input
                            className={`${composerStyles.lineInput} ${changeOrderComposerStyles.lockableControl}`}
                            value={line.adjustmentReason}
                            placeholder={line.lineType === "adjustment" ? "Required reason" : "Not used for scope"}
                            onChange={(event) =>
                              updateLine(setEditLineItems, line.localId, { adjustmentReason: event.target.value })
                            }
                            disabled={!isSelectedChangeOrderEditable || line.lineType !== "adjustment"}
                          />
                          <select
                            className={`${composerStyles.lineSelect} ${changeOrderComposerStyles.lockableControl}`}
                            value={line.budgetLineId}
                            onChange={(event) =>
                              updateLine(setEditLineItems, line.localId, { budgetLineId: event.target.value })
                            }
                            disabled={!isSelectedChangeOrderEditable}
                          >
                            <option value="">
                              {line.lineType === "adjustment" ? "Select adjustment bin" : "Select budget line"}
                            </option>
                            {availableBudgetLines.map((budgetLine) => (
                              <option key={budgetLine.id} value={budgetLine.id}>
                                #{budgetLine.id} {budgetLine.cost_code_code} - {budgetLine.description}
                              </option>
                            ))}
                          </select>
                          <input
                            className={`${composerStyles.lineInput} ${changeOrderComposerStyles.lockableControl}`}
                            value={line.description}
                            placeholder={
                              line.lineType === "adjustment"
                                ? "Optional adjustment note"
                                : "Optional CO scope note"
                            }
                            onChange={(event) =>
                              updateLine(setEditLineItems, line.localId, { description: event.target.value })
                            }
                            disabled={!isSelectedChangeOrderEditable}
                          />
                          <span className={changeOrderComposerStyles.coReadValue}>${originalApprovedAmountForLine(line.budgetLineId)}</span>
                          <input
                            className={`${composerStyles.lineInput} ${changeOrderComposerStyles.lockableControl}`}
                            value={line.amountDelta}
                            placeholder="0.00 (USD)"
                            onChange={(event) =>
                              updateLine(setEditLineItems, line.localId, { amountDelta: event.target.value })
                            }
                            inputMode="decimal"
                            disabled={!isSelectedChangeOrderEditable}
                          />
                          <input
                            className={`${composerStyles.lineInput} ${changeOrderComposerStyles.lockableControl}`}
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
                              className={composerStyles.smallButton}
                              onClick={() => removeLine(setEditLineItems, editLineItems, line.localId)}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                        {rowIssues.length ? (
                          <p className={changeOrderComposerStyles.coLineIssue}>
                            Row {index + 1}: {rowIssues.join(" ")}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {isSelectedChangeOrderEditable ? (
                  <div className={changeOrderComposerStyles.coLineActions}>
                    <button
                      type="button"
                      className={`${composerStyles.secondaryButton} ${changeOrderComposerStyles.coLineAddButton}`}
                      onClick={() => addLine(setEditLineItems)}
                    >
                      Add Line Item
                    </button>
                  </div>
                ) : null}

                <div className={changeOrderComposerStyles.coSheetFooter}>
                  <div className={`${composerStyles.summary} ${changeOrderComposerStyles.coSummaryCard}`}>
                    <div className={composerStyles.summaryRow}>
                      <span>Original total</span>
                      <span className={changeOrderComposerStyles.coSummarySecondaryValue}>
                        {originalEstimateTotal ? `$${originalEstimateTotal}` : "—"}
                      </span>
                    </div>
                    <div className={composerStyles.summaryRow}>
                      <span>Current total (accepted)</span>
                      <span className={changeOrderComposerStyles.coSummarySecondaryValue}>
                        {currentAcceptedTotal ? `$${currentAcceptedTotal}` : "—"}
                      </span>
                    </div>
                    <div className={composerStyles.summaryRow}>
                      <span className={changeOrderComposerStyles.coSummaryPrimaryLabel}>Cost delta ($)</span>
                      <strong>{formatMoney(editLineDeltaTotal)}</strong>
                    </div>
                    <div className={composerStyles.summaryRow}>
                      <span className={changeOrderComposerStyles.coSummaryPrimaryLabel}>Time delta (days)</span>
                      <strong>{editLineDaysTotal}</strong>
                    </div>
                  </div>
                  <div className={changeOrderComposerStyles.coSheetFooterActions}>
                    {isSelectedChangeOrderEditable && editLineValidation.issues.length ? (
                      <p className={`${composerStyles.inlineHint} ${changeOrderComposerStyles.coFooterHint} ${changeOrderComposerStyles.coFooterErrorHint}`}>
                        Line-level issues are highlighted inline. Fix them before saving this revision.
                      </p>
                    ) : null}
                    {selectedChangeOrder && !selectedChangeOrder.is_latest_revision ? (
                      <p className={`${composerStyles.inlineHint} ${changeOrderComposerStyles.coFooterHint} ${changeOrderComposerStyles.coFooterErrorHint}`}>
                        This revision is historical and read-only. Save/update actions are available on the latest revision only.
                      </p>
                    ) : null}
                    {selectedChangeOrder && selectedChangeOrder.status !== "draft" ? (
                      <p className={`${composerStyles.inlineHint} ${changeOrderComposerStyles.coFooterHint} ${changeOrderComposerStyles.coFooterErrorHint}`}>
                        This revision is no longer in Draft. Content fields are locked after send/decision. Clone a new revision to edit.
                      </p>
                    ) : null}
                    {isSelectedChangeOrderEditable ? (
                      <div className={changeOrderComposerStyles.coActionButtonRow}>
                        <button
                          type="submit"
                          className={`${composerStyles.primaryButton} ${changeOrderComposerStyles.coFooterPrimaryButton}`}
                          disabled={isEditSubmitDisabled}
                        >
                          Save Change Order
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            ),
          }}
        />
      ) : null}
    </section>
  );
}
