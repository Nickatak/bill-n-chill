"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultApiBaseUrl,
  fetchEstimatePolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { loadClientSession } from "../../session/client-session";
import styles from "./estimates-console.module.css";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  formatDateInputFromIso,
  formatDateTimeDisplay,
} from "../../../shared/date-format";
import {
  ApiResponse,
  CostCode,
  EstimateLineInput,
  EstimateLineItemRecord,
  EstimatePolicyContract,
  EstimateRelatedChangeOrderRecord,
  EstimateRecord,
  EstimateStatusEventRecord,
  ProjectRecord,
} from "../types";
import { EstimateSheet } from "./estimate-sheet";

type LineSortKey = "quantity" | "costCode" | "unitCost" | "markupPercent" | "amount";
type EstimateStatusValue = string;
type EstimatesConsoleProps = {
  scopedProjectId?: number | null;
};

const ESTIMATE_STATUSES_FALLBACK: string[] = [
  "draft",
  "sent",
  "approved",
  "rejected",
  "void",
  "archived",
];
const ESTIMATE_STATUS_LABELS_FALLBACK: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
  void: "Void",
  archived: "Archived",
};
const ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK: string[] = [
  "draft",
  "sent",
  "approved",
  "rejected",
];
const ESTIMATE_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, EstimateStatusValue[]> = {
  draft: ["sent", "void", "archived"],
  sent: ["sent", "approved", "rejected", "void", "archived"],
  approved: [],
  rejected: ["void"],
  void: [],
  archived: [],
};
const ESTIMATE_QUICK_ACTION_BY_STATUS_FALLBACK: Record<string, "change_order" | "revision"> = {
  approved: "change_order",
  rejected: "revision",
  archived: "revision",
};

function emptyLine(localId: number, defaultCostCodeId = ""): EstimateLineInput {
  return {
    localId,
    costCodeId: defaultCostCodeId,
    description: "Scope item",
    quantity: "1",
    unit: "ea",
    unitCost: "0",
    markupPercent: "0",
  };
}

function mapEstimateLineItemsToInputs(items: EstimateLineItemRecord[] = []): EstimateLineInput[] {
  if (!items.length) {
    return [emptyLine(1)];
  }
  return items.map((item, index) => ({
    localId: index + 1,
    costCodeId: String(item.cost_code ?? ""),
    description: item.description || "",
    quantity: String(item.quantity ?? ""),
    unit: item.unit || "ea",
    unitCost: String(item.unit_cost ?? ""),
    markupPercent: String(item.markup_percent ?? ""),
  }));
}

export function EstimatesConsole({ scopedProjectId: scopedProjectIdProp = null }: EstimatesConsoleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState("");
  const [, setStatusMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);

  const [estimates, setEstimates] = useState<EstimateRecord[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState("");
  const [estimateStatuses, setEstimateStatuses] = useState<string[]>(ESTIMATE_STATUSES_FALLBACK);
  const [estimateStatusLabels, setEstimateStatusLabels] = useState<Record<string, string>>(
    ESTIMATE_STATUS_LABELS_FALLBACK,
  );
  const [estimateAllowedStatusTransitions, setEstimateAllowedStatusTransitions] = useState<
    Record<string, string[]>
  >(ESTIMATE_ALLOWED_STATUS_TRANSITIONS_FALLBACK);
  const [estimateQuickActionByStatus, setEstimateQuickActionByStatus] = useState<
    Record<string, "change_order" | "revision">
  >(ESTIMATE_QUICK_ACTION_BY_STATUS_FALLBACK);
  const [defaultCreateStatus, setDefaultCreateStatus] = useState("draft");
  const [selectedStatus, setSelectedStatus] = useState<EstimateStatusValue>("draft");
  const [statusNote, setStatusNote] = useState("");
  const [statusEvents, setStatusEvents] = useState<EstimateStatusEventRecord[]>([]);
  const [projectChangeOrders, setProjectChangeOrders] = useState<EstimateRelatedChangeOrderRecord[]>([]);

  const [estimateTitle, setEstimateTitle] = useState("Initial Estimate");
  const [taxPercent, setTaxPercent] = useState("0");
  const [lineItems, setLineItems] = useState<EstimateLineInput[]>([emptyLine(1)]);
  const [lineSortKey, setLineSortKey] = useState<LineSortKey | null>(null);
  const [lineSortDirection, setLineSortDirection] = useState<"asc" | "desc">("asc");
  const [nextLineId, setNextLineId] = useState(2);
  const [estimateDate, setEstimateDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitGuard = useRef(false);
  const [openFamilyHistory, setOpenFamilyHistory] = useState<Set<string>>(() => new Set());
  const [showDuplicatePanel, setShowDuplicatePanel] = useState(false);
  const [duplicateTitle, setDuplicateTitle] = useState("");
  const [isViewerExpanded, setIsViewerExpanded] = useState(true);
  const [defaultEstimateStatusFilters, setDefaultEstimateStatusFilters] = useState<string[]>(
    ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK,
  );
  const [estimateStatusFilters, setEstimateStatusFilters] = useState<EstimateStatusValue[]>(
    ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK,
  );

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const scopedProjectId = scopedProjectIdProp;
  const scopedEstimateIdParam = searchParams.get("estimate");
  const scopedEstimateId =
    scopedEstimateIdParam && /^\d+$/.test(scopedEstimateIdParam)
      ? Number(scopedEstimateIdParam)
      : null;
  const selectedProject =
    projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const selectedEstimate =
    estimates.find((estimate) => String(estimate.id) === selectedEstimateId) ?? null;
  const isEditingDraft = Boolean(selectedEstimate && selectedEstimate.status === "draft");
  const isReadOnly = Boolean(selectedEstimate && selectedEstimate.status !== "draft");
  const statusClasses: Record<string, string> = {
    draft: styles.statusDraft,
    sent: styles.statusSent,
    approved: styles.statusApproved,
    rejected: styles.statusRejected,
    void: styles.statusArchived,
    archived: styles.statusArchived,
  };
  const statusOptions: Array<{ value: EstimateStatusValue; label: string }> = estimateStatuses.map(
    (statusValue) => ({
      value: statusValue,
      label: estimateStatusLabels[statusValue] ?? statusValue,
    }),
  );
  const estimateStatusFilterValues = statusOptions.map((option) => option.value);
  const statusDisplayOptions = statusOptions;
  const statusLabelByValue = statusDisplayOptions.reduce<Record<string, string>>((labels, option) => {
    labels[option.value] = option.label;
    return labels;
  }, {});
  const nextStatusValues = selectedEstimate
    ? estimateAllowedStatusTransitions[selectedEstimate.status] ?? []
    : [];
  const nextStatusOptions = statusOptions
    .filter((option) => nextStatusValues.includes(option.value))
    .map((option) =>
      selectedEstimate?.status === "sent" && option.value === "sent"
        ? { ...option, label: "Re-send" }
        : option,
    );

  function formatEstimateStatus(status?: string): string {
    if (!status) {
      return "";
    }
    return statusLabelByValue[status] ?? status;
  }

  function formatStatusAction(event: EstimateStatusEventRecord): string {
    if (event.from_status === "sent" && event.to_status === "sent") {
      return "Re-sent";
    }
    const actionByStatus: Record<string, string> = {
      draft: "Created as Draft",
      sent: "Sent",
      approved: "Approved",
      rejected: "Rejected",
      void: "Voided",
      archived: "Archived",
    };
    return actionByStatus[event.to_status] ?? formatEstimateStatus(event.to_status);
  }

  function formatEventDate(dateValue: string): string {
    return formatDateTimeDisplay(dateValue, dateValue);
  }

  function formatEstimateLastActionDate(estimate: EstimateRecord): string {
    return formatEventDate(estimate.updated_at || estimate.created_at);
  }

  function toNumber(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function postEstimateWorkflowHref(estimateId: number): string {
    if (!selectedProjectId) {
      return "/projects";
    }
    const params = new URLSearchParams({
      project: selectedProjectId,
      estimate: String(estimateId),
    });
    return `/estimates/post-create?${params.toString()}`;
  }

  function quickActionKindForStatus(status: string): "change_order" | "revision" | null {
    return estimateQuickActionByStatus[status] ?? null;
  }

  function quickActionTitleForStatus(status: string): string {
    const kind = quickActionKindForStatus(status);
    if (kind === "change_order") {
      return "Start change-order workflow from this estimate";
    }
    if (kind === "revision") {
      return "Create revision from this estimate";
    }
    return "";
  }

  const loadEstimatePolicy = useCallback(async () => {
    try {
      const response = await fetchEstimatePolicyContract({
        baseUrl: normalizedBaseUrl,
        token,
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        return;
      }
      const contract = payload.data as EstimatePolicyContract;
      if (
        !Array.isArray(contract.statuses) ||
        !contract.statuses.length ||
        !contract.allowed_status_transitions
      ) {
        return;
      }
      const normalizedTransitions = contract.statuses.reduce<Record<string, string[]>>(
        (acc, statusValue) => {
          const nextStatuses = contract.allowed_status_transitions[statusValue];
          acc[statusValue] = Array.isArray(nextStatuses) ? nextStatuses : [];
          return acc;
        },
        {},
      );
      const nextDefaultCreateStatus =
        contract.default_create_status || contract.statuses[0] || ESTIMATE_STATUSES_FALLBACK[0];
      const nextDefaultFilters =
        Array.isArray(contract.default_status_filters) && contract.default_status_filters.length
          ? contract.default_status_filters.filter((value) => contract.statuses.includes(value))
          : ESTIMATE_DEFAULT_STATUS_FILTERS_FALLBACK.filter((value) => contract.statuses.includes(value));
      const resolvedDefaultFilters = nextDefaultFilters.length ? nextDefaultFilters : contract.statuses;

      setEstimateStatuses(contract.statuses);
      setEstimateStatusLabels({
        ...ESTIMATE_STATUS_LABELS_FALLBACK,
        ...(contract.status_labels || {}),
      });
      setEstimateAllowedStatusTransitions(normalizedTransitions);
      setEstimateQuickActionByStatus({
        ...ESTIMATE_QUICK_ACTION_BY_STATUS_FALLBACK,
        ...(contract.quick_action_by_status || {}),
      });
      setDefaultCreateStatus(nextDefaultCreateStatus);
      setDefaultEstimateStatusFilters(resolvedDefaultFilters);
      setEstimateStatusFilters((current) => {
        const retained = current.filter((value) => contract.statuses.includes(value));
        if (retained.length) {
          return retained;
        }
        return resolvedDefaultFilters;
      });
      setSelectedStatus((current) =>
        contract.statuses.includes(current) ? current : nextDefaultCreateStatus,
      );
    } catch {
      // Policy load is best-effort; static fallback remains active.
    }
  }, [normalizedBaseUrl, token]);

  async function cloneEstimateRevision(sourceEstimate: EstimateRecord) {
    const sourceWasSent = sourceEstimate.status === "sent";
    setStatusMessage("Cloning estimate version...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${sourceEstimate.id}/clone-version/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({}),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Clone failed.");
        return;
      }
      const cloned = payload.data as EstimateRecord;
      setEstimates((current) => {
        const updated = current.map((estimate) =>
          sourceWasSent && estimate.id === sourceEstimate.id
            ? { ...estimate, status: "rejected" }
            : estimate,
        );
        return [cloned, ...updated];
      });
      handleSelectEstimate(cloned);
      setStatusEvents([]);
      setStatusMessage(`Cloned estimate to version ${cloned.version}.`);
      setActionMessage("");
    } catch {
      setStatusMessage("Could not reach clone endpoint.");
    }
  }

  async function handleFamilyCardQuickAction(sourceEstimate: EstimateRecord) {
    const actionKind = quickActionKindForStatus(sourceEstimate.status);
    if (!actionKind) {
      return;
    }
    if (actionKind === "change_order") {
      if (!selectedProjectId) {
        setStatusMessage("Select a project first.");
        return;
      }
      router.push(`/projects/${selectedProjectId}/change-orders?origin_estimate=${sourceEstimate.id}`);
      return;
    }
    await cloneEstimateRevision(sourceEstimate);
  }

  const lineTotals = useMemo(
    () =>
      lineItems.map((line) => {
        const quantity = toNumber(line.quantity);
        const unitCost = toNumber(line.unitCost);
        const markup = toNumber(line.markupPercent);
        const base = quantity * unitCost;
        return base + base * (markup / 100);
      }),
    [lineItems],
  );

  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const taxRate = toNumber(taxPercent);
  const taxAmount = subtotal * (taxRate / 100);
  const totalAmount = subtotal + taxAmount;
  const estimateFamilies = useMemo(() => {
    const families = new Map<string, EstimateRecord[]>();
    for (const estimate of estimates) {
      const title = (estimate.title || "").trim() || "Untitled";
      const existing = families.get(title);
      if (existing) {
        existing.push(estimate);
      } else {
        families.set(title, [estimate]);
      }
    }
    return Array.from(families.entries())
      .map(([title, items]) => ({
        title,
        items: [...items].sort((a, b) => a.version - b.version),
      }))
      .sort((a, b) => {
        const latestA = a.items[a.items.length - 1];
        const latestB = b.items[b.items.length - 1];
        const lastActionA = new Date(latestA?.updated_at || latestA?.created_at || 0).getTime();
        const lastActionB = new Date(latestB?.updated_at || latestB?.created_at || 0).getTime();
        return lastActionB - lastActionA;
      });
  }, [estimates]);
  const visibleEstimateFamilies = useMemo(() => {
    if (estimateStatusFilters.length === 0) {
      return [];
    }
    return estimateFamilies.filter((family) => {
      const latest = family.items[family.items.length - 1];
      if (!latest?.status) {
        return false;
      }
      return estimateStatusFilters.includes(latest.status as EstimateStatusValue);
    });
  }, [estimateFamilies, estimateStatusFilters]);

  function formatMoney(value: number): string {
    return value.toFixed(2);
  }

  function publicEstimateHref(publicRef?: string): string {
    if (!publicRef) {
      return "";
    }
    return `/estimate/${publicRef}`;
  }

  function formatDateInput(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  const loadEstimateIntoForm = useCallback((estimate: EstimateRecord) => {
    setEstimateTitle(estimate.title || "Untitled");
    setTaxPercent(String(estimate.tax_percent ?? "0"));
    const mapped = mapEstimateLineItemsToInputs(estimate.line_items ?? []);
    setLineItems(mapped);
    setNextLineId(mapped.length + 1);
    const createdDate = formatDateInputFromIso(estimate.created_at);
    if (createdDate) {
      setEstimateDate(createdDate);
    }
  }, []);

  const handleSelectEstimate = useCallback((estimate: EstimateRecord) => {
    const nextEstimateId = String(estimate.id);
    const isSameEstimate = nextEstimateId === selectedEstimateId;
    setSelectedEstimateId(nextEstimateId);
    const nextStatuses = estimateAllowedStatusTransitions[estimate.status] ?? [];
    setSelectedStatus(nextStatuses[0] ?? estimate.status);
    if (!isSameEstimate) {
      setStatusEvents([]);
    }
    setLineSortKey(null);
    setLineSortDirection("asc");
    loadEstimateIntoForm(estimate);
    setDuplicateTitle(`${estimate.title || "Estimate"} Copy`);
  }, [estimateAllowedStatusTransitions, loadEstimateIntoForm, selectedEstimateId]);

  function startNewEstimate() {
    const defaultCostCodeId = costCodes[0] ? String(costCodes[0].id) : "";
    setIsViewerExpanded(false);
    setSelectedEstimateId("");
    setSelectedStatus(defaultCreateStatus);
    setStatusNote("");
    setStatusEvents([]);
    setEstimateTitle("New Estimate");
    setTaxPercent("0");
    setLineItems([emptyLine(1, defaultCostCodeId)]);
    setLineSortKey(null);
    setLineSortDirection("asc");
    setNextLineId(2);
    setEstimateDate("");
    setDueDate("");
    setShowDuplicatePanel(false);
    setActionMessage("");
  }

  function handleSelectFamilyLatest(title: string, latest: EstimateRecord) {
    handleSelectEstimate(latest);
    setOpenFamilyHistory((current) => {
      if (current.has(title)) {
        return new Set<string>();
      }
      return new Set<string>([title]);
    });
  }

  function toggleEstimateStatusFilter(nextStatus: EstimateStatusValue) {
    setEstimateStatusFilters((current) =>
      current.includes(nextStatus)
        ? current.filter((statusValue) => statusValue !== nextStatus)
        : estimateStatusFilterValues.filter(
            (statusValue) => statusValue === nextStatus || current.includes(statusValue),
          ),
    );
  }

  useEffect(() => {
    const session = loadClientSession();
    if (!session?.token) {
      setToken("");
      return;
    }
    setToken(session.token);
  }, []);

  useEffect(() => {
    if (estimateDate) {
      return;
    }
    const today = new Date();
    const due = new Date();
    due.setDate(due.getDate() + 14);
    setEstimateDate(formatDateInput(today));
    setDueDate(formatDateInput(due));
  }, [estimateDate]);

  const loadDependencies = useCallback(async () => {
    setStatusMessage("Loading projects and cost codes...");
    try {
      const [projectsRes, codesRes] = await Promise.all([
        fetch(`${normalizedBaseUrl}/projects/`, {
          headers: buildAuthHeaders(token),
        }),
        fetch(`${normalizedBaseUrl}/cost-codes/`, {
          headers: buildAuthHeaders(token),
        }),
      ]);

      const projectsJson: ApiResponse = await projectsRes.json();
      const codesJson: ApiResponse = await codesRes.json();

      if (!projectsRes.ok || !codesRes.ok) {
        setStatusMessage("Failed loading dependencies.");
        return;
      }

      const projectRows = (projectsJson.data as ProjectRecord[]) ?? [];
      const codeRows = ((codesJson.data as CostCode[]) ?? []).filter((code) => code.is_active);
      setProjects(projectRows);
      setCostCodes(codeRows);

      if (projectRows[0]) {
        const scopedMatch = scopedProjectId
          ? projectRows.find((project) => project.id === scopedProjectId)
          : null;
        setSelectedProjectId(String(scopedMatch?.id ?? projectRows[0].id));
      } else {
        setSelectedProjectId("");
      }

      if (codeRows[0]) {
        const defaultCostCodeId = String(codeRows[0].id);
        setLineItems((current) =>
          current.map((line) =>
            line.costCodeId ? line : { ...line, costCodeId: defaultCostCodeId },
          ),
        );
      }

      setStatusMessage(
        `Loaded ${projectRows.length} project(s) and ${codeRows.length} cost code(s).`,
      );
    } catch {
      setStatusMessage("Could not reach dependency endpoints.");
    }
  }, [normalizedBaseUrl, scopedProjectId, token]);

  const loadEstimates = useCallback(async () => {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading estimates...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Failed loading estimates.");
        return;
      }
      const rows = (payload.data as EstimateRecord[]) ?? [];
      setEstimates(rows);
      if (rows[0]) {
        const scopedEstimateMatch = scopedEstimateId
          ? rows.find((estimate) => estimate.id === scopedEstimateId)
          : null;
        handleSelectEstimate(scopedEstimateMatch ?? rows[0]);
      }
      setStatusMessage(`Loaded ${rows.length} estimate version(s).`);
    } catch {
      setStatusMessage("Could not reach estimate endpoint.");
    }
  }, [handleSelectEstimate, normalizedBaseUrl, scopedEstimateId, selectedProjectId, token]);

  const loadProjectChangeOrders = useCallback(async () => {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setProjectChangeOrders([]);
      return;
    }
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/change-orders/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setProjectChangeOrders([]);
        return;
      }
      setProjectChangeOrders((payload.data as EstimateRelatedChangeOrderRecord[]) ?? []);
    } catch {
      setProjectChangeOrders([]);
    }
  }, [normalizedBaseUrl, selectedProjectId, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadEstimatePolicy();
  }, [loadEstimatePolicy, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadDependencies();
  }, [loadDependencies, token]);

  useEffect(() => {
    if (!token || !selectedProjectId) {
      return;
    }
    void loadEstimates();
  }, [loadEstimates, selectedProjectId, token]);

  useEffect(() => {
    if (!token || !selectedProjectId) {
      return;
    }
    void loadProjectChangeOrders();
  }, [loadProjectChangeOrders, selectedProjectId, token]);

  useEffect(() => {
    if (!projects.length || !scopedProjectId) {
      return;
    }
    const scopedMatch = projects.find((project) => project.id === scopedProjectId);
    if (!scopedMatch) {
      return;
    }
    const nextId = String(scopedMatch.id);
    if (nextId !== selectedProjectId) {
      setSelectedProjectId(nextId);
    }
  }, [projects, scopedProjectId, selectedProjectId]);

  function addLineItem() {
    const defaultCostCodeId = costCodes[0] ? String(costCodes[0].id) : "";
    setLineItems((current) => [...current, emptyLine(nextLineId, defaultCostCodeId)]);
    setNextLineId((value) => value + 1);
  }

  function duplicateLineItem(localId: number) {
    const target = lineItems.find((line) => line.localId === localId);
    if (!target) {
      return;
    }
    setLineItems((current) => [...current, { ...target, localId: nextLineId }]);
    setNextLineId((value) => value + 1);
  }

  function moveLineItem(localId: number, direction: "up" | "down") {
    setLineItems((current) => {
      const index = current.findIndex((line) => line.localId === localId);
      if (index === -1) {
        return current;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
    setLineSortKey(null);
    setLineSortDirection("asc");
  }

  function removeLineItem(localId: number) {
    setLineItems((current) => {
      if (current.length <= 1) {
        return current;
      }
      return current.filter((line) => line.localId !== localId);
    });
  }

  function updateLineItem(
    localId: number,
    key: keyof Omit<EstimateLineInput, "localId">,
    value: string,
  ) {
    setLineItems((current) =>
      current.map((line) => (line.localId === localId ? { ...line, [key]: value } : line)),
    );
  }

  function handleSortLineItems(key: LineSortKey) {
    if (isReadOnly) {
      return;
    }
    const nextDirection = lineSortKey === key && lineSortDirection === "asc" ? "desc" : "asc";
    const directionFactor = nextDirection === "asc" ? 1 : -1;

    function lineAmount(line: EstimateLineInput): number {
      const quantity = toNumber(line.quantity);
      const unitCost = toNumber(line.unitCost);
      const markup = toNumber(line.markupPercent);
      const base = quantity * unitCost;
      return base + base * (markup / 100);
    }

    function costCodeLabel(line: EstimateLineInput): string {
      const code = costCodes.find((candidate) => String(candidate.id) === line.costCodeId);
      if (!code) {
        return "";
      }
      return `${code.code} ${code.name}`.toLowerCase();
    }

    setLineItems((current) => {
      const sorted = [...current].sort((a, b) => {
        switch (key) {
          case "quantity":
            return (toNumber(a.quantity) - toNumber(b.quantity)) * directionFactor;
          case "unitCost":
            return (toNumber(a.unitCost) - toNumber(b.unitCost)) * directionFactor;
          case "markupPercent":
            return (toNumber(a.markupPercent) - toNumber(b.markupPercent)) * directionFactor;
          case "amount":
            return (lineAmount(a) - lineAmount(b)) * directionFactor;
          case "costCode":
            return costCodeLabel(a).localeCompare(costCodeLabel(b)) * directionFactor;
          default:
            return 0;
        }
      });
      return sorted;
    });
    setLineSortKey(key);
    setLineSortDirection(nextDirection);
  }

  const canCreateEstimate = useMemo(
    () => Boolean(selectedProjectId) && lineItems.length > 0,
    [lineItems.length, selectedProjectId],
  );

  async function handleCreateEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitGuard.current) {
      return;
    }
    if (isReadOnly) {
      setStatusMessage("This estimate is read-only. Clone or add a new draft to edit.");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    const trimmedTitle = estimateTitle.trim();
    if (!trimmedTitle) {
      setStatusMessage("Estimate title is required.");
      return;
    }

    const hasMissingCostCode = lineItems.some((line) => !line.costCodeId);
    if (hasMissingCostCode) {
      setStatusMessage("Every line item must have a cost code.");
      return;
    }

    if (isEditingDraft && selectedEstimate) {
      setStatusMessage("Saving draft changes...");
      submitGuard.current = true;
      setIsSubmitting(true);
      try {
        const response = await fetch(`${normalizedBaseUrl}/estimates/${selectedEstimate.id}/`, {
          method: "PATCH",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({
            title: trimmedTitle,
            tax_percent: taxPercent,
            line_items: lineItems.map((line) => ({
              cost_code: Number(line.costCodeId),
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unit_cost: line.unitCost,
              markup_percent: line.markupPercent,
            })),
          }),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          setStatusMessage("Save draft failed.");
          return;
        }
        const updated = payload.data as EstimateRecord;
        setEstimates((current) =>
          current.map((estimate) => (estimate.id === updated.id ? updated : estimate)),
        );
        loadEstimateIntoForm(updated);
        setStatusMessage(`Saved draft estimate #${updated.id}.`);
      } catch {
        setStatusMessage("Could not reach estimate update endpoint.");
      } finally {
        submitGuard.current = false;
        setIsSubmitting(false);
      }
      return;
    }

    setStatusMessage("Creating estimate...");
    submitGuard.current = true;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          title: trimmedTitle,
          tax_percent: taxPercent,
          line_items: lineItems.map((line) => ({
            cost_code: Number(line.costCodeId),
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unit_cost: line.unitCost,
            markup_percent: line.markupPercent,
          })),
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Create estimate failed.");
        return;
      }
      const created = payload.data as EstimateRecord;
      setEstimates((current) => [created, ...current]);
      setIsViewerExpanded(true);
      handleSelectEstimate(created);
      setStatusEvents([]);
      setStatusMessage(`Created estimate #${created.id} v${created.version}.`);
      loadEstimateIntoForm(created);
    } catch {
      setStatusMessage("Could not reach estimate create endpoint.");
    } finally {
      submitGuard.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleDuplicateEstimate() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setStatusMessage("Select an estimate first.");
      setActionMessage("Select an existing estimate version before duplicating.");
      return;
    }
    if (!duplicateTitle.trim()) {
      setStatusMessage("Duplicate title is required.");
      return;
    }

    setStatusMessage("Duplicating estimate as a new draft...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/duplicate/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          title: duplicateTitle.trim(),
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        const message = payload.error?.message ?? "Duplicate failed.";
        setStatusMessage(message);
        setActionMessage(message);
        return;
      }
      const duplicated = payload.data as EstimateRecord;
      if (String(duplicated.project) === selectedProjectId) {
        setEstimates((current) => [duplicated, ...current]);
      }
      if (String(duplicated.project) !== selectedProjectId) {
        setSelectedProjectId(String(duplicated.project));
      }
      handleSelectEstimate(duplicated);
      setShowDuplicatePanel(false);
      setStatusEvents([]);
      setStatusMessage(`Duplicated estimate to #${duplicated.id} v${duplicated.version} as draft.`);
      setActionMessage("");
    } catch {
      setStatusMessage("Could not reach duplicate endpoint.");
    }
  }

  async function handleUpdateEstimateStatus() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setStatusMessage("Select an estimate first.");
      return;
    }

    setStatusMessage("Updating estimate status...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ status: selectedStatus, status_note: statusNote }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Status update failed.");
        return;
      }
      const updated = payload.data as EstimateRecord;
      setEstimates((current) =>
        current.map((estimate) => (estimate.id === updated.id ? updated : estimate)),
      );
      const updatedNextStatuses = estimateAllowedStatusTransitions[updated.status] ?? [];
      setSelectedStatus(updatedNextStatuses[0] ?? updated.status);
      setStatusNote("");
      await loadStatusEvents({ estimateId: updated.id, quiet: true });
      setStatusMessage(
        `Updated estimate #${updated.id} to ${formatEstimateStatus(updated.status)}.`,
      );
    } catch {
      setStatusMessage("Could not reach estimate status endpoint.");
    }
  }

  const loadStatusEvents = useCallback(
    async (options?: { estimateId?: number; quiet?: boolean }) => {
      const estimateId = options?.estimateId ?? Number(selectedEstimateId);
      const quiet = options?.quiet ?? false;
      if (!estimateId) {
        if (!quiet) {
          setStatusMessage("Select an estimate first.");
        }
        return;
      }

      if (!quiet) {
        setStatusMessage("Loading status events...");
      }
      try {
        const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/status-events/`, {
          headers: buildAuthHeaders(token),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          if (!quiet) {
            setStatusMessage("Failed loading status events.");
          }
          return;
        }
        const rows = (payload.data as EstimateStatusEventRecord[]) ?? [];
        setStatusEvents(rows);
        if (!quiet) {
          setStatusMessage(`Loaded ${rows.length} status event(s).`);
        }
      } catch {
        if (!quiet) {
          setStatusMessage("Could not reach status events endpoint.");
        }
      }
    },
    [normalizedBaseUrl, selectedEstimateId, token],
  );

  useEffect(() => {
    if (!token || !selectedEstimateId) {
      return;
    }
    void loadStatusEvents({ quiet: true });
  }, [loadStatusEvents, selectedEstimateId, token]);

  return (
    <section className={styles.console}>
      <div className={styles.estimateSelector}>
        {selectedProject ? (
          <>
            <p className={styles.scopeLabel}>Project Context</p>
            <p className={styles.scopeProjectName}>
              #{selectedProject.id} {selectedProject.name}
            </p>
            <p className={styles.scopeProjectMeta}>
              {selectedProject.customer_display_name} · {selectedProject.status}
            </p>
          </>
        ) : projects.length === 0 ? (
          <p className={styles.inlineHint}>
            No projects yet. Create one from Intake so we can bill against it.
          </p>
        ) : (
          <p className={styles.inlineHint}>
            No project selected. Open estimates from <code>/projects</code>.
          </p>
        )}
      </div>

      <div className={styles.primaryCreateAction}>
        <button type="button" onClick={startNewEstimate}>
          Add New Estimate
        </button>
      </div>

      <section className={styles.lifecycle}>
        <div className={styles.lifecycleHeader}>
          <h3>Estimate Versions & Status</h3>
          <button
            type="button"
            className={styles.lifecycleToggleButton}
            onClick={() => setIsViewerExpanded((current) => !current)}
            aria-expanded={isViewerExpanded}
          >
            {isViewerExpanded ? "Hide Viewer" : "Show Viewer"}
          </button>
        </div>

        {isViewerExpanded ? (
          <>
            <div className={styles.lifecycleActions}>
              <button
                type="button"
                onClick={() => {
                  if (!selectedEstimate) {
                    setStatusMessage("Select an existing estimate version before duplicating.");
                    setActionMessage("Select an existing estimate version before duplicating.");
                    return;
                  }
                  setDuplicateTitle(`${selectedEstimate.title || "Estimate"} Copy`);
                  setShowDuplicatePanel((current) => !current);
                }}
              >
                Duplicate as New Estimate
              </button>
              {selectedEstimate && selectedProjectId ? (
                <Link
                  href={postEstimateWorkflowHref(selectedEstimate.id)}
                  className={styles.lifecycleLinkAction}
                  prefetch={false}
                >
                  Open Post-Estimate Workflow
                </Link>
              ) : null}
            </div>
            {actionMessage ? <p className={styles.actionError}>{actionMessage}</p> : null}
            {showDuplicatePanel ? (
              <div className={styles.duplicatePanel}>
                <p className={styles.inlineHint}>
                  Duplicating in project{" "}
                  {selectedProject
                    ? `#${selectedProject.id} - ${selectedProject.name} (${selectedProject.customer_display_name})`
                    : "current selection"}.
                </p>
                <label className={styles.lifecycleField}>
                  New estimate title
                  <input
                    value={duplicateTitle}
                    onChange={(event) => setDuplicateTitle(event.target.value)}
                    placeholder="Estimate title"
                  />
                </label>
                <div className={styles.lifecycleActions}>
                  <button type="button" onClick={handleDuplicateEstimate}>
                    Confirm Duplicate
                  </button>
                  <button type="button" onClick={() => setShowDuplicatePanel(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            <div className={styles.versionFilters}>
              <span className={styles.versionFiltersLabel}>Estimate status filter</span>
              <div className={styles.versionFilterButtons}>
                {statusOptions.map((option) => {
                  const active = estimateStatusFilters.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`${styles.statusPill} ${
                        active ? statusClasses[option.value] : styles.statusPillInactive
                      } ${active ? styles.statusPillActive : ""}`}
                      aria-pressed={active}
                      onClick={() => toggleEstimateStatusFilter(option.value)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <div className={styles.versionFilterActions}>
                <button
                  type="button"
                  className={styles.versionFilterActionButton}
                  onClick={() => setEstimateStatusFilters(estimateStatusFilterValues)}
                >
                  Show All Statuses
                </button>
                <button
                  type="button"
                  className={styles.versionFilterActionButton}
                  onClick={() => setEstimateStatusFilters(defaultEstimateStatusFilters)}
                >
                  Reset Filters
                </button>
              </div>
            </div>

            <div className={styles.versionTree}>
              {visibleEstimateFamilies.length > 0 ? (
                visibleEstimateFamilies.map((family) => {
                  const latest = family.items[family.items.length - 1];
                  const history = family.items.slice(0, -1).reverse();
                  const selectedInFamily = family.items.find(
                    (estimate) => String(estimate.id) === selectedEstimateId,
                  );
                  const isFamilyActive = Boolean(selectedInFamily);
                  const isViewingHistory =
                    selectedInFamily && String(selectedInFamily.id) !== String(latest.id);
                  const isLatestSelected = String(latest.id) === selectedEstimateId;
                  const isHistoryOpen = openFamilyHistory.has(family.title);
                  const relationEstimateId = selectedInFamily?.id ?? latest.id;
                  const quickActionKind = quickActionKindForStatus(latest.status);
                  const quickActionTitle = quickActionTitleForStatus(latest.status);
                  const relatedChangeOrders = projectChangeOrders.filter(
                    (changeOrder) => changeOrder.origin_estimate === relationEstimateId,
                  );
                  const latestTotal = formatMoney(toNumber(latest.grand_total || "0"));
                  return (
                    <div
                      key={family.title}
                      className={`${styles.familyGroup} ${
                        isFamilyActive ? styles.familyGroupActive : ""
                      }`}
                    >
                      <div className={styles.familyRow}>
                        <div className={styles.versionCardWrap}>
                          {quickActionKind ? (
                            <button
                              type="button"
                              className={styles.coStartIconLink}
                              aria-label={`${quickActionTitle} (estimate #${latest.id})`}
                              title={quickActionTitle}
                              onClick={() => void handleFamilyCardQuickAction(latest)}
                            >
                              +
                            </button>
                          ) : null}
                          {latest.public_ref ? (
                            <Link
                              href={publicEstimateHref(latest.public_ref)}
                              className={styles.publicEstimateLinkIcon}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open public view for estimate #${latest.id}`}
                              title="Open public view"
                            >
                              ↗
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            className={`${styles.familyMain} ${
                              isLatestSelected ? styles.familyMainActive : ""
                            }`}
                            onClick={() => handleSelectFamilyLatest(family.title, latest)}
                          >
                            <div className={styles.familyMainContent}>
                              <span className={styles.familyTitle}>{family.title}</span>
                              <span className={styles.familyMeta}>
                                ${latestTotal} · Estimate #{latest.id} · {history.length} history{" "}
                                {history.length === 1 ? "entry" : "entries"}
                              </span>
                              <span className={styles.familyDate}>
                                Last action: {formatEstimateLastActionDate(latest)}
                              </span>
                            </div>
                            <div className={styles.versionRight}>
                              <span
                                className={`${styles.versionStatus} ${
                                  statusClasses[latest.status] ?? ""
                                }`}
                              >
                                {formatEstimateStatus(latest.status)}
                              </span>
                            </div>
                          </button>
                        </div>
                        {isHistoryOpen && history.length > 0 ? (
                          <div className={styles.historyRow}>
                            {history.map((estimate) => {
                              const total = formatMoney(toNumber(estimate.grand_total || "0"));
                              const isSelected = String(estimate.id) === selectedEstimateId;
                              return (
                                <div key={estimate.id} className={styles.versionCardWrap}>
                                  {estimate.public_ref ? (
                                    <Link
                                      href={publicEstimateHref(estimate.public_ref)}
                                      className={styles.publicEstimateLinkIcon}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      aria-label={`Open public view for estimate #${estimate.id}`}
                                      title="Open public view"
                                    >
                                      ↗
                                    </Link>
                                  ) : null}
                                  <button
                                    type="button"
                                    className={`${styles.historyCard} ${
                                      isSelected ? styles.historyCardActive : ""
                                    }`}
                                    onClick={() => handleSelectEstimate(estimate)}
                                  >
                                    <span className={styles.historyMetaRow}>
                                      <span className={styles.historyVersionMeta}>
                                        v{estimate.version} <span className={styles.historyMeta}>#{estimate.id}</span>
                                      </span>
                                      <span
                                        className={`${styles.versionStatus} ${
                                          statusClasses[estimate.status] ?? ""
                                        } ${styles.historyStatus}`}
                                      >
                                        {formatEstimateStatus(estimate.status)}
                                      </span>
                                    </span>
                                    <span className={styles.historyAmount}>${total}</span>
                                    <span className={styles.historyDate}>
                                      {formatEstimateLastActionDate(estimate)}
                                    </span>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      <div className={styles.familyFooter}>
                        {isViewingHistory ? (
                          <span className={styles.historyNotice}>
                            Viewing v{selectedInFamily?.version}
                          </span>
                        ) : null}
                        {relatedChangeOrders.length > 0 ? (
                          <span className={styles.relatedChangeOrders}>
                            CO refs:{" "}
                            {relatedChangeOrders.slice(0, 3).map((changeOrder, index) => (
                              <span key={changeOrder.id}>
                                {index > 0 ? ", " : ""}
                                <Link
                                  href={`/projects/${selectedProjectId}/change-orders?origin_estimate=${relationEstimateId}`}
                                  className={styles.relatedChangeOrdersLink}
                                >
                                  CO-{changeOrder.number} v{changeOrder.revision_number}
                                </Link>
                              </span>
                            ))}
                            {relatedChangeOrders.length > 3 ? ` +${relatedChangeOrders.length - 3} more` : ""}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              ) : estimateFamilies.length > 0 ? (
                <p className={styles.inlineHint}>No estimate families match the selected status filters.</p>
              ) : (
                <p className={styles.inlineHint}>No estimates to display yet.</p>
              )}
            </div>

            <div className={styles.lifecycleGrid}>
              <div className={styles.statusPicker}>
                <span className={styles.lifecycleFieldLabel}>Next status</span>
                <div className={styles.statusPills}>
                  {nextStatusOptions.map((option) => {
                    const isSelected = selectedStatus === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`${styles.statusPill} ${
                          isSelected ? statusClasses[option.value] ?? "" : styles.statusPillInactive
                        } ${isSelected ? styles.statusPillActive : ""}`}
                        onClick={() => setSelectedStatus(option.value)}
                        aria-pressed={isSelected}
                        disabled={!selectedEstimateId}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {selectedEstimateId && nextStatusOptions.length === 0 ? (
                  <p className={styles.inlineHint}>No next statuses available for this estimate.</p>
                ) : null}
              </div>
              <label className={styles.lifecycleField}>
                Status note
                <textarea
                  className={styles.statusNote}
                  value={statusNote}
                  onChange={(event) => setStatusNote(event.target.value)}
                  placeholder="Optional note for this transition"
                  rows={3}
                />
              </label>
            </div>
            <div className={styles.lifecycleActions}>
              <button
                type="button"
                onClick={handleUpdateEstimateStatus}
                disabled={!selectedEstimateId || nextStatusOptions.length === 0}
              >
                Update Selected Estimate Status
              </button>
            </div>

            {statusEvents.length > 0 ? (
              <div className={styles.statusEvents}>
                <h4>Status Events</h4>
                <div className={styles.statusEventsTableWrap}>
                  <table className={styles.statusEventsTable}>
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Occurred</th>
                        <th>Note</th>
                        <th>Who</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statusEvents.map((event) => {
                        const toStatusClass = statusClasses[event.to_status] ?? "";
                        return (
                          <tr key={event.id}>
                            <td>
                              <span className={`${styles.versionStatus} ${toStatusClass}`}>
                                {formatStatusAction(event)}
                              </span>
                            </td>
                            <td>{formatEventDate(event.changed_at)}</td>
                            <td>{event.note || "—"}</td>
                            <td>{event.changed_by_email}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className={styles.inlineHint}>Viewer collapsed. Expand to review versions, status transitions, and history.</p>
        )}
      </section>

      <EstimateSheet
        project={selectedProject}
        estimateId={selectedEstimateId}
        estimateTitle={estimateTitle}
        estimateDate={estimateDate}
        dueDate={dueDate}
        taxPercent={taxPercent}
        lineItems={lineItems}
        lineTotals={lineTotals}
        subtotal={subtotal}
        taxAmount={taxAmount}
        totalAmount={totalAmount}
        costCodes={costCodes}
        canSubmit={canCreateEstimate}
        isSubmitting={isSubmitting}
        isEditingDraft={isEditingDraft}
        readOnly={isReadOnly}
        lineSortKey={lineSortKey}
        lineSortDirection={lineSortDirection}
        onTitleChange={setEstimateTitle}
        onDueDateChange={setDueDate}
        onTaxPercentChange={setTaxPercent}
        onLineItemChange={updateLineItem}
        onAddLineItem={addLineItem}
        onMoveLineItem={moveLineItem}
        onDuplicateLineItem={duplicateLineItem}
        onRemoveLineItem={removeLineItem}
        onSortLineItems={handleSortLineItems}
        onSubmit={handleCreateEstimate}
      />
    </section>
  );
}
