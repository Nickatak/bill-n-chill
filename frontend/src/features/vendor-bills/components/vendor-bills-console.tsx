"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDateDisplay } from "@/shared/date-format";

import {
  defaultApiBaseUrl,
  fetchVendorBillPolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { hasAnyRole } from "../../session/rbac";
import {
  ApiResponse,
  ProjectRecord,
  VendorBillAllocationInput,
  VendorBillPolicyContract,
  VendorBillPayload,
  VendorBillRecord,
  VendorBillStatus,
  VendorRecord,
} from "../types";
import styles from "./vendor-bills-console.module.css";
import invoiceStyles from "../../invoices/components/invoices-console.module.css";

const VENDOR_BILL_STATUSES_FALLBACK: string[] = [
  "planned",
  "received",
  "approved",
  "scheduled",
  "paid",
  "void",
];
const VENDOR_BILL_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, string[]> = {
  planned: ["received", "void"],
  received: ["approved", "void"],
  approved: ["scheduled", "paid", "void"],
  scheduled: ["paid", "void"],
  paid: ["void"],
  void: [],
};
const VENDOR_BILL_CREATE_SHORTCUT_STATUSES_FALLBACK = ["planned", "received"];
const VENDOR_BILL_STATUS_LABELS_FALLBACK: Record<string, string> = {
  planned: "Planned",
  received: "Received",
  approved: "Approved",
  scheduled: "Scheduled",
  paid: "Paid",
  void: "Void",
};
type ProjectStatusValue = "prospect" | "active" | "on_hold" | "completed" | "cancelled";
const DEFAULT_PROJECT_STATUS_FILTERS: ProjectStatusValue[] = ["active", "prospect"];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function dueDateIsoDate(daysFromNow = 30) {
  const current = new Date();
  current.setDate(current.getDate() + daysFromNow);
  return current.toISOString().slice(0, 10);
}

const GENERIC_BUDGET_LINE_SPECS = [
  { costCode: "99-901", label: "Generic: Tools & Consumables" },
  { costCode: "99-902", label: "Generic: Project Overhead" },
  { costCode: "99-903", label: "Generic: Unplanned Spend" },
] as const;
const GENERIC_BUDGET_COST_CODES = new Set<string>(
  GENERIC_BUDGET_LINE_SPECS.map((item) => item.costCode),
);

type BudgetLineOption = {
  id: number;
  budgetId: number;
  label: string;
  cost_code_code?: string;
  planned_amount: string;
  actual_spend: string;
  remaining_amount: string;
};

type BudgetLineGroup = {
  budgetId: number;
  budgetLabel: string;
  originEstimateLabel: string;
  lines: BudgetLineOption[];
};

type AllocationFormRow = VendorBillAllocationInput & {
  ui_line_key?: string;
  ui_target_budget_id?: number;
};

function createEmptyAllocationRow(): AllocationFormRow {
  return {
    budget_line: 0,
    amount: "",
    note: "",
    ui_line_key: "",
    ui_target_budget_id: undefined,
  };
}

type VendorBillsConsoleProps = {
  scopedProjectId?: number | null;
};

function defaultBillStatusFilters(statuses: string[]): string[] {
  const withoutVoid = statuses.filter((value) => value !== "void");
  return withoutVoid.length ? withoutVoid : statuses;
}

function projectStatusClass(statusValue: string): string {
  const key = `projectStatus${statusValue
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
  return invoiceStyles[key] ?? "";
}

function projectStatusLabel(statusValue: string): string {
  return statusValue.replace("_", " ");
}

export function VendorBillsConsole({ scopedProjectId: scopedProjectIdProp = null }: VendorBillsConsoleProps) {
  const searchParams = useSearchParams();
  const queryProjectParam = searchParams.get("project");
  const queryProjectId =
    queryProjectParam && /^\d+$/.test(queryProjectParam) ? Number(queryProjectParam) : null;
  const scopedProjectId = scopedProjectIdProp;
  const preferredProjectId = scopedProjectId ?? queryProjectId;

  const { token, role } = useSharedSessionAuth();
  const projectPageSize = 5;
  const dueSoonWindowDays = 7;
  const [statusMessage, setStatusMessage] = useState("");
  const [createErrorMessage, setCreateErrorMessage] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilters, setProjectStatusFilters] = useState<ProjectStatusValue[]>(
    DEFAULT_PROJECT_STATUS_FILTERS,
  );
  const [currentProjectPage, setCurrentProjectPage] = useState(1);

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [vendorBills, setVendorBills] = useState<VendorBillRecord[]>([]);
  const [budgetLineGroups, setBudgetLineGroups] = useState<BudgetLineGroup[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedVendorBillId, setSelectedVendorBillId] = useState("");
  const [billStatuses, setBillStatuses] = useState<string[]>(VENDOR_BILL_STATUSES_FALLBACK);
  const [billStatusLabels, setBillStatusLabels] = useState<Record<string, string>>(
    VENDOR_BILL_STATUS_LABELS_FALLBACK,
  );
  const [allowedStatusTransitions, setAllowedStatusTransitions] = useState<Record<string, string[]>>(
    VENDOR_BILL_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
  );
  const [createStatusOptions, setCreateStatusOptions] = useState<string[]>(
    VENDOR_BILL_CREATE_SHORTCUT_STATUSES_FALLBACK,
  );
  const [billStatusFilters, setBillStatusFilters] = useState<string[]>(
    defaultBillStatusFilters(VENDOR_BILL_STATUSES_FALLBACK),
  );
  const [dueFilter, setDueFilter] = useState<"all" | "due_soon" | "overdue">("all");

  const [newVendorId, setNewVendorId] = useState("");
  const [newBillNumber, setNewBillNumber] = useState("");
  const [newReceivedDate, setNewReceivedDate] = useState(todayIsoDate());
  const [newIssueDate, setNewIssueDate] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newCurrency, setNewCurrency] = useState("USD");
  const [newSubtotal, setNewSubtotal] = useState("0.00");
  const [newTaxAmount, setNewTaxAmount] = useState("0.00");
  const [newShippingAmount, setNewShippingAmount] = useState("0.00");
  const [newScheduledFor, setNewScheduledFor] = useState("");
  const [newStatus, setNewStatus] = useState<string>("planned");
  const [newTotal, setNewTotal] = useState("0.00");
  const [newNotes, setNewNotes] = useState("");
  const [newAllocations, setNewAllocations] = useState<AllocationFormRow[]>([
    createEmptyAllocationRow(),
  ]);

  const [vendorId, setVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayIsoDate());
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [subtotal, setSubtotal] = useState("0.00");
  const [taxAmount, setTaxAmount] = useState("0.00");
  const [shippingAmount, setShippingAmount] = useState("0.00");
  const [scheduledFor, setScheduledFor] = useState("");
  const [total, setTotal] = useState("0.00");
  const [notes, setNotes] = useState("");
  const [allocations, setAllocations] = useState<AllocationFormRow[]>([createEmptyAllocationRow()]);
  const [status, setStatus] = useState<string>("planned");
  const [viewerNextStatus, setViewerNextStatus] = useState<string>("");

  const [duplicateCandidates, setDuplicateCandidates] = useState<VendorBillRecord[]>([]);
  const activeVendors = vendors.filter((vendor) => vendor.is_active);
  const projectNeedle = projectSearch.trim().toLowerCase();
  const filteredProjects = !projectNeedle
    ? projects
    : projects.filter((project) => {
        const haystack = [String(project.id), project.name, project.customer_display_name, project.status ?? ""]
          .join(" ")
          .toLowerCase();
        return haystack.includes(projectNeedle);
      });
  const statusFilteredProjects = scopedProjectId !== null
    ? filteredProjects.filter((project) => String(project.id) === String(scopedProjectId))
    : filteredProjects.filter((project) =>
        projectStatusFilters.includes((project.status as ProjectStatusValue) ?? "active"),
      );
  const totalProjectPages = Math.max(1, Math.ceil(statusFilteredProjects.length / projectPageSize));
  const currentProjectPageSafe = Math.min(currentProjectPage, totalProjectPages);
  const projectPageStart = (currentProjectPageSafe - 1) * projectPageSize;
  const pagedProjects = statusFilteredProjects.slice(projectPageStart, projectPageStart + projectPageSize);
  const filteredVendorBills = vendorBills.filter((bill) => {
    if (billStatusFilters.length === 0 || !billStatusFilters.includes(bill.status)) {
      return false;
    }
    if (dueFilter === "all") {
      return true;
    }
    if (!bill.due_date || bill.status === "paid" || bill.status === "void") {
      return false;
    }
    const today = todayIsoDate();
    if (dueFilter === "overdue") {
      return bill.due_date < today;
    }
    const dueSoonDate = dueDateIsoDate(dueSoonWindowDays);
    return bill.due_date >= today && bill.due_date <= dueSoonDate;
  });
  const createAllocationTotal = newAllocations.reduce((sum, row) => {
    const amount = row.budget_line ? Number(row.amount || 0) : 0;
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const createBillTotal = Number(newTotal || 0);
  const createUnallocated = createBillTotal - createAllocationTotal;
  const editAllocationTotal = allocations.reduce((sum, row) => {
    const amount = row.budget_line ? Number(row.amount || 0) : 0;
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const editBillTotal = Number(total || 0);
  const editUnallocated = editBillTotal - editAllocationTotal;
  const allocationEpsilon = 0.000001;
  const createIsOverAllocated = createUnallocated < -allocationEpsilon;
  const editIsOverAllocated = editUnallocated < -allocationEpsilon;
  const hasBudgetLineOptions = budgetLineGroups.length > 0;
  const createSuggestedTotal = createAllocationTotal.toFixed(2);
  const editSuggestedTotal = editAllocationTotal.toFixed(2);
  const budgetLineMetaById = useMemo(() => {
    const entries = budgetLineGroups.flatMap((group) =>
      group.lines.map((line) => [line.id, line] as const),
    );
    return new Map(entries);
  }, [budgetLineGroups]);
  const originEstimateLabelByBudgetId = useMemo(
    () => new Map(budgetLineGroups.map((group) => [group.budgetId, group.originEstimateLabel] as const)),
    [budgetLineGroups],
  );
  const genericLineOptionsByCostCode = useMemo(() => {
    const next = new Map<string, BudgetLineOption[]>();
    for (const group of budgetLineGroups) {
      for (const line of group.lines) {
        const code = line.cost_code_code ?? "";
        if (!GENERIC_BUDGET_COST_CODES.has(code)) {
          continue;
        }
        next.set(code, [...(next.get(code) ?? []), line]);
      }
    }
    return next;
  }, [budgetLineGroups]);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const canMutateVendorBills = hasAnyRole(role, ["owner", "pm", "bookkeeping"]);
  const isProjectScoped = scopedProjectId !== null;
  const selectedProject =
    projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const selectedVendorBill =
    vendorBills.find((vendorBill) => String(vendorBill.id) === selectedVendorBillId) ?? null;
  const isEditingMode = Boolean(selectedVendorBillId);
  const vendorOptions = vendors;
  const formVendorId = isEditingMode ? vendorId : newVendorId;
  const formBillNumber = isEditingMode ? billNumber : newBillNumber;
  const formReceivedDate = isEditingMode ? receivedDate : newReceivedDate;
  const formIssueDate = isEditingMode ? issueDate : newIssueDate;
  const formDueDate = isEditingMode ? dueDate : newDueDate;
  const formCurrency = isEditingMode ? currency : newCurrency;
  const formSubtotal = isEditingMode ? subtotal : newSubtotal;
  const formTaxAmount = isEditingMode ? taxAmount : newTaxAmount;
  const formShippingAmount = isEditingMode ? shippingAmount : newShippingAmount;
  const formScheduledFor = isEditingMode ? scheduledFor : newScheduledFor;
  const formTotal = isEditingMode ? total : newTotal;
  const formNotes = isEditingMode ? notes : newNotes;
  const formAllocations = isEditingMode ? allocations : newAllocations;
  const formAllocationTotal = isEditingMode ? editAllocationTotal : createAllocationTotal;
  const formUnallocated = isEditingMode ? editUnallocated : createUnallocated;
  const formIsOverAllocated = isEditingMode ? editIsOverAllocated : createIsOverAllocated;
  const formSuggestedTotal = isEditingMode ? editSuggestedTotal : createSuggestedTotal;
  const formStatus: VendorBillStatus = isEditingMode ? status : newStatus;
  const canEditScheduledFor = formStatus === "approved" || formStatus === "scheduled";
  const formRequiresFullAllocation = false;
  const formRequiresScheduledFor = false;
  const hasAllocationMismatch = Math.abs(formUnallocated) > allocationEpsilon;
  const formSubtotalAmount = Number(formSubtotal || 0);
  const formTaxAmountValue = Number(formTaxAmount || 0);
  const formShippingAmountValue = Number(formShippingAmount || 0);
  const quickStatusOptions = selectedVendorBill
    ? allowedStatusTransitions[selectedVendorBill.status] ?? []
    : [];
  const computedTotalFromParts = (
    formSubtotalAmount +
    formTaxAmountValue +
    formShippingAmountValue
  ).toFixed(2);

  function setFormVendorId(value: string) {
    if (isEditingMode) {
      setVendorId(value);
    } else {
      setNewVendorId(value);
    }
  }

  function setFormBillNumber(value: string) {
    if (isEditingMode) {
      setBillNumber(value);
    } else {
      setNewBillNumber(value);
    }
  }

  function setFormReceivedDate(value: string) {
    if (isEditingMode) {
      setReceivedDate(value);
    } else {
      setNewReceivedDate(value);
    }
  }

  function setFormIssueDate(value: string) {
    if (isEditingMode) {
      setIssueDate(value);
    } else {
      setNewIssueDate(value);
    }
  }

  function setFormDueDate(value: string) {
    if (isEditingMode) {
      setDueDate(value);
    } else {
      setNewDueDate(value);
    }
  }

  function setFormSubtotal(value: string) {
    if (isEditingMode) {
      setSubtotal(value);
    } else {
      setNewSubtotal(value);
    }
  }

  function setFormTaxAmount(value: string) {
    if (isEditingMode) {
      setTaxAmount(value);
    } else {
      setNewTaxAmount(value);
    }
  }

  function setFormShippingAmount(value: string) {
    if (isEditingMode) {
      setShippingAmount(value);
    } else {
      setNewShippingAmount(value);
    }
  }

  function setFormScheduledFor(value: string) {
    if (isEditingMode) {
      if (value && value < todayIsoDate()) {
        setStatusMessage("Scheduled for date cannot be in the past.");
        return;
      }
      setScheduledFor(value);
    } else {
      setNewScheduledFor(value);
    }
  }

  function setFormTotal(value: string) {
    if (isEditingMode) {
      setTotal(value);
    } else {
      setNewTotal(value);
    }
  }

  function setFormNotes(value: string) {
    if (isEditingMode) {
      setNotes(value);
    } else {
      setNewNotes(value);
    }
  }

  function setFormAllocations(next: AllocationFormRow[]) {
    if (isEditingMode) {
      setAllocations(next);
    } else {
      setNewAllocations(next);
    }
  }

  function updateFormAllocation(index: number, patch: Partial<AllocationFormRow>) {
    const next = [...formAllocations];
    next[index] = { ...next[index], ...patch };
    setFormAllocations(next);
  }

  function removeFormAllocation(index: number) {
    const current = formAllocations;
    setFormAllocations(
      current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current,
    );
  }

  function addFormAllocation() {
    setFormAllocations([...formAllocations, createEmptyAllocationRow()]);
  }

  function formatMoney(value?: string): string {
    const parsed = Number(value ?? "0");
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
  }

  function resolveGenericUiState(budgetLineId: number): Pick<AllocationFormRow, "ui_line_key" | "ui_target_budget_id"> {
    const meta = budgetLineMetaById.get(Number(budgetLineId));
    const code = meta?.cost_code_code ?? "";
    if (!meta || !GENERIC_BUDGET_COST_CODES.has(code)) {
      return { ui_line_key: "", ui_target_budget_id: undefined };
    }
    return {
      ui_line_key: `generic:${code}`,
      ui_target_budget_id: meta.budgetId,
    };
  }

  function toAllocationFormRow(row: VendorBillAllocationInput): AllocationFormRow {
    const genericUi = resolveGenericUiState(Number(row.budget_line));
    return {
      budget_line: Number(row.budget_line || 0),
      amount: row.amount,
      note: row.note || "",
      ...genericUi,
    };
  }

  function handleSubmitVendorBillForm(event: FormEvent<HTMLFormElement>) {
    if (!canMutateVendorBills) {
      event.preventDefault();
      setStatusMessage(`Role ${role} is read-only for vendor bill mutations.`);
      return;
    }
    if (isEditingMode) {
      void handleSaveVendorBill(event);
      return;
    }
    void handleCreateVendorBill(event);
  }

  function hydrate(item: VendorBillRecord) {
    setVendorId(String(item.vendor));
    setBillNumber(item.bill_number);
    setReceivedDate(item.issue_date);
    setIssueDate(item.issue_date);
    setDueDate(item.due_date);
    setCurrency("USD");
    setSubtotal(item.total);
    setTaxAmount("0.00");
    setShippingAmount("0.00");
    setScheduledFor(item.scheduled_for ?? "");
    setTotal(item.total);
    setNotes(item.notes);
    setStatus(item.status);
    const mapped =
      item.allocations?.map((row) =>
        toAllocationFormRow({
          budget_line: row.budget_line,
          amount: row.amount,
          note: row.note || "",
        }),
      ) ?? [];
    setAllocations(mapped.length > 0 ? mapped : [createEmptyAllocationRow()]);
  }

  function statusDisplayLabel(value: VendorBillStatus): string {
    return billStatusLabels[value] ?? value;
  }

  function statusBadgeClass(value: VendorBillStatus): string {
    return styles[`tableStatus${value[0].toUpperCase()}${value.slice(1)}`] ?? "";
  }

  function statusPillClass(value: VendorBillStatus): string {
    return styles[`statusPill${value[0].toUpperCase()}${value.slice(1)}`] ?? "";
  }

  function toggleBillStatusFilter(nextStatus: VendorBillStatus) {
    setBillStatusFilters((current) =>
      current.includes(nextStatus)
        ? current.filter((status) => status !== nextStatus)
        : [...current, nextStatus],
    );
  }

  function toggleProjectStatusFilter(statusValue: ProjectStatusValue) {
    setProjectStatusFilters((current) =>
      current.includes(statusValue)
        ? current.filter((status) => status !== statusValue)
        : [...current, statusValue],
    );
  }

  function handleSelectProject(project: ProjectRecord) {
    if (String(project.id) === selectedProjectId) {
      return;
    }
    setSelectedProjectId(String(project.id));
  }

  async function loadVendorBillPolicy() {
    try {
      const response = await fetchVendorBillPolicyContract({
        baseUrl: normalizedBaseUrl,
        token,
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.data || Array.isArray(payload.data)) {
        return;
      }
      const contract = payload.data as VendorBillPolicyContract;
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
      const shortcuts =
        Array.isArray(contract.create_shortcut_statuses) && contract.create_shortcut_statuses.length
          ? contract.create_shortcut_statuses
          : VENDOR_BILL_CREATE_SHORTCUT_STATUSES_FALLBACK.filter((statusValue) =>
              contract.statuses.includes(statusValue),
            );
      const fallbackCreateStatus =
        contract.default_create_status || contract.statuses[0] || VENDOR_BILL_STATUSES_FALLBACK[0];

      setBillStatuses(contract.statuses);
      setBillStatusLabels({
        ...VENDOR_BILL_STATUS_LABELS_FALLBACK,
        ...(contract.status_labels || {}),
      });
      setAllowedStatusTransitions(normalizedTransitions);
      setCreateStatusOptions(shortcuts.length ? shortcuts : [fallbackCreateStatus]);
      setBillStatusFilters((current) => {
        const retained = current.filter((statusValue) => contract.statuses.includes(statusValue));
        return retained.length ? retained : defaultBillStatusFilters(contract.statuses);
      });
      setNewStatus((current) => {
        if (contract.statuses.includes(current)) {
          return current;
        }
        return shortcuts[0] || fallbackCreateStatus;
      });
      setStatus((current) => (contract.statuses.includes(current) ? current : fallbackCreateStatus));
    } catch {
      // Contract load is best-effort; static fallback remains active.
    }
  }

  async function loadDependencies() {
    setStatusMessage("Loading projects and vendors...");

    try {
      const [projectsResponse, vendorsResponse] = await Promise.all([
        fetch(`${normalizedBaseUrl}/projects/`, {
          headers: buildAuthHeaders(token),
        }),
        fetch(`${normalizedBaseUrl}/vendors/`, {
          headers: buildAuthHeaders(token),
        }),
      ]);

      const projectsPayload: ApiResponse = await projectsResponse.json();
      const vendorsPayload: ApiResponse = await vendorsResponse.json();
      if (!projectsResponse.ok || !vendorsResponse.ok) {
        setStatusMessage("Could not load projects/vendors.");
        return;
      }

      const projectRows = (projectsPayload.data as ProjectRecord[]) ?? [];
      const vendorRows = (vendorsPayload.data as VendorRecord[]) ?? [];
      const activeVendors = vendorRows.filter((row) => row.is_active);
      setProjects(projectRows);
      setVendors(vendorRows);

      if (projectRows.length > 0) {
        const preferredProject = preferredProjectId
          ? projectRows.find((row) => row.id === preferredProjectId)
          : null;
        if (preferredProject) {
          setSelectedProjectId(String(preferredProject.id));
        } else if (scopedProjectId) {
          setSelectedProjectId("");
          setStatusMessage(
            `Project #${scopedProjectId} is not available in your scope. Select a valid project.`,
          );
          return;
        } else {
          setSelectedProjectId(String(projectRows[0].id));
        }
      }
      if (activeVendors[0]) {
        setNewVendorId(String(activeVendors[0].id));
      } else if (vendorRows[0]) {
        setNewVendorId(String(vendorRows[0].id));
      }

      setStatusMessage(`Loaded ${projectRows.length} project(s) and ${vendorRows.length} vendor(s).`);
    } catch {
      setStatusMessage("Could not reach projects/vendors endpoints.");
    }
  }

  async function loadVendorBills() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading bills...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/vendor-bills/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load bills.");
        return;
      }

      const rows = (payload.data as VendorBillRecord[]) ?? [];
      const sortedRows = [...rows].sort((a, b) => {
        const updatedA = new Date(a.updated_at || a.created_at).getTime();
        const updatedB = new Date(b.updated_at || b.created_at).getTime();
        return updatedB - updatedA;
      });
      setVendorBills(sortedRows);
      const preferred = sortedRows.find((row) => row.status !== "void") ?? sortedRows[0];
      if (preferred) {
        setSelectedVendorBillId(String(preferred.id));
        hydrate(preferred);
      } else {
        setSelectedVendorBillId("");
      }
      setStatusMessage("");
    } catch {
      setStatusMessage("Could not reach vendor-bills endpoint.");
    }
  }

  async function loadBudgetLineOptions(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/budgets/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setBudgetLineGroups([]);
        return;
      }
      const rows =
        ((payload.data as Array<{
          id: number;
          source_estimate?: number;
          source_estimate_version?: number;
          baseline_snapshot_json?: {
            estimate?: {
              title?: string;
            };
          };
          line_items: Array<{
            id: number;
            cost_code_code?: string;
            description?: string;
            planned_amount?: string;
            actual_spend?: string;
            remaining_amount?: string;
          }>;
        }>) ?? []) || [];
      const groups = rows
        .map((budget) => {
          const estimateTitle = budget.baseline_snapshot_json?.estimate?.title?.trim();
          const baseLabel =
            estimateTitle ||
            (budget.source_estimate ? `Estimate #${budget.source_estimate}` : "Unlinked estimate baseline");
          const originEstimateLabel =
            budget.source_estimate_version != null
              ? `${baseLabel} (v${budget.source_estimate_version})`
              : baseLabel;
          return {
            budgetId: budget.id,
            budgetLabel: `${originEstimateLabel} · Scope Items`,
            originEstimateLabel,
            lines: (budget.line_items ?? []).map((line) => ({
              id: line.id,
              budgetId: budget.id,
              label: `${line.cost_code_code ?? "CC"} - ${line.description ?? "Line"} (#${line.id})`,
              cost_code_code: line.cost_code_code ?? "",
              planned_amount: line.planned_amount ?? "0.00",
              actual_spend: line.actual_spend ?? "0.00",
              remaining_amount: line.remaining_amount ?? "0.00",
            })),
          };
        })
        .filter((group) => group.lines.length > 0);
      setBudgetLineGroups(groups);
    } catch {
      setBudgetLineGroups([]);
    }
  }

  async function createVendorBill(payloadBody: VendorBillPayload) {
    const response = await fetch(
      `${normalizedBaseUrl}/projects/${payloadBody.projectId}/vendor-bills/`,
      {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          vendor: payloadBody.vendor,
          bill_number: payloadBody.bill_number,
          status: payloadBody.status,
          issue_date: payloadBody.issue_date,
          due_date: payloadBody.due_date,
          scheduled_for: payloadBody.scheduled_for ?? null,
          total: payloadBody.total,
          notes: payloadBody.notes,
          allocations: payloadBody.allocations ?? [],
        }),
      },
    );
    const payload: ApiResponse = await response.json();

    if (response.status === 409 && payload.error?.code === "duplicate_detected") {
      const duplicateData = payload.data as { duplicate_candidates?: VendorBillRecord[] };
      setDuplicateCandidates(duplicateData.duplicate_candidates ?? []);
      setStatusMessage("Duplicate blocked: void existing matching bill(s) before reusing this bill number.");
      return;
    }

    if (!response.ok) {
      setStatusMessage(payload.error?.message ?? "Create vendor bill failed.");
      return;
    }

    const created = payload.data as VendorBillRecord;
    setVendorBills((current) => [created, ...current]);
    setBillStatusFilters((current) =>
      current.includes(created.status) ? current : [...current, created.status],
    );
    setSelectedVendorBillId(String(created.id));
    hydrate(created);
    setCreateErrorMessage("");
    setNewBillNumber("");
    setNewTotal("0.00");
    setNewNotes("");
    setNewAllocations([createEmptyAllocationRow()]);
    setDuplicateCandidates([]);
    setStatusMessage(`Created vendor bill #${created.id}.`);
  }

  async function handleCreateVendorBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateErrorMessage("");
    const projectId = Number(selectedProjectId);
    const vendor = Number(newVendorId);
    if (!projectId) {
      setCreateErrorMessage("Select a project first.");
      return;
    }
    if (!vendor) {
      setCreateErrorMessage("Select an active vendor first.");
      return;
    }
    if (!activeVendors.find((row) => row.id === vendor)) {
      setCreateErrorMessage("Selected vendor is inactive. Pick an active vendor.");
      return;
    }
    if (createIsOverAllocated) {
      setCreateErrorMessage("Allocated amount cannot exceed bill total.");
      return;
    }

    setStatusMessage("Creating vendor bill...");
    const normalizedAllocations = newAllocations
      .filter((row) => row.budget_line && row.amount)
      .map((row) => ({
        budget_line: Number(row.budget_line),
        amount: row.amount,
        note: row.note,
      }));
    await createVendorBill({
      projectId,
      vendor,
      bill_number: newBillNumber,
      status: newStatus,
      issue_date: newIssueDate,
      due_date: newDueDate,
      scheduled_for: newScheduledFor || null,
      total: newTotal,
      notes: newNotes,
      allocations: normalizedAllocations,
    });
  }

  function handleSelectVendorBill(id: string) {
    setSelectedVendorBillId(id);
    const selected = vendorBills.find((row) => String(row.id) === id);
    if (!selected) return;

    hydrate(selected);
  }

  function handleStartNewVendorBill() {
    const today = todayIsoDate();
    const due = dueDateIsoDate();
    setSelectedVendorBillId("");
    setCreateErrorMessage("");
    setDuplicateCandidates([]);
    setNewBillNumber("");
    setNewReceivedDate(today);
    setNewIssueDate(today);
    setNewDueDate(due);
    setNewCurrency("USD");
    setNewSubtotal("0.00");
    setNewTaxAmount("0.00");
    setNewShippingAmount("0.00");
    setNewScheduledFor("");
    setNewStatus(createStatusOptions[0] ?? billStatuses[0] ?? "planned");
    setNewTotal("0.00");
    setNewNotes("");
    setNewAllocations([createEmptyAllocationRow()]);
    if (activeVendors[0]) {
      setNewVendorId(String(activeVendors[0].id));
    }
    setStatusMessage("New vendor bill create mode.");
  }

  async function handleSaveVendorBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const vendorBillId = Number(selectedVendorBillId);
    const vendor = Number(vendorId);
    if (!vendorBillId) {
      setStatusMessage("Select a vendor bill first.");
      return;
    }
    if (!vendor) {
      setStatusMessage("Select a vendor first.");
      return;
    }
    if (scheduledFor && scheduledFor < todayIsoDate()) {
      setStatusMessage("Scheduled for date cannot be in the past.");
      return;
    }

    setStatusMessage("Saving vendor bill...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/vendor-bills/${vendorBillId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          vendor,
          bill_number: billNumber,
          issue_date: issueDate,
          due_date: dueDate,
          scheduled_for: scheduledFor || null,
          total,
          notes,
          allocations: allocations
            .filter((row) => row.budget_line && row.amount)
            .map((row) => ({
              budget_line: Number(row.budget_line),
              amount: row.amount,
              note: row.note,
            })),
          status,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (response.status === 409 && payload.error?.code === "duplicate_detected") {
        const duplicateData = payload.data as { duplicate_candidates?: VendorBillRecord[] };
        setDuplicateCandidates(duplicateData.duplicate_candidates ?? []);
        setStatusMessage("Duplicate blocked: void existing matching bill(s) before reusing this bill number.");
        return;
      }
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Save vendor bill failed.");
        return;
      }

      const updated = payload.data as VendorBillRecord;
      setVendorBills((current) =>
        current.map((vendorBill) => (vendorBill.id === updated.id ? updated : vendorBill)),
      );
      setDuplicateCandidates([]);
      setStatusMessage(`Saved vendor bill #${updated.id}.`);
    } catch {
      setStatusMessage("Could not reach vendor bill detail endpoint.");
    }
  }

  async function handleQuickVendorBillStatus(nextStatus: VendorBillStatus) {
    if (!canMutateVendorBills) {
      setStatusMessage(`Role ${role} is read-only for vendor bill mutations.`);
      return;
    }
    const vendorBillId = Number(selectedVendorBillId);
    if (!vendorBillId) {
      setStatusMessage("Select a vendor bill first.");
      return;
    }
    setStatusMessage(`Updating vendor bill status to ${nextStatus}...`);
    try {
      const response = await fetch(`${normalizedBaseUrl}/vendor-bills/${vendorBillId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Quick status update failed.");
        return;
      }
      const updated = payload.data as VendorBillRecord;
      setVendorBills((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      hydrate(updated);
      setStatusMessage(`Updated vendor bill #${updated.id} to ${updated.status}.`);
    } catch {
      setStatusMessage("Could not reach vendor bill quick status endpoint.");
    }
  }

  async function handleUpdateVendorBillStatus() {
    if (!viewerNextStatus) {
      setStatusMessage("Select a next status first.");
      return;
    }
    await handleQuickVendorBillStatus(viewerNextStatus);
  }

  function handleRecreateAsNewDraftTemplate() {
    if (!selectedVendorBillId) {
      setStatusMessage("Select a vendor bill first.");
      return;
    }
    const selected = vendorBills.find((row) => String(row.id) === selectedVendorBillId);
    if (!selected) {
      setStatusMessage("Selected vendor bill could not be found.");
      return;
    }
    setNewVendorId(String(selected.vendor));
    setNewBillNumber("");
    setNewReceivedDate(selected.issue_date);
    setNewIssueDate(selected.issue_date);
    setNewDueDate(selected.due_date);
    setNewCurrency("USD");
    setNewSubtotal(selected.total);
    setNewTaxAmount("0.00");
    setNewShippingAmount("0.00");
    setNewScheduledFor(selected.scheduled_for ?? "");
    setNewTotal(selected.total);
    setNewNotes(selected.notes || "");
    const copiedAllocations =
      selected.allocations?.map((row) =>
        toAllocationFormRow({
          budget_line: row.budget_line,
          amount: row.amount,
          note: row.note || "",
        }),
      ) ?? [];
    setNewAllocations(
      copiedAllocations.length > 0 ? copiedAllocations : [createEmptyAllocationRow()],
    );
    setSelectedVendorBillId("");
    setDuplicateCandidates([]);
    setCreateErrorMessage("Enter a new bill number, then create the recreated planned bill.");
    setStatusMessage(`Copied bill #${selected.id} into create form.`);
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadVendorBillPolicy();
      void loadDependencies();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const today = todayIsoDate();
    const due = dueDateIsoDate();
    setNewReceivedDate((current) => current || today);
    setNewIssueDate((current) => current || today);
    setNewDueDate((current) => current || due);
    setReceivedDate((current) => current || today);
    setIssueDate((current) => current || today);
    setDueDate((current) => current || due);
  }, []);

  useEffect(() => {
    if (!token || !selectedProjectId) {
      return;
    }
    void loadBudgetLineOptions(Number(selectedProjectId));
    const timer = window.setTimeout(() => {
      void loadVendorBills();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedProjectId]);

  useEffect(() => {
    setCurrentProjectPage(1);
  }, [projectSearch, projectStatusFilters]);

  useEffect(() => {
    if (!statusFilteredProjects.length) {
      return;
    }
    const selectedStillVisible = statusFilteredProjects.some(
      (project) => String(project.id) === selectedProjectId,
    );
    if (selectedStillVisible) {
      return;
    }
    setSelectedProjectId(String(statusFilteredProjects[0].id));
  }, [statusFilteredProjects, selectedProjectId]);

  useEffect(() => {
    if (!filteredVendorBills.length) {
      return;
    }
    if (!selectedVendorBillId) {
      return;
    }
    const selectedStillVisible = filteredVendorBills.some(
      (vendorBill) => String(vendorBill.id) === selectedVendorBillId,
    );
    if (selectedStillVisible) {
      return;
    }
    const fallbackVendorBill = filteredVendorBills[0];
    setSelectedVendorBillId(String(fallbackVendorBill.id));
    hydrate(fallbackVendorBill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredVendorBills, selectedVendorBillId]);

  useEffect(() => {
    if (!selectedVendorBill) {
      setViewerNextStatus("");
      return;
    }
    const nextStatuses = allowedStatusTransitions[selectedVendorBill.status] ?? [];
    setViewerNextStatus((current) => (nextStatuses.includes(current) ? current : (nextStatuses[0] ?? "")));
  }, [allowedStatusTransitions, selectedVendorBill]);

  useEffect(() => {
    if (!budgetLineMetaById.size) {
      return;
    }
    const hydrateGenericRows = (rows: AllocationFormRow[]) => {
      let changed = false;
      const next = rows.map((row) => {
        if (!row.budget_line || row.ui_line_key) {
          return row;
        }
        const meta = budgetLineMetaById.get(Number(row.budget_line));
        const code = meta?.cost_code_code ?? "";
        if (!meta || !GENERIC_BUDGET_COST_CODES.has(code)) {
          return row;
        }
        changed = true;
        return {
          ...row,
          ui_line_key: `generic:${code}`,
          ui_target_budget_id: meta.budgetId,
        };
      });
      return changed ? next : rows;
    };
    setAllocations((current) => hydrateGenericRows(current));
    setNewAllocations((current) => hydrateGenericRows(current));
  }, [budgetLineMetaById]);

  return (
    <section className={styles.console}>
      {projects.length > 0 ? (
        <section className={invoiceStyles.controlBar}>
          <div className={invoiceStyles.projectSelector}>
            <div className={invoiceStyles.panelHeader}>
              <h3>Project List</h3>
              <span className={invoiceStyles.countBadge}>
                {statusFilteredProjects.length}/{projects.length}
              </span>
            </div>

            {!isProjectScoped ? (
              <>
                <label className={invoiceStyles.searchField}>
                  <span>Search projects</span>
                  <input
                    value={projectSearch}
                    onChange={(event) => setProjectSearch(event.target.value)}
                    placeholder="Search by id, name, customer, or status"
                  />
                </label>
                <div className={invoiceStyles.projectFilters}>
                  <span className={invoiceStyles.projectFiltersLabel}>Project status filter</span>
                  <div className={invoiceStyles.projectFilterButtons}>
                    {(["prospect", "active", "on_hold", "completed", "cancelled"] as ProjectStatusValue[]).map(
                      (statusValue) => {
                        const active = projectStatusFilters.includes(statusValue);
                        return (
                          <button
                            key={statusValue}
                            type="button"
                            className={`${invoiceStyles.projectFilterButton} ${
                              active
                                ? `${invoiceStyles.projectFilterButtonActive} ${projectStatusClass(statusValue)}`
                                : invoiceStyles.projectFilterButtonInactive
                            }`}
                            onClick={() => toggleProjectStatusFilter(statusValue)}
                          >
                            {projectStatusLabel(statusValue)}
                          </button>
                        );
                      },
                    )}
                  </div>
                  <div className={invoiceStyles.projectFilterActions}>
                    <button
                      type="button"
                      className={invoiceStyles.projectFilterActionButton}
                      onClick={() =>
                        setProjectStatusFilters(["active", "on_hold", "prospect", "completed", "cancelled"])
                      }
                    >
                      Show all projects
                    </button>
                    <button
                      type="button"
                      className={invoiceStyles.projectFilterActionButton}
                      onClick={() => setProjectStatusFilters(DEFAULT_PROJECT_STATUS_FILTERS)}
                    >
                      Reset default
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className={invoiceStyles.inlineHint}>
                Project context:{" "}
                {selectedProject
                  ? `#${selectedProject.id} - ${selectedProject.name} (${selectedProject.customer_display_name})`
                  : `#${scopedProjectId}`}
              </p>
            )}

            <div className={invoiceStyles.projectTableWrap}>
              <table className={invoiceStyles.projectTable}>
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Customer</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedProjects.length ? (
                    pagedProjects.map((project) => {
                      const isActive = String(project.id) === selectedProjectId;
                      return (
                        <tr
                          key={project.id}
                          className={`${invoiceStyles.projectRow} ${isActive ? invoiceStyles.projectRowActive : ""}`}
                          onClick={() => handleSelectProject(project)}
                        >
                          <td className={invoiceStyles.projectCellTitle}>
                            <strong>#{project.id}</strong> {project.name}
                          </td>
                          <td>{project.customer_display_name}</td>
                          <td>
                            {project.status ? (
                              <span className={`${invoiceStyles.projectStatus} ${projectStatusClass(project.status)}`}>
                                {projectStatusLabel(project.status)}
                              </span>
                            ) : (
                              <span className={invoiceStyles.projectStatus}>Unknown</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={3} className={invoiceStyles.projectEmptyCell}>
                        No projects match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {!isProjectScoped ? (
                <div className={invoiceStyles.projectPagination}>
                  <button
                    type="button"
                    className={invoiceStyles.projectFilterActionButton}
                    onClick={() => setCurrentProjectPage((page) => Math.max(1, page - 1))}
                    disabled={currentProjectPageSafe <= 1}
                  >
                    Prev
                  </button>
                  <span>
                    Page {currentProjectPageSafe} of {totalProjectPages}
                  </span>
                  <button
                    type="button"
                    className={invoiceStyles.projectFilterActionButton}
                    onClick={() => setCurrentProjectPage((page) => Math.min(totalProjectPages, page + 1))}
                    disabled={currentProjectPageSafe >= totalProjectPages}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <p>Create or load a project before entering bills.</p>
      )}

      <section className={`${invoiceStyles.panel} ${invoiceStyles.viewerPanel}`}>
        <div className={invoiceStyles.panelHeader}>
          <h3>Project Bills</h3>
          <span className={invoiceStyles.countBadge}>
            {filteredVendorBills.length}/{vendorBills.length}
          </span>
        </div>

        {selectedProject ? (
          <p className={invoiceStyles.inlineHint}>
            {selectedProject.name} · {selectedProject.customer_display_name}
          </p>
        ) : null}

        <div className={styles.statusFilters}>
          <span className={styles.statusFiltersLabel}>Bill status filter</span>
          <div className={styles.statusFilterButtons}>
            {billStatuses.map((statusValue) => {
              const active = billStatusFilters.includes(statusValue);
              const statusClass = `statusFilter${statusValue[0].toUpperCase()}${statusValue.slice(1)}`;
              return (
                <button
                  key={statusValue}
                  type="button"
                  className={`${invoiceStyles.statusFilterPill} ${
                    active
                      ? `${invoiceStyles.statusFilterPillActive} ${styles[statusClass] ?? ""}`
                      : invoiceStyles.statusFilterPillInactive
                  }`}
                  aria-pressed={active}
                  onClick={() => toggleBillStatusFilter(statusValue)}
                >
                  {statusDisplayLabel(statusValue)}
                </button>
              );
            })}
          </div>
          <label className={invoiceStyles.field}>
            <span>Due filter</span>
            <select
              value={dueFilter}
              onChange={(event) => setDueFilter(event.target.value as "all" | "due_soon" | "overdue")}
            >
              <option value="all">All</option>
              <option value="due_soon">Due soon ({dueSoonWindowDays}d)</option>
              <option value="overdue">Overdue</option>
            </select>
          </label>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Bill</th>
                <th>Vendor</th>
                <th>Status</th>
                <th>Issue</th>
                <th>Due</th>
                <th>Total</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {filteredVendorBills.length ? (
                filteredVendorBills.map((vendorBill) => {
                  const isSelected = selectedVendorBillId === String(vendorBill.id);
                  return (
                    <tr
                      key={vendorBill.id}
                      className={isSelected ? styles.rowSelected : ""}
                      onClick={() => handleSelectVendorBill(String(vendorBill.id))}
                    >
                      <td>
                        <strong>#{vendorBill.id}</strong> {vendorBill.bill_number}
                      </td>
                      <td>{vendorBill.vendor_name}</td>
                      <td>
                        <span className={`${styles.tableStatusBadge} ${statusBadgeClass(vendorBill.status)}`}>
                          {statusDisplayLabel(vendorBill.status)}
                        </span>
                      </td>
                      <td>{formatDateDisplay(vendorBill.issue_date)}</td>
                      <td>{formatDateDisplay(vendorBill.due_date)}</td>
                      <td>${vendorBill.total}</td>
                      <td>${vendorBill.balance_due}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className={invoiceStyles.projectEmptyCell}>
                    No bills match the selected status/due filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <section className={invoiceStyles.viewerStatusPanel}>
          <div className={invoiceStyles.panelHeader}>
            <h3>Bill Status & Recreate</h3>
            <span className={invoiceStyles.countBadge}>
              {selectedVendorBill ? `#${selectedVendorBill.id}` : "No selection"}
            </span>
          </div>

          {selectedVendorBill ? (
            <>
              <p className={invoiceStyles.inlineHint}>
                {selectedVendorBill.vendor_name} / {selectedVendorBill.bill_number} ({statusDisplayLabel(selectedVendorBill.status)})
              </p>
              <div className={styles.statusPicker}>
                <span className={invoiceStyles.lifecycleFieldLabel}>Next status</span>
                <div className={styles.statusPills}>
                  {quickStatusOptions.map((statusOption) => {
                    const active = statusOption === viewerNextStatus;
                    return (
                      <button
                        key={`viewer-status-${statusOption}`}
                        type="button"
                        className={`${styles.statusPill} ${
                          active ? statusPillClass(statusOption) : styles.statusPillInactive
                        } ${active ? styles.statusPillActive : ""}`}
                        aria-pressed={active}
                        onClick={() => setViewerNextStatus(statusOption)}
                      >
                        {statusDisplayLabel(statusOption)}
                      </button>
                    );
                  })}
                </div>
              </div>
              {quickStatusOptions.length === 0 ? (
                <p className={invoiceStyles.inlineHint}>No next statuses available for this bill.</p>
              ) : null}
              <div className={invoiceStyles.buttonRow}>
                <button
                  type="button"
                  className={invoiceStyles.secondaryButton}
                  onClick={() => void handleUpdateVendorBillStatus()}
                  disabled={!selectedVendorBillId || !viewerNextStatus || !canMutateVendorBills}
                >
                  Save Status
                </button>
                <button
                  type="button"
                  className={invoiceStyles.primaryButton}
                  onClick={handleRecreateAsNewDraftTemplate}
                  disabled={!selectedVendorBillId}
                >
                  Recreate as New Planned
                </button>
              </div>
            </>
          ) : (
            <p className={invoiceStyles.emptyState}>Select a vendor bill to manage status or recreate it as new.</p>
          )}
        </section>
      </section>

      <div>
        <button type="button" className={invoiceStyles.secondaryButton} onClick={handleStartNewVendorBill}>
          New Bill
        </button>
      </div>

      <form className={styles.billForm} onSubmit={handleSubmitVendorBillForm}>
        <h3 className={styles.formTitle}>Bill Intake</h3>

        <section className={styles.formSection}>
          <div className={styles.formSectionHeader}>
            <h4 className={styles.formSectionTitle}>Bill Details</h4>
            <p className={styles.formSectionHint}>Capture vendor metadata, dates, and financial totals.</p>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.fieldSpan2}>
              Vendor
              <select
                value={formVendorId}
                onChange={(event) => setFormVendorId(event.target.value)}
                required
              >
                <option value="">Select vendor</option>
                {formVendorId &&
                !vendorOptions.some((vendor) => String(vendor.id) === String(formVendorId)) ? (
                  <option value={formVendorId}>#{formVendorId} - Vendor record unavailable</option>
                ) : null}
                {vendorOptions.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    #{vendor.id} - {vendor.name} [{vendor.vendor_type}]
                    {vendor.is_canonical ? " [canonical]" : ""}
                    {!vendor.is_active ? " [inactive]" : ""}
                  </option>
                ))}
              </select>
            </label>

            {vendorOptions.length === 0 ? (
              <p className={`${styles.formInlineHint} ${styles.fieldSpan2}`}>
                No vendors available. Add a vendor first.
              </p>
            ) : !isEditingMode && activeVendors.length === 0 ? (
              <p className={`${styles.formInlineHint} ${styles.fieldSpan2}`}>
                No active vendors available for create. Reactivate one or create a new vendor.
              </p>
            ) : null}

            <label>
              Vendor bill number
              <input
                value={formBillNumber}
                onChange={(event) => setFormBillNumber(event.target.value)}
                required
                disabled={!selectedProjectId}
              />
            </label>

            <label>
              Currency
              <input value={formCurrency || "USD"} disabled readOnly />
            </label>

            <label>
              Received date
              <input
                type="date"
                value={formReceivedDate}
                onChange={(event) => setFormReceivedDate(event.target.value)}
                required
                disabled={!selectedProjectId}
              />
            </label>

            <label>
              Bill date
              <input
                type="date"
                value={formIssueDate}
                onChange={(event) => setFormIssueDate(event.target.value)}
                required
                disabled={!selectedProjectId}
              />
            </label>

            <label>
              Due date
              <input
                type="date"
                value={formDueDate}
                onChange={(event) => setFormDueDate(event.target.value)}
                required
                disabled={!selectedProjectId}
              />
            </label>

            {!isEditingMode || canEditScheduledFor ? (
              <label>
                Scheduled for
                <input
                  type="date"
                  value={formScheduledFor}
                  onChange={(event) => setFormScheduledFor(event.target.value)}
                  disabled={!selectedProjectId || !canEditScheduledFor}
                />
              </label>
            ) : null}

            <label>
              Subtotal
              <input
                value={formSubtotal}
                onChange={(event) => setFormSubtotal(event.target.value)}
                inputMode="decimal"
                required
                disabled={!selectedProjectId}
              />
            </label>

            <label>
              Tax amount
              <input
                value={formTaxAmount}
                onChange={(event) => setFormTaxAmount(event.target.value)}
                inputMode="decimal"
                disabled={!selectedProjectId}
              />
            </label>

            <label>
              Shipping / freight amount
              <input
                value={formShippingAmount}
                onChange={(event) => setFormShippingAmount(event.target.value)}
                inputMode="decimal"
                disabled={!selectedProjectId}
              />
            </label>

            <label>
              Total
              <input
                value={formTotal}
                onChange={(event) => setFormTotal(event.target.value)}
                inputMode="decimal"
                required
                disabled={!selectedProjectId}
              />
            </label>

            <div className={`${styles.formActionsRow} ${styles.fieldSpan2}`}>
              <button
                type="button"
                className={styles.formSecondaryButton}
                onClick={() => setFormTotal(computedTotalFromParts)}
                disabled={!selectedProjectId}
              >
                Use calculated total ({computedTotalFromParts})
              </button>
            </div>

            <div className={`${styles.fieldSpan2} ${styles.allocationsBlock}`}>
              <div className={styles.formSectionHeader}>
                <h4 className={styles.formSectionTitle}>Line Item Allocation</h4>
                <p className={styles.formSectionHint}>Map this bill to project estimate lines.</p>
              </div>
              <fieldset className={styles.allocationFieldset}>
                <legend>{isEditingMode ? "Allocations" : "Allocations (optional in planned)"}</legend>
                <div className={styles.allocationHeader}>
                  <span>Estimate line</span>
                  <span>Origin estimate</span>
                  <span>Amount</span>
                  <span>Note</span>
                  <span />
                </div>
                {!hasBudgetLineOptions ? (
                  <p className={styles.hintText}>
                    No estimate-backed lines available for this project yet. Approve an estimate first.
                  </p>
                ) : null}
                <div className={styles.allocationRows}>
                  {formAllocations.map((row, index) => {
                    const selectedLineMeta = budgetLineMetaById.get(Number(row.budget_line));
                    const inferredGenericCode =
                      selectedLineMeta && GENERIC_BUDGET_COST_CODES.has(selectedLineMeta.cost_code_code ?? "")
                        ? (selectedLineMeta.cost_code_code ?? "")
                        : "";
                    const selectedLineKey =
                      row.ui_line_key ||
                      (inferredGenericCode ? `generic:${inferredGenericCode}` : (row.budget_line ? String(row.budget_line) : ""));
                    const selectedGenericCode = selectedLineKey.startsWith("generic:")
                      ? selectedLineKey.slice("generic:".length)
                      : "";
                    const genericTargets = selectedGenericCode
                      ? (genericLineOptionsByCostCode.get(selectedGenericCode) ?? [])
                      : [];
                    const selectedTargetBudgetId =
                      row.ui_target_budget_id ?? selectedLineMeta?.budgetId;
                    return (
                      <div key={`form-allocation-${index}`} className={styles.allocationRowWrap}>
                        <div className={styles.allocationRow}>
                          <select
                            value={selectedLineKey}
                            onChange={(event) => {
                              const nextLineKey = event.target.value;
                              if (nextLineKey.startsWith("generic:")) {
                                const genericCode = nextLineKey.slice("generic:".length);
                                const targetOptions = genericLineOptionsByCostCode.get(genericCode) ?? [];
                                const targetBudgetId =
                                  row.ui_target_budget_id ?? selectedLineMeta?.budgetId ?? targetOptions[0]?.budgetId;
                                const matchedLine = targetOptions.find((option) => option.budgetId === targetBudgetId);
                                updateFormAllocation(index, {
                                  ui_line_key: nextLineKey,
                                  ui_target_budget_id: targetBudgetId,
                                  budget_line: matchedLine?.id ?? 0,
                                });
                                return;
                              }
                              const nextLineId = Number(nextLineKey || 0);
                              const nextLineMeta = budgetLineMetaById.get(nextLineId);
                              updateFormAllocation(index, {
                                ui_line_key: "",
                                ui_target_budget_id: nextLineMeta?.budgetId,
                                budget_line: nextLineId,
                              });
                            }}
                            disabled={!hasBudgetLineOptions}
                          >
                            <option value="">Select estimate line</option>
                            <optgroup label="Generic scope buckets">
                              {GENERIC_BUDGET_LINE_SPECS.filter(
                                (spec) => (genericLineOptionsByCostCode.get(spec.costCode)?.length ?? 0) > 0,
                              ).map((spec) => (
                                <option key={spec.costCode} value={`generic:${spec.costCode}`}>
                                  {spec.label}
                                </option>
                              ))}
                            </optgroup>
                            {budgetLineGroups.map((group) => (
                              <optgroup key={group.budgetId} label={group.budgetLabel}>
                                {group.lines
                                  .filter(
                                    (option) => !GENERIC_BUDGET_COST_CODES.has(option.cost_code_code ?? ""),
                                  )
                                  .map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                  ))}
                              </optgroup>
                            ))}
                          </select>
                          <select
                            value={selectedTargetBudgetId ? String(selectedTargetBudgetId) : ""}
                            onChange={(event) => {
                              if (!selectedGenericCode) {
                                return;
                              }
                              const nextBudgetId = Number(event.target.value || 0);
                              const matchedLine = genericTargets.find(
                                (option) => option.budgetId === nextBudgetId,
                              );
                              updateFormAllocation(index, {
                                ui_line_key: `generic:${selectedGenericCode}`,
                                ui_target_budget_id: nextBudgetId || undefined,
                                budget_line: matchedLine?.id ?? 0,
                              });
                            }}
                            disabled={!selectedGenericCode || genericTargets.length === 0}
                          >
                            <option value="">
                              {selectedGenericCode
                                ? "Select origin estimate"
                                : selectedTargetBudgetId
                                  ? "Origin estimate"
                                  : "N/A (select line)"}
                            </option>
                            {!selectedGenericCode && selectedTargetBudgetId ? (
                              <option value={selectedTargetBudgetId}>
                                {originEstimateLabelByBudgetId.get(selectedTargetBudgetId) ??
                                  `Estimate baseline (${selectedTargetBudgetId})`}
                              </option>
                            ) : null}
                            {genericTargets.map((option) => (
                              <option key={`${selectedGenericCode}-${option.budgetId}`} value={option.budgetId}>
                                {originEstimateLabelByBudgetId.get(option.budgetId) ??
                                  `Estimate baseline (${option.budgetId})`}
                              </option>
                            ))}
                          </select>
                          <input
                            value={row.amount}
                            onChange={(event) => {
                              updateFormAllocation(index, { amount: event.target.value });
                            }}
                            placeholder="Amount"
                            inputMode="decimal"
                            disabled={!hasBudgetLineOptions}
                          />
                          <input
                            value={row.note}
                            onChange={(event) => {
                              updateFormAllocation(index, { note: event.target.value });
                            }}
                            placeholder="Note (optional)"
                            disabled={!hasBudgetLineOptions}
                          />
                          <button
                            type="button"
                            className={styles.formDangerButton}
                            onClick={() => removeFormAllocation(index)}
                            disabled={formAllocations.length <= 1}
                          >
                            Remove
                          </button>
                        </div>
                        {selectedLineMeta ? (
                          <p className={styles.allocationMeta}>
                            Approved: {formatMoney(selectedLineMeta.planned_amount)} | Spent:{" "}
                            {formatMoney(selectedLineMeta.actual_spend)} | Remaining:{" "}
                            {formatMoney(selectedLineMeta.remaining_amount)}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className={styles.formSecondaryButton}
                  onClick={addFormAllocation}
                  disabled={!hasBudgetLineOptions}
                >
                  Add Allocation Row
                </button>
                <p className={styles.allocationTotals}>
                  Bill total: {formTotal} | Allocated: {formAllocationTotal.toFixed(2)} | Unallocated:{" "}
                  <span className={hasAllocationMismatch ? styles.unallocatedMismatch : undefined}>
                    {formUnallocated.toFixed(2)}
                  </span>
                </p>
                <div className={styles.suggestedTotalRow}>
                  <span>Suggested total from allocations: {formSuggestedTotal}</span>
                  <button
                    type="button"
                    className={styles.formSecondaryButton}
                    onClick={() => setFormTotal(formSuggestedTotal)}
                    disabled={!isEditingMode && !hasBudgetLineOptions}
                  >
                    Use allocated total
                  </button>
                </div>
                {formIsOverAllocated ? (
                  <p className={styles.errorText}>Allocated amount cannot exceed bill total.</p>
                ) : null}
                {formRequiresFullAllocation ? (
                  <p className={styles.errorText}>
                    Status <strong>{status}</strong> requires full allocation (unallocated must be 0.00).
                  </p>
                ) : null}
                {formRequiresScheduledFor && !formScheduledFor ? (
                  <p className={styles.errorText}>
                    Status <strong>scheduled</strong> requires a <strong>scheduled for</strong> date.
                  </p>
                ) : null}
              </fieldset>
            </div>

            <label className={styles.fieldSpan2}>
              Notes
              <textarea
                value={formNotes}
                onChange={(event) => setFormNotes(event.target.value)}
                disabled={!selectedProjectId}
              />
            </label>

            {!isEditingMode ? (
              <div className={`${styles.statusPicker} ${styles.fieldSpan2}`}>
                <span className={styles.statusPickerLabel}>Initial status</span>
                <div className={styles.statusPills}>
                  {createStatusOptions.map((statusOption) => {
                    const active = statusOption === newStatus;
                    return (
                      <button
                        key={statusOption}
                        type="button"
                        className={`${styles.statusPill} ${
                          active ? statusPillClass(statusOption) : styles.statusPillInactive
                        } ${active ? styles.statusPillActive : ""}`}
                        aria-pressed={active}
                        onClick={() => setNewStatus(statusOption)}
                      >
                        {statusDisplayLabel(statusOption)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className={`${styles.submitRow} ${styles.fieldSpan2}`}>
              {!isEditingMode && createErrorMessage ? <p className={styles.errorText}>{createErrorMessage}</p> : null}
              <button
                type="submit"
                className={styles.formPrimaryButton}
                disabled={
                  !canMutateVendorBills ||
                  !selectedProjectId ||
                  !formVendorId ||
                  formIsOverAllocated ||
                  (formRequiresFullAllocation && Math.abs(formUnallocated) > allocationEpsilon) ||
                  (formRequiresScheduledFor && !formScheduledFor)
                }
              >
                {isEditingMode ? "Save Vendor Bill" : "Create Vendor Bill"}
              </button>
            </div>
          </div>
        </section>
      </form>

      {duplicateCandidates.length > 0 ? (
        <>
          <p>Duplicate candidates:</p>
          <ul>
            {duplicateCandidates.map((candidate) => (
              <li key={candidate.id}>
                #{candidate.id} {candidate.vendor_name} / {candidate.bill_number} (
                {statusDisplayLabel(candidate.status)})
              </li>
            ))}
          </ul>
          <p>Void matching bill(s) first if you need to reuse this bill number.</p>
        </>
      ) : null}

      <p>{statusMessage}</p>
      {!canMutateVendorBills ? <p>Role `{role}` can view bills but cannot create or update.</p> : null}
    </section>
  );
}
