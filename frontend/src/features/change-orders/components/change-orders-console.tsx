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

const CHANGE_ORDER_STATUS_FALLBACK = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "void",
];

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
  const [projectEstimates, setProjectEstimates] = useState<
    Array<{ id: number; title: string; version: number }>
  >([]);
  const [nextLineLocalId, setNextLineLocalId] = useState(2);
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [activeFormMode, setActiveFormMode] = useState<"create" | "edit">("create");

  const [newTitle, setNewTitle] = useState("Change Order");
  const [newTitleManuallyEdited, setNewTitleManuallyEdited] = useState(false);
  const [newReason, setNewReason] = useState("");
  const [newOriginEstimateId, setNewOriginEstimateId] = useState("");
  const [newLineItems, setNewLineItems] = useState<ChangeOrderLineInput[]>([emptyLine(1)]);

  const [editTitle, setEditTitle] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editStatus, setEditStatus] = useState("draft");
  const [editLineItems, setEditLineItems] = useState<ChangeOrderLineInput[]>([emptyLine(1)]);
  const [quickStatus, setQuickStatus] = useState("pending_approval");
  const [changeOrderStatuses, setChangeOrderStatuses] = useState<string[]>(
    CHANGE_ORDER_STATUS_FALLBACK,
  );
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
  const viewerChangeOrders = useMemo(() => {
    if (!selectedViewerEstimateId) {
      return [] as ChangeOrderRecord[];
    }
    const originEstimateId = Number(selectedViewerEstimateId);
    return changeOrders.filter((changeOrder) => changeOrder.origin_estimate === originEstimateId);
  }, [changeOrders, selectedViewerEstimateId]);
  const selectedViewerChangeOrder =
    viewerChangeOrders.find((changeOrder) => String(changeOrder.id) === selectedChangeOrderId) ??
    viewerChangeOrders[0] ??
    null;
  const totalChangeOrderCount = changeOrders.length;
  const approvedChangeOrderCount = changeOrders.filter(
    (changeOrder) => changeOrder.status === "approved",
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
  const editLineDeltaTotal = useMemo(
    () =>
      editLineItems.reduce((sum, line) => sum + toNumber(line.amountDelta), 0),
    [editLineItems],
  );
  const newHeaderDelta = newLineDeltaTotal;
  const newLineDaysTotal = useMemo(
    () => newLineItems.reduce((sum, line) => sum + Math.trunc(toNumber(line.daysDelta)), 0),
    [newLineItems],
  );
  const editHeaderDelta = editLineDeltaTotal;
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
  const editStatusOptions = useMemo(() => {
    if (!selectedChangeOrder) {
      return changeOrderStatuses;
    }
    const allowed = changeOrderAllowedTransitions[selectedChangeOrder.status] ?? [];
    const values = [selectedChangeOrder.status, ...allowed.filter((status) => status !== selectedChangeOrder.status)];
    return values.filter((status) => changeOrderStatuses.includes(status));
  }, [changeOrderAllowedTransitions, changeOrderStatuses, selectedChangeOrder]);

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
  const hydrateEditForm = useCallback((changeOrder: ChangeOrderRecord | undefined) => {
    if (!changeOrder) {
      setSelectedChangeOrderId("");
      setEditTitle("");
      setEditReason("");
      setEditStatus("draft");
      setEditLineItems([emptyLine(1)]);
      setNextLineLocalId(2);
      setQuickStatus(changeOrderAllowedTransitions.draft?.[0] ?? "pending_approval");
      return;
    }

    setSelectedChangeOrderId(String(changeOrder.id));
    setEditTitle(changeOrder.title);
    setEditReason(changeOrder.reason);
    setEditStatus(changeOrder.status);
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
      setChangeOrderStatuses(contract.statuses);
      setChangeOrderStatusLabels({
        ...CHANGE_ORDER_STATUS_LABELS_FALLBACK,
        ...(contract.status_labels || {}),
      });
      setChangeOrderAllowedTransitions(normalizedTransitions);
      setEditStatus((current) =>
        contract.statuses.includes(current)
          ? current
          : contract.default_create_status || contract.statuses[0] || "draft",
      );
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
      const preferredEstimateId =
        initialOriginEstimateId && approvedRows.some((estimate) => estimate.id === initialOriginEstimateId)
          ? String(initialOriginEstimateId)
          : "";
      setProjectEstimates(approvedRows);
      setNewOriginEstimateId((current) => {
        if (preferredEstimateId) {
          return preferredEstimateId;
        }
        if (current && approvedRows.some((estimate) => String(estimate.id) === current)) {
          return current;
        }
        return approvedRows[0] ? String(approvedRows[0].id) : "";
      });
      setSelectedViewerEstimateId((current) => {
        if (preferredEstimateId) {
          return preferredEstimateId;
        }
        if (current && approvedRows.some((estimate) => String(estimate.id) === current)) {
          return current;
        }
        return approvedRows[0] ? String(approvedRows[0].id) : "";
      });
    } catch {
      setProjectEstimates([]);
      setNewOriginEstimateId("");
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
        if (!newTitleManuallyEdited) {
          setNewTitle(defaultChangeOrderTitle(nextProject.name || ""));
        }
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
    newTitleManuallyEdited,
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
    const projectId = Number(selectedProjectId);
    if (!projectId || !newOriginEstimateId || !/^\d+$/.test(newOriginEstimateId)) {
      return;
    }
    const sourceEstimateId = Number(newOriginEstimateId);
    void (async () => {
      const nextLines = await loadBudgetLines(projectId, sourceEstimateId);
      prefillNewLinesFromBudgetLines(nextLines);
    })();
  }, [loadBudgetLines, newOriginEstimateId, prefillNewLinesFromBudgetLines, selectedProjectId]);

  async function handleNewOriginEstimateChange(value: string) {
    setNewOriginEstimateId(value);
  }

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
    setActiveFormMode("create");
    const fallbackOriginEstimateId = projectEstimates[0] ? String(projectEstimates[0].id) : "";
    const nextOriginEstimateId =
      newOriginEstimateId && projectEstimates.some((estimate) => String(estimate.id) === newOriginEstimateId)
        ? newOriginEstimateId
        : fallbackOriginEstimateId;
    setNewTitleManuallyEdited(false);
    setNewTitle(defaultChangeOrderTitle(selectedProjectName));
    setNewReason("");
    setNewOriginEstimateId(nextOriginEstimateId);
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
            origin_estimate: newOriginEstimateId ? Number(newOriginEstimateId) : null,
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
      setFeedback(`Created change order CO-${created.number} (${statusLabel(created.status)}).`, "success");
      setNewLineItems([emptyLine(1)]);
      setNextLineLocalId(2);
      setNewOriginEstimateId(projectEstimates[0] ? String(projectEstimates[0].id) : "");
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
      setFeedback(`Created CO-${created.number} v${created.revision_number} in Draft.`, "success");
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
            status: editStatus,
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
        setFeedback(`Saved change order CO-${updated.number} (${statusLabel(updated.status)}).`, "success");
      } else {
        setChangeOrders((current) =>
          current.map((row) => (row.id === updated.id ? updated : row)),
        );
        hydrateEditForm(updated);
        setFeedback(`Saved change order CO-${updated.number} (${statusLabel(updated.status)}).`, "success");
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
      setFeedback(`Updated CO-${updated.number} to ${statusLabel(updated.status)}.`, "success");
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
          <p className={styles.consoleEyebrow}>Change Governance</p>
          <h3 className={styles.consoleHeading}>{scopedProjectLabel}</h3>
          <p className={styles.consoleCopy}>
            Track scope deltas, preserve revision history, and hand approved changes into billing.
          </p>
        </div>
        <div className={styles.consoleStats}>
          <article className={styles.consoleStatCard}>
            <span className={styles.consoleStatLabel}>Approved Estimates</span>
            <strong className={styles.consoleStatValue}>{projectEstimates.length}</strong>
          </article>
          <article className={styles.consoleStatCard}>
            <span className={styles.consoleStatLabel}>Change Orders</span>
            <strong className={styles.consoleStatValue}>{totalChangeOrderCount}</strong>
          </article>
          <article className={styles.consoleStatCard}>
            <span className={styles.consoleStatLabel}>Pending Approval</span>
            <strong className={styles.consoleStatValue}>{pendingChangeOrderCount}</strong>
          </article>
          <article className={styles.consoleStatCard}>
            <span className={styles.consoleStatLabel}>Approved</span>
            <strong className={styles.consoleStatValue}>{approvedChangeOrderCount}</strong>
          </article>
        </div>
      </section>

      <div className={styles.primaryCreateAction}>
        <button
          type="button"
          className={styles.primaryCreateButton}
          onClick={handleStartNewChangeOrder}
        >
          Add New Change Order
        </button>
      </div>

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
            Select an approved estimate, review its full revision family, and move statuses without
            leaving context.
          </p>
        </div>
        {isViewerExpanded ? (projectEstimates.length > 0 ? (
          <div className={styles.viewerGrid}>
            <div className={styles.viewerRail}>
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
                    onClick={() => setSelectedViewerEstimateId(String(estimate.id))}
                  >
                    <span className={styles.viewerRailTitle}>
                      #{estimate.id} v{estimate.version} {estimate.title}
                    </span>
                    <span className={styles.viewerMetaLabel}>
                      {relatedCount} {relatedCount === 1 ? "change order" : "change orders"}
                    </span>
                    <span className={`${styles.statusBadge} ${styles.statusApproved}`}>
                      {statusLabel("approved")}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedViewerEstimate ? (
              <div className={styles.viewerDetail}>
                <div className={styles.viewerMetaRow}>
                  <span className={styles.viewerMetaLabel}>Approved estimate</span>
                  <strong>
                    #{selectedViewerEstimate.id} v{selectedViewerEstimate.version}{" "}
                    {selectedViewerEstimate.title}
                  </strong>
                </div>
                {viewerChangeOrders.length > 0 ? (
                  <>
                    <div className={styles.viewerRail}>
                      {viewerChangeOrders.map((changeOrder) => {
                        const active = String(changeOrder.id) === selectedChangeOrderId;
                        return (
                          <button
                            key={changeOrder.id}
                            type="button"
                            className={`${styles.viewerRailItem} ${active ? styles.viewerRailItemActive : ""}`}
                            onClick={() => {
                              hydrateEditForm(changeOrder);
                              setActiveFormMode("edit");
                            }}
                          >
                            <span className={styles.viewerRailTitle}>
                              CO-{changeOrder.number} v{changeOrder.revision_number} {changeOrder.title}
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
                        <div className={styles.viewerMetaRow}>
                          <span className={styles.viewerMetaLabel}>Selected CO</span>
                          <strong>
                            CO-{selectedViewerChangeOrder.number} v{selectedViewerChangeOrder.revision_number}
                          </strong>
                        </div>
                        <div className={styles.viewerMetaRow}>
                          <span className={styles.viewerMetaLabel}>Supersedes</span>
                          <strong>
                            {selectedViewerChangeOrder.supersedes_change_order
                              ? `CO record #${selectedViewerChangeOrder.supersedes_change_order}`
                              : "Family root"}
                          </strong>
                        </div>
                        <div className={styles.viewerMetaRow}>
                          <span className={styles.viewerMetaLabel}>Header delta</span>
                          <strong>{selectedViewerChangeOrder.amount_delta}</strong>
                        </div>
                        <div className={styles.viewerMetaRow}>
                          <span className={styles.viewerMetaLabel}>Line delta total</span>
                          <strong>{selectedViewerChangeOrder.line_total_delta}</strong>
                        </div>
                        <div className={styles.quickStatusPanel}>
                          <span className={styles.viewerMetaLabel}>Quick status update</span>
                          <div className={styles.quickStatusPills}>
                            {quickStatusOptions.length > 0 ? (
                              quickStatusOptions.map((status) => {
                                const isSelected = quickStatus === status;
                                return (
                                  <button
                                    key={status}
                                    type="button"
                                    className={`${styles.quickStatusButton} ${
                                      isSelected ? styles.quickStatusButtonActive : ""
                                    } ${
                                      statusBadgeClass(status)
                                    }`}
                                    onClick={() => setQuickStatus(status)}
                                    aria-pressed={isSelected}
                                  >
                                    {statusLabel(status)}
                                  </button>
                                );
                              })
                            ) : (
                              <p className={styles.viewerHint}>No next statuses available.</p>
                            )}
                          </div>
                          <button
                            type="button"
                            className={styles.quickStatusSubmit}
                            onClick={handleQuickUpdateStatus}
                            disabled={!canMutateChangeOrders || !quickStatusOptions.length}
                          >
                            Update CO Status
                          </button>
                        </div>
                        <p
                          className={`${styles.reconcilePill} ${
                            selectedViewerChangeOrder.amount_delta !== selectedViewerChangeOrder.line_total_delta
                              ? styles.reconcileBad
                              : styles.reconcileGood
                          }`}
                        >
                          {selectedViewerChangeOrder.amount_delta !== selectedViewerChangeOrder.line_total_delta
                            ? "Line totals do not match header amount."
                            : "Line totals reconcile with header amount."}
                        </p>
                        {selectedViewerChangeOrder.is_latest_revision ? (
                          <button type="button" onClick={handleCloneRevision} disabled={!canMutateChangeOrders}>
                            Clone Revision
                          </button>
                        ) : (
                          <p className={styles.viewerHint}>Only latest revision can be cloned.</p>
                        )}
                        {selectedViewerChangeOrder.line_items.length > 0 ? (
                          <div className={styles.lineTableWrap}>
                            <table className={styles.lineTable}>
                              <thead>
                                <tr>
                                  <th>Budget line</th>
                                  <th>Description</th>
                                  <th>Line delta</th>
                                  <th>Base line amount</th>
                                  <th>Approved CO delta</th>
                                  <th>Current working</th>
                                  <th>Days</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedViewerChangeOrder.line_items.map((line) => (
                                  <tr key={line.id}>
                                    <td>
                                      #{line.budget_line} {line.budget_line_cost_code}
                                    </td>
                                    <td>{line.description || line.budget_line_description}</td>
                                    <td>{line.amount_delta}</td>
                                    <td>{originalApprovedAmountForLine(String(line.budget_line))}</td>
                                    <td>{approvedChangeOrderDeltaForLine(String(line.budget_line))}</td>
                                    <td>{currentWorkingAmountForLine(String(line.budget_line))}</td>
                                    <td>{line.days_delta}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p>No line items yet on this change order.</p>
                        )}
                      </>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.viewerHint}>No change orders yet for this approved estimate.</p>
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

      <div className={styles.formModeSwitch}>
        <button
          type="button"
          className={`${styles.formModeButton} ${
            activeFormMode === "create" ? styles.formModeButtonActive : ""
          }`}
          aria-pressed={activeFormMode === "create"}
          onClick={() => setActiveFormMode("create")}
        >
          Create Draft
        </button>
        <button
          type="button"
          className={`${styles.formModeButton} ${
            activeFormMode === "edit" ? styles.formModeButtonActive : ""
          }`}
          aria-pressed={activeFormMode === "edit"}
          onClick={() => setActiveFormMode("edit")}
          disabled={!selectedChangeOrderId}
        >
          Edit Selected
        </button>
      </div>

      {activeFormMode === "create" ? (
        <form
          className={`${estimateStyles.sheet} ${styles.workflowSheet} ${styles.createSheet}`}
          onSubmit={handleCreateChangeOrder}
        >
        <div className={estimateStyles.sheetHeader}>
          <div className={estimateStyles.fromBlock}>
            <span className={estimateStyles.blockLabel}>From</span>
            <p className={estimateStyles.blockText}>Your Company</p>
            <p className={estimateStyles.blockMuted}>Prepared for Change Governance</p>
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
            Origin estimate
            <select
              className={`${estimateStyles.fieldInput} ${styles.coMetaInput}`}
              value={newOriginEstimateId}
              onChange={(event) => void handleNewOriginEstimateChange(event.target.value)}
              required
            >
              {!projectEstimates.length ? (
                <option value="">No approved estimates available</option>
              ) : null}
              {projectEstimates.map((estimate) => (
                <option key={estimate.id} value={estimate.id}>
                  #{estimate.id} v{estimate.version} {estimate.title}
                </option>
              ))}
            </select>
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

        <div className={estimateStyles.lineTable}>
          <div className={styles.coLineHeader}>
            <span>Budget line</span>
            <span>Description</span>
            <span>Approved amount</span>
            <span>Amount delta</span>
            <span>Days delta</span>
            <span>Actions</span>
          </div>
          {newLineItems.map((line) => (
            <div key={line.localId} className={styles.coLineRow}>
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
                onChange={(event) =>
                  updateLine(setNewLineItems, line.localId, { description: event.target.value })
                }
              />
              <span className={styles.coReadValue}>
                ${originalApprovedAmountForLine(line.budgetLineId)}
              </span>
              <input
                className={estimateStyles.lineInput}
                value={line.amountDelta}
                onChange={(event) =>
                  updateLine(setNewLineItems, line.localId, { amountDelta: event.target.value })
                }
                inputMode="decimal"
              />
              <input
                className={estimateStyles.lineInput}
                value={line.daysDelta}
                onChange={(event) =>
                  updateLine(setNewLineItems, line.localId, { daysDelta: event.target.value })
                }
                inputMode="numeric"
              />
              <button
                type="button"
                className={estimateStyles.smallButton}
                onClick={() => removeLine(setNewLineItems, line.localId)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className={styles.coSheetFooter}>
          <button
            type="button"
            className={`${estimateStyles.secondaryButton} ${styles.coFooterSecondaryButton}`}
            onClick={() => addLine(setNewLineItems)}
          >
            Add Line Item
          </button>
          <div className={styles.coSheetFooterActions}>
            {!newOriginEstimateId ? (
              <p className={`${estimateStyles.inlineHint} ${styles.coFooterHint}`}>
                No approved estimates available. Approve an estimate before creating a change order.
              </p>
            ) : null}
            <button
              type="submit"
              className={`${estimateStyles.primaryButton} ${styles.coFooterPrimaryButton}`}
              disabled={!canMutateChangeOrders || !selectedProjectId || !newOriginEstimateId}
            >
              Create Change Order
            </button>
            <div className={estimateStyles.summary}>
              <div className={estimateStyles.summaryRow}>
                <span>Header delta</span>
                <strong>{formatMoney(newHeaderDelta)}</strong>
              </div>
              <div className={estimateStyles.summaryRow}>
                <span>Line delta total</span>
                <strong>{formatMoney(newLineDeltaTotal)}</strong>
              </div>
              <div className={estimateStyles.summaryRow}>
                <span>Header days delta</span>
                <strong>{newLineDaysTotal}</strong>
              </div>
              <p className={`${styles.reconcilePill} ${styles.reconcileGood}`}>
                Header totals are derived from line items.
              </p>
            </div>
          </div>
        </div>
        </form>
      ) : null}

      {activeFormMode === "edit" ? (
        <form
          className={`${estimateStyles.sheet} ${styles.workflowSheet} ${styles.editSheet}`}
          onSubmit={handleUpdateChangeOrder}
        >
        <div className={estimateStyles.sheetHeader}>
          <div className={estimateStyles.fromBlock}>
            <span className={estimateStyles.blockLabel}>Edit</span>
            <p className={estimateStyles.blockText}>
              {selectedChangeOrder
                ? `CO-${selectedChangeOrder.number} v${selectedChangeOrder.revision_number}`
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
            Status
            <select
              className={`${estimateStyles.fieldInput} ${styles.coMetaInput}`}
              value={editStatus}
              onChange={(event) => setEditStatus(event.target.value)}
            >
              {editStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
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

        <div className={estimateStyles.lineTable}>
          <div className={styles.coLineHeader}>
            <span>Budget line</span>
            <span>Description</span>
            <span>Approved amount</span>
            <span>Amount delta</span>
            <span>Days delta</span>
            <span>Actions</span>
          </div>
          {editLineItems.map((line) => (
            <div key={line.localId} className={styles.coLineRow}>
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
                onChange={(event) =>
                  updateLine(setEditLineItems, line.localId, { description: event.target.value })
                }
              />
              <span className={styles.coReadValue}>
                ${originalApprovedAmountForLine(line.budgetLineId)}
              </span>
              <input
                className={estimateStyles.lineInput}
                value={line.amountDelta}
                onChange={(event) =>
                  updateLine(setEditLineItems, line.localId, { amountDelta: event.target.value })
                }
                inputMode="decimal"
              />
              <input
                className={estimateStyles.lineInput}
                value={line.daysDelta}
                onChange={(event) =>
                  updateLine(setEditLineItems, line.localId, { daysDelta: event.target.value })
                }
                inputMode="numeric"
              />
              <button
                type="button"
                className={estimateStyles.smallButton}
                onClick={() => removeLine(setEditLineItems, line.localId)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className={styles.coSheetFooter}>
          <button
            type="button"
            className={`${estimateStyles.secondaryButton} ${styles.coFooterSecondaryButton}`}
            onClick={() => addLine(setEditLineItems)}
          >
            Add Line Item
          </button>
          <div className={styles.coSheetFooterActions}>
            <button
              type="submit"
              className={`${estimateStyles.primaryButton} ${styles.coFooterPrimaryButton}`}
              disabled={!canMutateChangeOrders || !selectedChangeOrderId}
            >
              Save Change Order
            </button>
            <div className={estimateStyles.summary}>
              <div className={estimateStyles.summaryRow}>
                <span>Header delta</span>
                <strong>{formatMoney(editHeaderDelta)}</strong>
              </div>
              <div className={estimateStyles.summaryRow}>
                <span>Line delta total</span>
                <strong>{formatMoney(editLineDeltaTotal)}</strong>
              </div>
              <div className={estimateStyles.summaryRow}>
                <span>Header days delta</span>
                <strong>{editLineDaysTotal}</strong>
              </div>
              <p className={`${styles.reconcilePill} ${styles.reconcileGood}`}>
                Header totals are derived from line items.
              </p>
            </div>
          </div>
        </div>
        </form>
      ) : null}
    </section>
  );
}
