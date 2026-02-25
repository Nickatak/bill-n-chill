"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
import estimateStyles from "../../estimates/components/estimates-console.module.css";

type ChangeOrderLineInput = {
  localId: number;
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

function readApiErrorMessage(payload: ApiResponse | undefined, fallback: string): string {
  const topLevelMessage = payload?.error?.message?.trim();
  if (topLevelMessage) {
    return topLevelMessage;
  }
  const fieldEntries = Object.entries(payload?.error?.fields ?? {});
  for (const [fieldName, fieldMessages] of fieldEntries) {
    if (!Array.isArray(fieldMessages)) {
      continue;
    }
    const firstFieldMessage = fieldMessages.find((message) => Boolean((message || "").trim()));
    if (firstFieldMessage) {
      return `${fieldName}: ${firstFieldMessage}`;
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
};

const CHANGE_ORDER_STATUS_LABELS_FALLBACK: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  void: "Void",
};

const CHANGE_ORDER_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, string[]> = {
  draft: ["pending_approval", "void"],
  pending_approval: ["draft", "approved", "rejected", "void"],
  approved: ["void"],
  rejected: ["draft", "void"],
  void: [],
};

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
  const [projectEstimates, setProjectEstimates] = useState<OriginEstimateRecord[]>([]);
  const [nextLineLocalId, setNextLineLocalId] = useState(2);
  const [selectedProjectName, setSelectedProjectName] = useState("");

  const [newTitle, setNewTitle] = useState("Change Order");
  const [newTitleManuallyEdited, setNewTitleManuallyEdited] = useState(false);
  const [newReason, setNewReason] = useState("");
  const [newLineItems, setNewLineItems] = useState<ChangeOrderLineInput[]>([emptyLine(1)]);

  const [editTitle, setEditTitle] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editLineItems, setEditLineItems] = useState<ChangeOrderLineInput[]>([emptyLine(1)]);
  const [quickStatus, setQuickStatus] = useState("pending_approval");
  const [changeOrderStatusLabels, setChangeOrderStatusLabels] = useState<
    Record<string, string>
  >(CHANGE_ORDER_STATUS_LABELS_FALLBACK);
  const [changeOrderAllowedTransitions, setChangeOrderAllowedTransitions] = useState<
    Record<string, string[]>
  >(CHANGE_ORDER_ALLOWED_STATUS_TRANSITIONS_FALLBACK);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const canMutateChangeOrders = hasAnyRole(role, ["owner", "pm"]);
  const scopedProjectId = scopedProjectIdProp;
  const initialOriginEstimateId = initialOriginEstimateIdProp;
  const selectedChangeOrder =
    changeOrders.find((row) => String(row.id) === selectedChangeOrderId) ?? null;
  const selectedViewerEstimate =
    projectEstimates.find((estimate) => String(estimate.id) === selectedViewerEstimateId) ?? null;
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
  const totalChangeOrderCount = changeOrders.length;
  const draftChangeOrderCount = changeOrders.filter(
    (changeOrder) => changeOrder.status === "draft",
  ).length;
  const pendingChangeOrderCount = changeOrders.filter(
    (changeOrder) => changeOrder.status === "pending_approval",
  ).length;
  const scopedProjectLabel = selectedProjectId
    ? `Project #${selectedProjectId}${selectedProjectName ? ` · ${selectedProjectName}` : ""}`
    : "No project selected";
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
  const quickStatusOptions = selectedViewerChangeOrder
    ? changeOrderAllowedTransitions[selectedViewerChangeOrder.status] ?? []
    : [];
  const isCreateSubmitDisabled =
    !canMutateChangeOrders ||
    !selectedProjectId ||
    !selectedViewerEstimateId ||
    newLineValidation.issues.length > 0;
  const isEditSubmitDisabled =
    !canMutateChangeOrders ||
    !selectedChangeOrderId ||
    editLineValidation.issues.length > 0;

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

  function statusBadgeClass(status: string): string {
    const key = `status${status
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`;
    return styles[key] ?? "";
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
      return `v${estimate.version}, approved on ${dateLabel} by ${estimate.approved_by_email}`;
    }
    return `v${estimate.version}, approved on ${dateLabel}`;
  }

  const hydrateEditForm = useCallback((changeOrder: ChangeOrderRecord | undefined) => {
    if (!changeOrder) {
      setSelectedChangeOrderId("");
      setEditTitle("");
      setEditReason("");
      setEditLineItems([emptyLine(1)]);
      setNextLineLocalId(2);
      setQuickStatus(changeOrderAllowedTransitions.draft?.[0] ?? "pending_approval");
      return;
    }

    setSelectedChangeOrderId(String(changeOrder.id));
    setEditTitle(changeOrder.title);
    setEditReason(changeOrder.reason);
    const hydratedLines =
      changeOrder.line_items.length > 0
        ? changeOrder.line_items.map((line, index) => ({
            localId: index + 1,
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
    setQuickStatus(nextQuickStatuses[0] ?? changeOrder.status);
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
        (payload.data as Array<{ id: number; title: string; version: number; status?: string }>) ?? [];
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

  const prefillNewLinesFromBudgetLines = useCallback((lines: BudgetLineRecord[]) => {
    if (!lines.length) {
      setNewLineItems([emptyLine(1)]);
      setNextLineLocalId(2);
      return;
    }
    const mapped: ChangeOrderLineInput[] = lines.map((line, index) => ({
      localId: index + 1,
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
        setProjectEstimates([]);
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
    if (newTitleManuallyEdited) {
      return;
    }
    setNewTitle(defaultChangeOrderTitle(selectedProjectName));
  }, [newTitleManuallyEdited, selectedProjectName]);

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
        budget_line: Number(line.budgetLineId),
        description: line.description,
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
    const localId = nextLineLocalId;
    setNextLineLocalId((current) => current + 1);
    setter((current) => [...current, emptyLine(localId)]);
  }

  function removeLine(
    setter: LineSetter,
    localId: number,
  ) {
    setter((current) => (current.length > 1 ? current.filter((line) => line.localId !== localId) : current));
  }

  function handleStartNewChangeOrder() {
    hydrateEditForm(undefined);
    setNewTitleManuallyEdited(false);
    setNewTitle(defaultChangeOrderTitle(selectedProjectName));
    setNewReason("");
    if (budgetLines.length > 0) {
      prefillNewLinesFromBudgetLines(budgetLines);
    } else {
      setNewLineItems([emptyLine(1)]);
      setNextLineLocalId(2);
    }
    setFeedback("Ready for a new change order draft.", "info");
  }

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
            amount_delta: formatMoney(newLineDeltaTotal),
            days_delta: newLineDaysTotal,
            reason: newReason,
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
      } else {
        setChangeOrders((current) => [created, ...current]);
        hydrateEditForm(created);
      }
      setFeedback(`Created change order ${coLabel(created)} (${statusLabel(created.status)}).`, "success");
      setNewLineItems([emptyLine(1)]);
      setNextLineLocalId(2);
      setNewTitleManuallyEdited(false);
      setNewTitle(defaultChangeOrderTitle(selectedProjectName));
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
            amount_delta: formatMoney(editLineDeltaTotal),
            days_delta: editLineDaysTotal,
            reason: editReason,
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
        setFeedback(`Saved change order ${coLabel(updated)} (${statusLabel(updated.status)}).`, "success");
      } else {
        setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        hydrateEditForm(updated);
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

    setFeedback("");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/change-orders/${selectedViewerChangeOrder.id}/`,
        {
          method: "PATCH",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({ status: quickStatus }),
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
      } else {
        setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        hydrateEditForm(updated);
      }
      setFeedback(`Updated ${coLabel(updated)} to ${statusLabel(updated.status)}.`, "success");
    } catch {
      setFeedback("Could not reach change order detail endpoint.", "error");
    }
  }

  return (
    <section>
      {actionMessage ? (
        <p
          className={
            actionTone === "error"
              ? estimateStyles.actionError
              : actionTone === "success"
                ? estimateStyles.actionSuccess
                : estimateStyles.inlineHint
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
        <div className={styles.consoleStats}>
          <article className={styles.consoleStatCard}>
            <span className={styles.consoleStatLabel}>Approved Estimates (Origin)</span>
            <strong className={styles.consoleStatValue}>{projectEstimates.length}</strong>
          </article>
          <article className={styles.consoleStatCard}>
            <span className={styles.consoleStatLabel}>Draft Change Orders</span>
            <strong className={styles.consoleStatValue}>{draftChangeOrderCount}</strong>
          </article>
          <article className={styles.consoleStatCard}>
            <span className={styles.consoleStatLabel}>Sent for Approval</span>
            <strong className={styles.consoleStatValue}>{pendingChangeOrderCount}</strong>
          </article>
          <article className={styles.consoleStatCard}>
            <span className={styles.consoleStatLabel}>Total Change Orders</span>
            <strong className={styles.consoleStatValue}>{totalChangeOrderCount}</strong>
          </article>
        </div>
      </section>

      <section className={styles.viewer}>
        <div className={styles.viewerHeader}>
          <div className={styles.viewerHeaderRow}>
            <h3>Estimate-linked Revisions</h3>
            <button
              type="button"
              className={styles.viewerToggleButton}
              onClick={() => setIsViewerExpanded((current) => !current)}
              aria-expanded={isViewerExpanded}
            >
              {isViewerExpanded ? "Hide Viewer" : "Show Viewer"}
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
                <span className={styles.viewerRailSubheading}>
                  1) Select an approved origin estimate to scope the history.
                </span>
              </div>
              {projectEstimates.map((estimate) => {
                const active = String(estimate.id) === selectedViewerEstimateId;
                const relatedCount = changeOrders.filter(
                  (changeOrder) => changeOrder.origin_estimate === estimate.id,
                ).length;
                return (
                  <button
                    key={estimate.id}
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
                      <span className={styles.viewerRailVersion}>Estimate #{estimate.id}</span>
                    </span>
                    <span className={styles.viewerRailSubtext}>
                      {approvalMeta(estimate)}
                    </span>
                    <span className={styles.viewerMetaLabel}>
                      {relatedCount} CO history
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedViewerEstimate ? (
              <div className={styles.viewerDetail}>
                {viewerChangeOrders.length > 0 ? (
                  <>
                    <h4 className={styles.viewerSectionHeading}>2) Linked Change Order History</h4>
                    <p className={styles.viewerHint}>Oldest at top. Most recent is the bottom item.</p>
                    <div className={`${styles.viewerRail} ${styles.viewerHistoryRail}`}>
                      {viewerChangeOrders.map((changeOrder) => {
                        const active = String(changeOrder.id) === selectedChangeOrderId;
                        return (
                          <button
                            key={changeOrder.id}
                            type="button"
                            className={`${styles.viewerRailItem} ${styles.viewerHistoryItem} ${
                              active ? `${styles.viewerRailItemActive} ${styles.viewerHistoryItemActive}` : ""
                            }`}
                            onClick={() => {
                              hydrateEditForm(changeOrder);
                            }}
                          >
                            <span className={styles.viewerRailTitle}>
                              {coLabel(changeOrder)} {changeOrder.title}
                            </span>
                            <span className={`${styles.statusBadge} ${statusBadgeClass(changeOrder.status)}`}>
                              {statusLabel(changeOrder.status)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {selectedViewerChangeOrder ? (
                      <>
                        <div className={styles.quickStatusPanel}>
                          <span className={estimateStyles.lifecycleFieldLabel}>Next status</span>
                          <div className={styles.quickStatusPills}>
                            {quickStatusOptions.length > 0 ? (
                              quickStatusOptions.map((status) => {
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
                              })
                            ) : (
                              <p className={styles.viewerHint}>No next statuses available.</p>
                            )}
                          </div>
                          <div className={estimateStyles.lifecycleActions}>
                            <button
                              type="button"
                              onClick={handleQuickUpdateStatus}
                              disabled={!canMutateChangeOrders || !quickStatusOptions.length}
                            >
                              Update CO Status
                            </button>
                          </div>
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
          {selectedChangeOrder ? (
            <>
              <span className={styles.formContextLabel}>Editing</span>
              <strong>{coLabel(selectedChangeOrder)}</strong>
            </>
          ) : (
            <>
              <span className={styles.formContextLabel}>Creating</span>
              <strong>New Change Order Draft</strong>
            </>
          )}
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
        </div>
      </div>

      {!selectedChangeOrder ? (
        <form
          className={`${estimateStyles.sheet} ${styles.workflowSheet} ${styles.createSheet}`}
          onSubmit={handleCreateChangeOrder}
        >
        <div className={estimateStyles.sheetHeader}>
          <div className={estimateStyles.fromBlock}>
            <span className={estimateStyles.blockLabel}>From</span>
            <p className={estimateStyles.blockText}>Your Company</p>
            <p className={estimateStyles.blockMuted}>Prepared for approved estimate scope changes</p>
          </div>
          <div className={estimateStyles.headerRight}>
            <div className={estimateStyles.sheetTitle}>Change Order</div>
            <div className={estimateStyles.blockMuted}>Project #{selectedProjectId || "—"}</div>
          </div>
        </div>

        <div className={estimateStyles.partyGrid}>
          <label className={`${estimateStyles.inlineField} ${styles.coMetaField}`}>
            Title
            <input
              className={`${estimateStyles.fieldInput} ${styles.coMetaInput}`}
              value={newTitle}
              onChange={(event) => {
                setNewTitle(event.target.value);
                setNewTitleManuallyEdited(true);
              }}
              required
            />
          </label>
          <label className={`${estimateStyles.inlineField} ${styles.coMetaField}`}>
            Origin estimate (from selector)
            <span className={estimateStyles.staticFieldValue}>
              {selectedViewerEstimate
                ? `#${selectedViewerEstimate.id} v${selectedViewerEstimate.version} ${selectedViewerEstimate.title}`
                : "No approved origin estimate selected"}
            </span>
          </label>
          <label className={`${estimateStyles.inlineField} ${styles.coMetaField} ${styles.coFieldWide}`}>
            Reason
            <textarea
              className={`${estimateStyles.fieldInput} ${styles.coMetaInput}`}
              value={newReason}
              onChange={(event) => setNewReason(event.target.value)}
              rows={3}
            />
          </label>
        </div>

        <div className={styles.coLineSectionIntro}>
          <h3>Line Items</h3>
          <p>
            {selectedViewerEstimate
              ? `Starter rows come from active budget lines linked to origin estimate #${selectedViewerEstimate.id} v${selectedViewerEstimate.version}.`
              : "Starter rows come from active project budget lines once an origin estimate is selected."}
          </p>
          <p className={styles.coLineLegend}>
            Original approved line item amount is the approved baseline for the line before
            approved CO deltas. CO Delta is a flat USD change (not a percent). Schedule Delta is
            calendar days.
          </p>
        </div>

        <div className={estimateStyles.lineTable}>
          <div className={styles.coLineHeader}>
            <span>Budget line</span>
            <span>CO line note</span>
            <span>Original approved line item amount ($)</span>
            <span>CO delta ($)</span>
            <span>Schedule delta (days)</span>
            <span>Actions</span>
          </div>
          {newLineItems.map((line, index) => {
            const rowIssues = newLineValidation.issuesByLocalId.get(line.localId) ?? [];
            return (
              <div key={line.localId} className={styles.coLineRowGroup}>
                <div
                  className={`${styles.coLineRow} ${index % 2 === 1 ? styles.coLineRowAlt : ""} ${
                    rowIssues.length ? styles.coLineRowInvalid : ""
                  }`}
                >
                  <select
                    className={estimateStyles.lineSelect}
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
                  <input
                    className={estimateStyles.lineInput}
                    value={line.description}
                    placeholder="Optional CO scope note"
                    onChange={(event) =>
                      updateLine(setNewLineItems, line.localId, { description: event.target.value })
                    }
                  />
                  <span className={styles.coReadValue}>${originalApprovedAmountForLine(line.budgetLineId)}</span>
                  <input
                    className={estimateStyles.lineInput}
                    value={line.amountDelta}
                    placeholder="0.00 (USD)"
                    onChange={(event) =>
                      updateLine(setNewLineItems, line.localId, { amountDelta: event.target.value })
                    }
                    inputMode="decimal"
                  />
                  <input
                    className={estimateStyles.lineInput}
                    value={line.daysDelta}
                    placeholder="0 days"
                    onChange={(event) =>
                      updateLine(setNewLineItems, line.localId, { daysDelta: event.target.value })
                    }
                    inputMode="numeric"
                  />
                  <button
                    type="button"
                    className={estimateStyles.smallButton}
                    onClick={() => removeLine(setNewLineItems, line.localId)}
                    disabled={newLineItems.length <= 1}
                  >
                    Remove
                  </button>
                </div>
                {rowIssues.length ? (
                  <p className={styles.coLineIssue}>
                    Row {index + 1}: {rowIssues.join(" ")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className={styles.coLineActions}>
          <button
            type="button"
            className={`${estimateStyles.secondaryButton} ${styles.coLineAddButton}`}
            onClick={() => addLine(setNewLineItems)}
          >
            Add Line Item
          </button>
        </div>

        <div className={styles.coSheetFooter}>
          <div className={`${estimateStyles.summary} ${styles.coSummaryCard}`}>
            <div className={estimateStyles.summaryRow}>
              <span>Line delta total</span>
              <strong>{formatMoney(newLineDeltaTotal)}</strong>
            </div>
            <div className={estimateStyles.summaryRow}>
              <span>Schedule delta total (days)</span>
              <strong>{newLineDaysTotal}</strong>
            </div>
            <p
              className={`${styles.reconcilePill} ${
                newLineValidation.issues.length ? styles.reconcileBad : styles.reconcileGood
              }`}
            >
              {newLineValidation.issues.length
                ? `Resolve ${newLineValidation.issues.length} validation issue(s) before submit.`
                : "Totals are derived from line items."}
            </p>
          </div>
          <div className={styles.coSheetFooterActions}>
            <div className={styles.coActionButtonRow}>
              <button
                type="submit"
                className={`${estimateStyles.primaryButton} ${styles.coFooterPrimaryButton}`}
                disabled={isCreateSubmitDisabled}
              >
                Create Change Order
              </button>
            </div>
            {!selectedViewerEstimateId ? (
              <p className={`${estimateStyles.inlineHint} ${styles.coFooterHint}`}>
                Select an approved origin estimate from the history selector before creating a change
                order.
              </p>
            ) : null}
            {selectedViewerEstimateId && newLineValidation.issues.length ? (
              <p className={`${estimateStyles.inlineHint} ${styles.coFooterHint} ${styles.coFooterErrorHint}`}>
                Line-level issues are highlighted inline. Fix them before creating this draft.
              </p>
            ) : null}
          </div>
        </div>
        </form>
      ) : null}

      {selectedChangeOrder ? (
        <form
          className={`${estimateStyles.sheet} ${styles.workflowSheet} ${styles.editSheet}`}
          onSubmit={handleUpdateChangeOrder}
        >
        <div className={estimateStyles.sheetHeader}>
          <div className={estimateStyles.fromBlock}>
            <span className={estimateStyles.blockLabel}>Edit</span>
            <p className={estimateStyles.blockText}>
              {selectedChangeOrder
                ? coLabel(selectedChangeOrder)
                : "No change order selected"}
            </p>
            <p className={estimateStyles.blockMuted}>
              {selectedChangeOrder ? `Project #${selectedProjectId}` : "Select from viewer above"}
            </p>
          </div>
          <div className={estimateStyles.headerRight}>
            <div className={estimateStyles.sheetTitle}>Change Order Revision</div>
            <div className={estimateStyles.blockMuted}>
              {selectedChangeOrder ? statusLabel(selectedChangeOrder.status) : "Draft"}
            </div>
          </div>
        </div>

        <div className={estimateStyles.partyGrid}>
          <label className={`${estimateStyles.inlineField} ${styles.coMetaField}`}>
            Title
            <input
              className={`${estimateStyles.fieldInput} ${styles.coMetaInput}`}
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              required
            />
          </label>
          <label className={`${estimateStyles.inlineField} ${styles.coMetaField}`}>
            Origin estimate
            <span className={estimateStyles.staticFieldValue}>
              {selectedChangeOrder?.origin_estimate
                ? `#${selectedChangeOrder.origin_estimate}${
                    selectedChangeOrder.origin_estimate_version
                      ? ` v${selectedChangeOrder.origin_estimate_version}`
                      : ""
                  }`
                : "No origin estimate linked"}
            </span>
          </label>
          <label className={`${estimateStyles.inlineField} ${styles.coMetaField} ${styles.coFieldWide}`}>
            Reason
            <textarea
              className={`${estimateStyles.fieldInput} ${styles.coMetaInput}`}
              value={editReason}
              onChange={(event) => setEditReason(event.target.value)}
              rows={3}
            />
          </label>
        </div>

        <div className={styles.coLineSectionIntro}>
          <h3>Line Items</h3>
          <p>
            These rows are budget-line anchored. Update flat USD deltas and schedule days for this
            revision.
          </p>
          <p className={styles.coLineLegend}>
            Original approved line item amount is the approved baseline for the line before
            approved CO deltas. CO Delta is a flat USD change (not a percent). Schedule Delta is
            calendar days.
          </p>
        </div>

        <div className={estimateStyles.lineTable}>
          <div className={styles.coLineHeader}>
            <span>Budget line</span>
            <span>CO line note</span>
            <span>Original approved line item amount ($)</span>
            <span>CO delta ($)</span>
            <span>Schedule delta (days)</span>
            <span>Actions</span>
          </div>
          {editLineItems.map((line, index) => {
            const rowIssues = editLineValidation.issuesByLocalId.get(line.localId) ?? [];
            return (
              <div key={line.localId} className={styles.coLineRowGroup}>
                <div
                  className={`${styles.coLineRow} ${index % 2 === 1 ? styles.coLineRowAlt : ""} ${
                    rowIssues.length ? styles.coLineRowInvalid : ""
                  }`}
                >
                  <select
                    className={estimateStyles.lineSelect}
                    value={line.budgetLineId}
                    onChange={(event) =>
                      updateLine(setEditLineItems, line.localId, { budgetLineId: event.target.value })
                    }
                  >
                    <option value="">Select budget line</option>
                    {budgetLines.map((budgetLine) => (
                      <option key={budgetLine.id} value={budgetLine.id}>
                        #{budgetLine.id} {budgetLine.cost_code_code} - {budgetLine.description}
                      </option>
                    ))}
                  </select>
                  <input
                    className={estimateStyles.lineInput}
                    value={line.description}
                    placeholder="Optional CO scope note"
                    onChange={(event) =>
                      updateLine(setEditLineItems, line.localId, { description: event.target.value })
                    }
                  />
                  <span className={styles.coReadValue}>${originalApprovedAmountForLine(line.budgetLineId)}</span>
                  <input
                    className={estimateStyles.lineInput}
                    value={line.amountDelta}
                    placeholder="0.00 (USD)"
                    onChange={(event) =>
                      updateLine(setEditLineItems, line.localId, { amountDelta: event.target.value })
                    }
                    inputMode="decimal"
                  />
                  <input
                    className={estimateStyles.lineInput}
                    value={line.daysDelta}
                    placeholder="0 days"
                    onChange={(event) =>
                      updateLine(setEditLineItems, line.localId, { daysDelta: event.target.value })
                    }
                    inputMode="numeric"
                  />
                  <button
                    type="button"
                    className={estimateStyles.smallButton}
                    onClick={() => removeLine(setEditLineItems, line.localId)}
                    disabled={editLineItems.length <= 1}
                  >
                    Remove
                  </button>
                </div>
                {rowIssues.length ? (
                  <p className={styles.coLineIssue}>
                    Row {index + 1}: {rowIssues.join(" ")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className={styles.coLineActions}>
          <button
            type="button"
            className={`${estimateStyles.secondaryButton} ${styles.coLineAddButton}`}
            onClick={() => addLine(setEditLineItems)}
          >
            Add Line Item
          </button>
        </div>

        <div className={styles.coSheetFooter}>
          <div className={`${estimateStyles.summary} ${styles.coSummaryCard}`}>
            <div className={estimateStyles.summaryRow}>
              <span>Line delta total</span>
              <strong>{formatMoney(editLineDeltaTotal)}</strong>
            </div>
            <div className={estimateStyles.summaryRow}>
              <span>Schedule delta total (days)</span>
              <strong>{editLineDaysTotal}</strong>
            </div>
            <p
              className={`${styles.reconcilePill} ${
                editLineValidation.issues.length ? styles.reconcileBad : styles.reconcileGood
              }`}
            >
              {editLineValidation.issues.length
                ? `Resolve ${editLineValidation.issues.length} validation issue(s) before save.`
                : "Totals are derived from line items."}
            </p>
          </div>
          <div className={styles.coSheetFooterActions}>
            <div className={styles.coActionButtonRow}>
              <button
                type="submit"
                className={`${estimateStyles.primaryButton} ${styles.coFooterPrimaryButton}`}
                disabled={isEditSubmitDisabled}
              >
                Save Change Order
              </button>
            </div>
            {editLineValidation.issues.length ? (
              <p className={`${estimateStyles.inlineHint} ${styles.coFooterHint} ${styles.coFooterErrorHint}`}>
                Line-level issues are highlighted inline. Fix them before saving this revision.
              </p>
            ) : null}
          </div>
        </div>
        </form>
      ) : null}
    </section>
  );
}
