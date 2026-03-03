"use client";

/**
 * Vendor bills (accounts payable) console. Lets users browse, create, edit,
 * and manage the lifecycle of vendor bills for a selected project. Includes
 * line-item allocation to budget scope items, duplicate detection, status
 * transitions driven by a policy contract, and a "recreate as new" workflow.
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDateDisplay, todayDateInput, futureDateInput } from "@/shared/date-format";
import { readApiErrorMessage } from "@/shared/api/error";
import {
  collapseToggleButtonStyles as collapseButtonStyles,
  ProjectListStatusValue,
  ProjectListViewer,
} from "@/shared/project-list-viewer";

import {
  defaultApiBaseUrl,
  fetchVendorBillPolicyContract,
  normalizeApiBaseUrl,
} from "../api";
import {
  AllocationFormRow,
  createEmptyAllocationRow,
  defaultBillStatusFilters,
  formatMoney,
  projectStatusLabel,
} from "../helpers";
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
import creatorStyles from "../../../shared/document-creator/creator-foundation.module.css";

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
  received: ["approved", "scheduled", "void"],
  approved: ["scheduled", "paid", "void"],
  scheduled: ["paid", "void"],
  paid: [],
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
type ProjectStatusValue = ProjectListStatusValue;
const DEFAULT_PROJECT_STATUS_FILTERS: ProjectStatusValue[] = ["active", "prospect"];
const PROJECT_STATUS_VALUES: ProjectStatusValue[] = ["prospect", "active", "on_hold", "completed", "cancelled"];

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

type VendorBillsConsoleProps = {
  scopedProjectId?: number | null;
};

/** Renders the vendor bills dashboard: project picker, bill list, status panel, and bill form. */
export function VendorBillsConsole({ scopedProjectId: scopedProjectIdProp = null }: VendorBillsConsoleProps) {
  const searchParams = useSearchParams();
  const queryProjectParam = searchParams.get("project");
  const queryProjectId =
    queryProjectParam && /^\d+$/.test(queryProjectParam) ? Number(queryProjectParam) : null;
  const scopedProjectId = scopedProjectIdProp;
  const preferredProjectId = scopedProjectId ?? queryProjectId;

  const { token, role } = useSharedSessionAuth();
  const dueSoonWindowDays = 7;
  const [statusMessage, setStatusMessage] = useState("");
  const [createErrorMessage, setCreateErrorMessage] = useState("");
  const [editErrorMessage, setEditErrorMessage] = useState("");
  const [viewerErrorMessage, setViewerErrorMessage] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilters, setProjectStatusFilters] = useState<ProjectStatusValue[]>(
    DEFAULT_PROJECT_STATUS_FILTERS,
  );
  const [isProjectListExpanded, setIsProjectListExpanded] = useState(true);

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
  const [newReceivedDate, setNewReceivedDate] = useState(todayDateInput());
  const [newIssueDate, setNewIssueDate] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
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
  const [receivedDate, setReceivedDate] = useState(todayDateInput());
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
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

  // Accordion section state for inline viewer expansion
  const [isStatusSectionOpen, setIsStatusSectionOpen] = useState(true);
  const [isAllocationsSectionOpen, setIsAllocationsSectionOpen] = useState(false);
  const [isDetailsSectionOpen, setIsDetailsSectionOpen] = useState(false);

  // Workspace visibility + flash animation
  const [isWorkspaceExpanded, setIsWorkspaceExpanded] = useState(true);
  const billFormRef = useRef<HTMLFormElement>(null);
  const [creatorFlashCount, setCreatorFlashCount] = useState(0);
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
  const projectStatusCounts = PROJECT_STATUS_VALUES.reduce<Record<ProjectStatusValue, number>>(
    (acc, statusValue) => {
      acc[statusValue] = filteredProjects.filter(
        (project) => (project.status as ProjectStatusValue) === statusValue,
      ).length;
      return acc;
    },
    {
      prospect: 0,
      active: 0,
      on_hold: 0,
      completed: 0,
      cancelled: 0,
    },
  );
  const statusFilteredProjects = scopedProjectId !== null
    ? filteredProjects.filter((project) => String(project.id) === String(scopedProjectId))
    : filteredProjects.filter((project) =>
        projectStatusFilters.includes((project.status as ProjectStatusValue) ?? "active"),
      );
  const billStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const bill of vendorBills) {
      counts[bill.status] = (counts[bill.status] ?? 0) + 1;
    }
    return counts;
  }, [vendorBills]);

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
    const today = todayDateInput();
    if (dueFilter === "overdue") {
      return bill.due_date < today;
    }
    const dueSoonDate = futureDateInput(dueSoonWindowDays);
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
  const workspaceIsLockedByStatus = selectedVendorBill ? selectedVendorBill.status !== "planned" : false;
  const workspaceIsLocked = !canMutateVendorBills || workspaceIsLockedByStatus;
  const workspaceBadgeLabel = !selectedVendorBill
    ? "CREATING"
    : workspaceIsLocked
      ? "READ-ONLY"
      : "EDITING";
  const workspaceBadgeClass = !selectedVendorBill
    ? styles.tableStatusPlanned
    : workspaceIsLocked
      ? styles[`tableStatus${selectedVendorBill.status[0].toUpperCase()}${selectedVendorBill.status.slice(1)}`] ?? ""
      : styles.tableStatusPlanned;
  const workspaceContext = selectedVendorBill
    ? `#${selectedVendorBill.id} — ${selectedVendorBill.bill_number || "Untitled"}`
    : "New vendor bill";
  const vendorOptions = vendors;
  const formVendorId = isEditingMode ? vendorId : newVendorId;
  const formBillNumber = isEditingMode ? billNumber : newBillNumber;
  const formReceivedDate = isEditingMode ? receivedDate : newReceivedDate;
  const formIssueDate = isEditingMode ? issueDate : newIssueDate;
  const formDueDate = isEditingMode ? dueDate : newDueDate;
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
  const scheduledForMissing = canEditScheduledFor && !formScheduledFor;
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

  // --- Form field delegates ---
  // Each setter routes to either the "new bill" or "edit bill" state based on mode.

  /** Routes vendor ID changes to the correct create/edit state. */
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
      if (value && value < todayDateInput()) {
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

  /** Patches a single allocation row by index. */
  function updateFormAllocation(index: number, patch: Partial<AllocationFormRow>) {
    const next = [...formAllocations];
    next[index] = { ...next[index], ...patch };
    setFormAllocations(next);
  }

  /** Removes an allocation row, keeping at least one row. */
  function removeFormAllocation(index: number) {
    const current = formAllocations;
    setFormAllocations(
      current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current,
    );
  }

  /** Appends a new blank allocation row to the form. */
  function addFormAllocation() {
    setFormAllocations([...formAllocations, createEmptyAllocationRow()]);
  }

  /** Derives the UI key and target budget for a generic-scope budget line. */
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

  /** Converts an API allocation input into a form row with resolved generic-scope UI state. */
  function toAllocationFormRow(row: VendorBillAllocationInput): AllocationFormRow {
    const genericUi = resolveGenericUiState(Number(row.budget_line));
    return {
      budget_line: Number(row.budget_line || 0),
      amount: row.amount,
      note: row.note || "",
      ...genericUi,
    };
  }

  /** Routes form submission to create or save based on the current editing mode. */
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

  /** Populates the edit form fields from a vendor bill record. */
  function hydrate(item: VendorBillRecord) {
    setVendorId(String(item.vendor));
    setBillNumber(item.bill_number);
    setReceivedDate(item.received_date ?? "");
    setIssueDate(item.issue_date);
    setDueDate(item.due_date);
    setSubtotal(item.subtotal);
    setTaxAmount(item.tax_amount);
    setShippingAmount(item.shipping_amount);
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

  /** Returns the display label for a bill status, using policy-provided labels. */
  function statusDisplayLabel(value: VendorBillStatus): string {
    return billStatusLabels[value] ?? value;
  }

  /** Returns the CSS class for a status badge in the bill table. */
  function statusBadgeClass(value: VendorBillStatus): string {
    return styles[`tableStatus${value[0].toUpperCase()}${value.slice(1)}`] ?? "";
  }

  /** Returns the CSS class for a status pill button. */
  function statusPillClass(value: VendorBillStatus): string {
    return styles[`statusPill${value[0].toUpperCase()}${value.slice(1)}`] ?? "";
  }

  /** Toggles a bill status in or out of the active filter set. */
  function toggleBillStatusFilter(nextStatus: VendorBillStatus) {
    setBillStatusFilters((current) =>
      current.includes(nextStatus)
        ? current.filter((status) => status !== nextStatus)
        : [...current, nextStatus],
    );
  }

  /** Toggles a project status in or out of the project list filter. */
  function toggleProjectStatusFilter(statusValue: ProjectStatusValue) {
    setProjectStatusFilters((current) =>
      current.includes(statusValue)
        ? current.filter((status) => status !== statusValue)
        : [...current, statusValue],
    );
  }

  /** Switches the selected project context for bill loading. */
  function handleSelectProject(project: { id: number }) {
    if (String(project.id) === selectedProjectId) {
      return;
    }
    setSelectedProjectId(String(project.id));
  }

  /** Fetches the policy contract that drives status options, transitions, and labels. */
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

  /** Loads projects and vendors in parallel on initial mount. */
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

  /** Fetches vendor bills for the selected project and auto-selects the most recent non-void bill. */
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

  /** Loads budget line items grouped by estimate origin for the allocation dropdown. */
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

  /** POSTs a new vendor bill to the API, handling duplicate detection. */
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

  /** Validates form inputs and delegates to createVendorBill. */
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
      received_date: newReceivedDate || null,
      issue_date: newIssueDate,
      due_date: newDueDate,
      scheduled_for: newScheduledFor || null,
      subtotal: newSubtotal,
      tax_amount: newTaxAmount,
      shipping_amount: newShippingAmount,
      total: newTotal,
      notes: newNotes,
      allocations: normalizedAllocations,
    });
  }

  /** Selects a vendor bill from the list and hydrates the edit form. */
  function handleSelectVendorBill(id: string) {
    setSelectedVendorBillId(id);
    setViewerErrorMessage("");
    setStatusMessage("");
    // Reset accordion sections to defaults on selection change
    setIsStatusSectionOpen(true);
    setIsAllocationsSectionOpen(false);
    setIsDetailsSectionOpen(false);
    const selected = vendorBills.find((row) => String(row.id) === id);
    if (!selected) return;

    hydrate(selected);
    setCreatorFlashCount((c) => c + 1);
  }

  /** Resets the form to create-mode with default values for a new bill. */
  function handleStartNewVendorBill() {
    const today = todayDateInput();
    const due = futureDateInput();
    setSelectedVendorBillId("");
    setCreateErrorMessage("");
    setEditErrorMessage("");
    setViewerErrorMessage("");
    setDuplicateCandidates([]);
    setNewBillNumber("");
    setNewReceivedDate(today);
    setNewIssueDate(today);
    setNewDueDate(due);
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
    setCreatorFlashCount((c) => c + 1);
  }

  /** PATCHes the currently selected vendor bill with the edit form values. */
  async function handleSaveVendorBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEditErrorMessage("");
    const vendorBillId = Number(selectedVendorBillId);
    const vendor = Number(vendorId);
    if (!vendorBillId) {
      const message = "Select a vendor bill first.";
      setEditErrorMessage(message);
      setStatusMessage(message);
      return;
    }
    if (!vendor) {
      const message = "Select a vendor first.";
      setEditErrorMessage(message);
      setStatusMessage(message);
      return;
    }
    if (scheduledFor && scheduledFor < todayDateInput()) {
      const message = "Scheduled for date cannot be in the past.";
      setEditErrorMessage(message);
      setStatusMessage(message);
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
          received_date: receivedDate || null,
          issue_date: issueDate,
          due_date: dueDate,
          scheduled_for: scheduledFor || null,
          subtotal,
          tax_amount: taxAmount,
          shipping_amount: shippingAmount,
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
        const message = "Duplicate blocked: void existing matching bill(s) before reusing this bill number.";
        setEditErrorMessage(message);
        setStatusMessage(message);
        return;
      }
      if (!response.ok) {
        const message = readApiErrorMessage(payload, "Save vendor bill failed.");
        setEditErrorMessage(message);
        setStatusMessage(message);
        return;
      }

      const updated = payload.data as VendorBillRecord;
      setVendorBills((current) =>
        current.map((vendorBill) => (vendorBill.id === updated.id ? updated : vendorBill)),
      );
      setDuplicateCandidates([]);
      setEditErrorMessage("");
      setStatusMessage(`Saved vendor bill #${updated.id}.`);
    } catch {
      const message = "Could not reach vendor bill detail endpoint.";
      setEditErrorMessage(message);
      setStatusMessage(message);
    }
  }

  /** Applies a single-field status transition to the selected vendor bill. */
  async function handleQuickVendorBillStatus(nextStatus: VendorBillStatus) {
    if (!canMutateVendorBills) {
      const message = `Role ${role} is read-only for vendor bill mutations.`;
      setViewerErrorMessage(message);
      setStatusMessage(message);
      return;
    }
    const vendorBillId = Number(selectedVendorBillId);
    if (!vendorBillId) {
      const message = "Select a vendor bill first.";
      setViewerErrorMessage(message);
      setStatusMessage(message);
      return;
    }
    setViewerErrorMessage("");
    setStatusMessage(`Updating vendor bill status to ${nextStatus}...`);
    try {
      const response = await fetch(`${normalizedBaseUrl}/vendor-bills/${vendorBillId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        const message = readApiErrorMessage(payload, "Quick status update failed.");
        setViewerErrorMessage(message);
        setStatusMessage(message);
        return;
      }
      const updated = payload.data as VendorBillRecord;
      setVendorBills((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      hydrate(updated);
      setViewerErrorMessage("");
      setStatusMessage(`Updated vendor bill #${updated.id} to ${updated.status}. History updated.`);
    } catch {
      const message = "Could not reach vendor bill quick status endpoint.";
      setViewerErrorMessage(message);
      setStatusMessage(message);
    }
  }

  /** Validates that a next status is selected, then delegates to the quick status handler. */
  async function handleUpdateVendorBillStatus() {
    if (!viewerNextStatus) {
      const message = "Select a next status first.";
      setViewerErrorMessage(message);
      setStatusMessage(message);
      return;
    }
    await handleQuickVendorBillStatus(viewerNextStatus);
  }

  /** Copies the selected bill's details into the create form for a "recreate" workflow. */
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
    setNewReceivedDate(selected.received_date ?? "");
    setNewIssueDate(selected.issue_date);
    setNewDueDate(selected.due_date);
    setNewSubtotal(selected.subtotal);
    setNewTaxAmount(selected.tax_amount);
    setNewShippingAmount(selected.shipping_amount);
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
    setCreatorFlashCount((c) => c + 1);
    setIsWorkspaceExpanded(true);
  }

  // Bootstrap: load the policy contract and project/vendor lists once authenticated.
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

  // Ensure date fields have sensible defaults on mount.
  useEffect(() => {
    const today = todayDateInput();
    const due = futureDateInput();
    setNewReceivedDate((current) => current || today);
    setNewIssueDate((current) => current || today);
    setNewDueDate((current) => current || due);
    setReceivedDate((current) => current || today);
    setIssueDate((current) => current || today);
    setDueDate((current) => current || due);
  }, []);

  // Reload vendor bills and budget lines whenever the selected project changes.
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

  // If the selected project is filtered out, fall back to the first visible project.
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

  // If the selected bill is no longer visible after filter changes, fall back to the first match.
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

  // Keep the viewer's next-status picker in sync with the selected bill's allowed transitions.
  useEffect(() => {
    if (!selectedVendorBill) {
      setViewerNextStatus("");
      return;
    }
    const nextStatuses = allowedStatusTransitions[selectedVendorBill.status] ?? [];
    setViewerNextStatus((current) => (nextStatuses.includes(current) ? current : (nextStatuses[0] ?? "")));
  }, [allowedStatusTransitions, selectedVendorBill]);

  // Back-fill generic scope UI keys on allocation rows once budget line metadata loads.
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

  // Flash animation for the workspace form when switching bills or creating new.
  useEffect(() => {
    if (creatorFlashCount === 0) return;
    const el = billFormRef.current;
    if (!el) return;
    el.classList.remove(creatorStyles.sheetFlash);
    void el.offsetWidth;
    el.classList.add(creatorStyles.sheetFlash);
    const cleanup = () => el.classList.remove(creatorStyles.sheetFlash);
    el.addEventListener("animationend", cleanup, { once: true });
    return () => el.removeEventListener("animationend", cleanup);
  }, [creatorFlashCount]);

  return (
    <section className={styles.console}>
      {projects.length > 0 ? (
        <ProjectListViewer
          isExpanded={isProjectListExpanded}
          onToggleExpanded={() => setIsProjectListExpanded((current) => !current)}
          showSearchAndFilters={!isProjectScoped}
          contextHint={
            selectedProject
              ? `Project context: #${selectedProject.id} - ${selectedProject.name} (${selectedProject.customer_display_name})`
              : `Project context: #${scopedProjectId}`
          }
          searchValue={projectSearch}
          onSearchChange={setProjectSearch}
          statusValues={PROJECT_STATUS_VALUES}
          statusFilters={projectStatusFilters}
          statusCounts={projectStatusCounts}
          onToggleStatusFilter={toggleProjectStatusFilter}
          onShowAllStatuses={() =>
            setProjectStatusFilters(["active", "on_hold", "prospect", "completed", "cancelled"])
          }
          onResetStatuses={() => setProjectStatusFilters(DEFAULT_PROJECT_STATUS_FILTERS)}
          projects={statusFilteredProjects.map((project) => ({
            id: project.id,
            name: project.name,
            customer_display_name: project.customer_display_name,
            status: project.status ?? "",
          }))}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
          statusLabel={projectStatusLabel}
        />
      ) : (
        <p>Create or load a project before entering bills.</p>
      )}

      {/* ── Viewer Panel: bill table + inline expansion ──────────── */}
      <div className={styles.viewerPanel}>
        <div className={styles.panelHeader}>
          <h3>{selectedProject ? `Bills for: ${selectedProject.name}` : "Bills"}</h3>
          <div className={styles.panelHeaderActions}>
            <button
              type="button"
              className={collapseButtonStyles.collapseButton}
              style={{ background: "var(--surface)" }}
              onClick={() => setIsWorkspaceExpanded((current) => !current)}
              aria-expanded={isWorkspaceExpanded}
            >
              {isWorkspaceExpanded ? "Hide Form" : "Show Form"}
            </button>
          </div>
        </div>

        <div className={styles.statusFilters}>
          <div className={styles.statusFilterButtons}>
            {billStatuses.map((statusValue) => {
              const active = billStatusFilters.includes(statusValue);
              const statusClass = `statusFilter${statusValue[0].toUpperCase()}${statusValue.slice(1)}`;
              return (
                <button
                  key={statusValue}
                  type="button"
                  className={`${styles.filterPill} ${
                    active
                      ? `${styles.filterPillActive} ${styles[statusClass] ?? ""}`
                      : styles.filterPillInactive
                  }`}
                  aria-pressed={active}
                  onClick={() => toggleBillStatusFilter(statusValue)}
                >
                  <span>{statusDisplayLabel(statusValue)}</span>
                  <span className={styles.filterPillCount}>{billStatusCounts[statusValue] ?? 0}</span>
                </button>
              );
            })}
            {(["all", "due_soon", "overdue"] as const).map((filterValue) => {
              const active = dueFilter === filterValue;
              const label = filterValue === "all" ? "All Due" : filterValue === "due_soon" ? `Due Soon (${dueSoonWindowDays}d)` : "Overdue";
              return (
                <button
                  key={filterValue}
                  type="button"
                  className={`${styles.filterPill} ${
                    active ? `${styles.filterPillActive} ${styles.filterPillDue}` : styles.filterPillInactive
                  }`}
                  aria-pressed={active}
                  onClick={() => setDueFilter(filterValue)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className={styles.filterActions}>
            <button
              type="button"
              className={styles.filterActionButton}
              onClick={() => { setBillStatusFilters([...billStatuses]); setDueFilter("all"); }}
            >
              Show All
            </button>
            <button
              type="button"
              className={styles.filterActionButton}
              onClick={() => { setBillStatusFilters(defaultBillStatusFilters(billStatuses)); setDueFilter("all"); }}
            >
              Reset Filters
            </button>
          </div>
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
                  return [
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
                    </tr>,
                    isSelected ? (
                      <tr key={`expanded-${vendorBill.id}`} className={styles.expandedRow}>
                        <td colSpan={7}>
                          <div className={styles.expandedSections}>
                            {/* Status & Actions */}
                            <div className={styles.viewerSection}>
                              <button
                                type="button"
                                className={styles.viewerSectionToggle}
                                onClick={(e) => { e.stopPropagation(); setIsStatusSectionOpen((v) => !v); }}
                                aria-expanded={isStatusSectionOpen}
                              >
                                <h4>Status &amp; Actions</h4>
                                <span className={styles.viewerSectionArrow}>&#9660;</span>
                              </button>
                              {isStatusSectionOpen ? (
                                <div className={styles.viewerSectionContent} onClick={(e) => e.stopPropagation()}>
                                  {quickStatusOptions.length > 0 ? (
                                    <>
                                      <span className={styles.lifecycleFieldLabel}>Next status</span>
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
                                    </>
                                  ) : (
                                    <p className={styles.viewerHint}>No next statuses available for this bill.</p>
                                  )}
                                  <div className={styles.viewerStatusActions}>
                                    <button
                                      type="button"
                                      className={creatorStyles.primaryButton}
                                      onClick={() => void handleUpdateVendorBillStatus()}
                                      disabled={!selectedVendorBillId || !viewerNextStatus || !canMutateVendorBills}
                                    >
                                      Update Status
                                    </button>
                                  </div>
                                  {viewerErrorMessage ? (
                                    <p className={styles.viewerErrorText} role="alert" aria-live="polite">
                                      {viewerErrorMessage}
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>

                            {/* Allocations */}
                            <div className={styles.viewerSection}>
                              <button
                                type="button"
                                className={styles.viewerSectionToggle}
                                onClick={(e) => { e.stopPropagation(); setIsAllocationsSectionOpen((v) => !v); }}
                                aria-expanded={isAllocationsSectionOpen}
                              >
                                <h4>Allocations ({vendorBill.allocations?.length ?? 0})</h4>
                                <span className={styles.viewerSectionArrow}>&#9660;</span>
                              </button>
                              {isAllocationsSectionOpen ? (
                                <div className={styles.viewerSectionContent} onClick={(e) => e.stopPropagation()}>
                                  {vendorBill.allocations && vendorBill.allocations.length > 0 ? (
                                    <div className={styles.readOnlyTableWrap}>
                                      <table className={styles.readOnlyTable}>
                                        <thead>
                                          <tr>
                                            <th>Cost Code</th>
                                            <th>Amount</th>
                                            <th>Note</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {vendorBill.allocations.map((alloc, allocIdx) => {
                                            const lineMeta = budgetLineMetaById.get(Number(alloc.budget_line));
                                            return (
                                              <tr key={allocIdx}>
                                                <td>{lineMeta?.label ?? `#${alloc.budget_line}`}</td>
                                                <td>${alloc.amount}</td>
                                                <td>{alloc.note || "—"}</td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <p className={styles.viewerHint}>No allocations on this bill.</p>
                                  )}
                                </div>
                              ) : null}
                            </div>

                            {/* Bill Details */}
                            <div className={styles.viewerSection}>
                              <button
                                type="button"
                                className={styles.viewerSectionToggle}
                                onClick={(e) => { e.stopPropagation(); setIsDetailsSectionOpen((v) => !v); }}
                                aria-expanded={isDetailsSectionOpen}
                              >
                                <h4>Bill Details</h4>
                                <span className={styles.viewerSectionArrow}>&#9660;</span>
                              </button>
                              {isDetailsSectionOpen ? (
                                <div className={styles.viewerSectionContent} onClick={(e) => e.stopPropagation()}>
                                  <div className={styles.detailGrid}>
                                    <div>
                                      <p className={styles.detailLabel}>Vendor</p>
                                      <p className={styles.detailValue}>{vendorBill.vendor_name}</p>
                                    </div>
                                    <div>
                                      <p className={styles.detailLabel}>Bill #</p>
                                      <p className={styles.detailValue}>{vendorBill.bill_number}</p>
                                    </div>
                                    <div>
                                      <p className={styles.detailLabel}>Issue Date</p>
                                      <p className={styles.detailValue}>{formatDateDisplay(vendorBill.issue_date)}</p>
                                    </div>
                                    <div>
                                      <p className={styles.detailLabel}>Due Date</p>
                                      <p className={styles.detailValue}>{formatDateDisplay(vendorBill.due_date)}</p>
                                    </div>
                                    <div>
                                      <p className={styles.detailLabel}>Total</p>
                                      <p className={styles.detailValue}>${vendorBill.total}</p>
                                    </div>
                                    <div>
                                      <p className={styles.detailLabel}>Balance Due</p>
                                      <p className={styles.detailValue}>${vendorBill.balance_due}</p>
                                    </div>
                                    {vendorBill.scheduled_for ? (
                                      <div>
                                        <p className={styles.detailLabel}>Scheduled For</p>
                                        <p className={styles.detailValue}>{formatDateDisplay(vendorBill.scheduled_for)}</p>
                                      </div>
                                    ) : (vendorBill.status === "approved" || vendorBill.status === "scheduled") ? (
                                      <div>
                                        <p className={styles.detailLabel}>Scheduled For</p>
                                        <p className={`${styles.detailValue} ${styles.detailMissing}`}>Not set</p>
                                      </div>
                                    ) : null}
                                    {vendorBill.notes ? (
                                      <div style={{ gridColumn: "1 / -1" }}>
                                        <p className={styles.detailLabel}>Notes</p>
                                        <p className={styles.detailValue}>{vendorBill.notes}</p>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })
              ) : (
                <tr>
                  <td colSpan={7} className={styles.projectEmptyCell}>
                    No bills match the selected status/due filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Workspace Panel: bill form (create/edit) ─────────────── */}
      {isWorkspaceExpanded ? (
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
                    onClick={handleRecreateAsNewDraftTemplate}
                    disabled={!selectedVendorBillId}
                  >
                    Recreate as New
                  </button>
                  <button
                    type="button"
                    className={styles.toolbarActionButton}
                    onClick={handleStartNewVendorBill}
                  >
                    New Bill
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <form ref={billFormRef} className={styles.billForm} onSubmit={handleSubmitVendorBillForm}>
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
                  Received date
                  <input
                    type="date"
                    value={formReceivedDate}
                    onChange={(event) => setFormReceivedDate(event.target.value)}
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
                  <label className={scheduledForMissing ? styles.fieldHighlight : undefined}>
                    Scheduled for
                    <input
                      type="date"
                      value={formScheduledFor}
                      onChange={(event) => setFormScheduledFor(event.target.value)}
                      disabled={!selectedProjectId || !canEditScheduledFor}
                      className={scheduledForMissing ? styles.inputHighlight : undefined}
                    />
                    {scheduledForMissing ? (
                      <span className={styles.fieldHintWarn}>Set a payment date before scheduling.</span>
                    ) : null}
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
                  {!hasBudgetLineOptions ? (
                    <p className={creatorStyles.inlineHint}>
                      No estimate-backed lines available for this project yet. Approve an estimate first.
                    </p>
                  ) : null}
                  <div className={creatorStyles.lineTable}>
                    <div className={`${creatorStyles.lineHeader} ${styles.allocationLineHeader}`}>
                      <div className={creatorStyles.lineHeaderCell}>Estimate Line</div>
                      <div className={creatorStyles.lineHeaderCell}>Origin Estimate</div>
                      <div className={creatorStyles.lineHeaderCell}>Amount</div>
                      <div className={creatorStyles.lineHeaderCell}>Note</div>
                      <div className={creatorStyles.lineHeaderCell} />
                    </div>
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
                        <div key={`form-allocation-${index}`}>
                          <div className={`${creatorStyles.lineRow} ${styles.allocationLineRow}`}>
                            <div className={creatorStyles.lineCell}>
                              <span className={creatorStyles.printOnly}>
                                {selectedLineMeta?.cost_code_code || "—"}
                              </span>
                              <select
                                className={`${creatorStyles.lineSelect} ${creatorStyles.screenOnly}`}
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
                            </div>
                            <div className={creatorStyles.lineCell}>
                              <select
                                className={creatorStyles.lineSelect}
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
                                      : "—"}
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
                            </div>
                            <div className={creatorStyles.lineCell}>
                              <input
                                className={creatorStyles.lineInput}
                                value={row.amount}
                                onChange={(event) => {
                                  updateFormAllocation(index, { amount: event.target.value });
                                }}
                                placeholder="0.00"
                                inputMode="decimal"
                                disabled={!hasBudgetLineOptions}
                              />
                            </div>
                            <div className={creatorStyles.lineCell}>
                              <input
                                className={creatorStyles.lineInput}
                                value={row.note}
                                onChange={(event) => {
                                  updateFormAllocation(index, { note: event.target.value });
                                }}
                                placeholder="Optional"
                                disabled={!hasBudgetLineOptions}
                              />
                            </div>
                            <div className={`${creatorStyles.lineCell} ${creatorStyles.lineActionsCell}`}>
                              <button
                                type="button"
                                className={creatorStyles.removeButton}
                                onClick={() => removeFormAllocation(index)}
                                disabled={formAllocations.length <= 1}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          {selectedLineMeta ? (
                            <p className={styles.allocationMetaRow}>
                              Approved: {formatMoney(selectedLineMeta.planned_amount)} · Spent:{" "}
                              {formatMoney(selectedLineMeta.actual_spend)} · Remaining:{" "}
                              {formatMoney(selectedLineMeta.remaining_amount)}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className={creatorStyles.lineActions}>
                    <button
                      type="button"
                      className={creatorStyles.secondaryButton}
                      onClick={addFormAllocation}
                      disabled={!hasBudgetLineOptions}
                    >
                      Add Allocation Row
                    </button>
                    <div className={styles.allocationTotals}>
                      <span>
                        Bill total: ${formTotal} · Allocated: ${formAllocationTotal.toFixed(2)} · Unallocated:{" "}
                        <span className={hasAllocationMismatch ? styles.unallocatedMismatch : undefined}>
                          ${formUnallocated.toFixed(2)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className={creatorStyles.secondaryButton}
                        onClick={() => setFormTotal(formSuggestedTotal)}
                        disabled={!isEditingMode && !hasBudgetLineOptions}
                      >
                        Use allocated total ({formSuggestedTotal})
                      </button>
                    </div>
                  </div>
                  {formIsOverAllocated ? (
                    <p className={styles.errorText}>Allocated amount cannot exceed bill total.</p>
                  ) : null}
                  {formRequiresFullAllocation ? (
                    <p className={styles.errorText}>
                      Status <strong>{status}</strong> requires full allocation (unallocated must be 0.00).
                    </p>
                  ) : null}
                  {scheduledForMissing ? (
                    <p className={styles.errorText}>
                      Set a <strong>scheduled for</strong> date before saving.
                    </p>
                  ) : null}
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
                  {isEditingMode && editErrorMessage ? (
                    <p className={styles.submitErrorText} role="alert" aria-live="polite">
                      {editErrorMessage}
                    </p>
                  ) : null}
                  {!isEditingMode && createErrorMessage ? (
                    <p className={styles.submitErrorText} role="alert" aria-live="polite">
                      {createErrorMessage}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    className={styles.formPrimaryButton}
                    disabled={
                      !canMutateVendorBills ||
                      !selectedProjectId ||
                      !formVendorId ||
                      formIsOverAllocated ||
                      (formRequiresFullAllocation && Math.abs(formUnallocated) > allocationEpsilon) ||
                      scheduledForMissing
                    }
                  >
                    {isEditingMode ? "Save Vendor Bill" : "Create Vendor Bill"}
                  </button>
                </div>
              </div>
            </section>
          </form>

          {duplicateCandidates.length > 0 ? (
            <div className={styles.impactCard}>
              <p><strong>Duplicate candidates:</strong></p>
              {duplicateCandidates.map((candidate) => (
                <p key={candidate.id}>
                  #{candidate.id} {candidate.vendor_name} / {candidate.bill_number} (
                  {statusDisplayLabel(candidate.status)})
                </p>
              ))}
              <p>Void matching bill(s) first if you need to reuse this bill number.</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {statusMessage ? <p className={styles.inlineHint}>{statusMessage}</p> : null}
      {!canMutateVendorBills ? <p className={styles.inlineHint}>Role `{role}` can view bills but cannot create or update.</p> : null}
    </section>
  );
}
