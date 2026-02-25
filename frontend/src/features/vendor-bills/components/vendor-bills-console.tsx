"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useEffect, useMemo, useState } from "react";

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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function dueDateIsoDate(daysFromNow = 30) {
  const current = new Date();
  current.setDate(current.getDate() + daysFromNow);
  return current.toISOString().slice(0, 10);
}

type VendorBillsConsoleProps = {
  scopedProjectId?: number | null;
};

function defaultBillStatusFilters(statuses: string[]): string[] {
  const withoutVoid = statuses.filter((value) => value !== "void");
  return withoutVoid.length ? withoutVoid : statuses;
}

export function VendorBillsConsole({ scopedProjectId: scopedProjectIdProp = null }: VendorBillsConsoleProps) {
  const { token, role } = useSharedSessionAuth();
  const pageSize = 5;
  const dueSoonWindowDays = 7;
  const [statusMessage, setStatusMessage] = useState("");
  const [createErrorMessage, setCreateErrorMessage] = useState("");

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [vendorBills, setVendorBills] = useState<VendorBillRecord[]>([]);
  const [budgetLineGroups, setBudgetLineGroups] = useState<
    Array<{
      budgetId: number;
      budgetLabel: string;
      lines: Array<{
        id: number;
        label: string;
        planned_amount: string;
        actual_spend: string;
        remaining_amount: string;
      }>;
    }>
  >([]);

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
  const [currentBillPage, setCurrentBillPage] = useState(1);

  const [newVendorId, setNewVendorId] = useState("");
  const [newBillNumber, setNewBillNumber] = useState("");
  const [newIssueDate, setNewIssueDate] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newScheduledFor, setNewScheduledFor] = useState("");
  const [newStatus, setNewStatus] = useState<string>("planned");
  const [newTotal, setNewTotal] = useState("0.00");
  const [newNotes, setNewNotes] = useState("");
  const [newAllocations, setNewAllocations] = useState<VendorBillAllocationInput[]>([
    { budget_line: 0, amount: "", note: "" },
  ]);

  const [vendorId, setVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [total, setTotal] = useState("0.00");
  const [notes, setNotes] = useState("");
  const [allocations, setAllocations] = useState<VendorBillAllocationInput[]>([
    { budget_line: 0, amount: "", note: "" },
  ]);
  const [status, setStatus] = useState<string>("planned");
  const [viewerNextStatus, setViewerNextStatus] = useState<string>("");

  const [duplicateCandidates, setDuplicateCandidates] = useState<VendorBillRecord[]>([]);
  const activeVendors = vendors.filter((vendor) => vendor.is_active);
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
  const totalBillPages = Math.max(1, Math.ceil(filteredVendorBills.length / pageSize));
  const currentBillPageSafe = Math.min(currentBillPage, totalBillPages);
  const billPageStartIndex = (currentBillPageSafe - 1) * pageSize;
  const pagedVendorBills = filteredVendorBills.slice(
    billPageStartIndex,
    billPageStartIndex + pageSize,
  );
  const createAllocationTotal = newAllocations.reduce((sum, row) => {
    const amount = Number(row.amount || 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  const createBillTotal = Number(newTotal || 0);
  const createUnallocated = createBillTotal - createAllocationTotal;
  const editAllocationTotal = allocations.reduce((sum, row) => {
    const amount = Number(row.amount || 0);
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

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const canMutateVendorBills = hasAnyRole(role, ["owner", "pm", "bookkeeping"]);
  const scopedProjectId = scopedProjectIdProp;
  const isProjectScoped = scopedProjectId !== null;
  const selectedProject =
    projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const selectedVendorBill =
    vendorBills.find((vendorBill) => String(vendorBill.id) === selectedVendorBillId) ?? null;
  const isEditingMode = Boolean(selectedVendorBillId);
  const formVendorId = isEditingMode ? vendorId : newVendorId;
  const formBillNumber = isEditingMode ? billNumber : newBillNumber;
  const formIssueDate = isEditingMode ? issueDate : newIssueDate;
  const formDueDate = isEditingMode ? dueDate : newDueDate;
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
  const quickStatusOptions = selectedVendorBill
    ? allowedStatusTransitions[selectedVendorBill.status] ?? []
    : [];

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

  function setFormAllocations(next: VendorBillAllocationInput[]) {
    if (isEditingMode) {
      setAllocations(next);
    } else {
      setNewAllocations(next);
    }
  }

  function updateFormAllocation(index: number, patch: Partial<VendorBillAllocationInput>) {
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
    setFormAllocations([...formAllocations, { budget_line: 0, amount: "", note: "" }]);
  }

  function formatMoney(value?: string): string {
    const parsed = Number(value ?? "0");
    return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
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
    setIssueDate(item.issue_date);
    setDueDate(item.due_date);
    setScheduledFor(item.scheduled_for ?? "");
    setTotal(item.total);
    setNotes(item.notes);
    setStatus(item.status);
    const mapped =
      item.allocations?.map((row) => ({
        budget_line: row.budget_line,
        amount: row.amount,
        note: row.note || "",
      })) ?? [];
    setAllocations(mapped.length > 0 ? mapped : [{ budget_line: 0, amount: "", note: "" }]);
  }

  function statusImpactLabel(value: VendorBillRecord["status"]): string {
    if (value === "paid") {
      return "actual";
    }
    if (value === "void") {
      return "excluded";
    }
    return "committed";
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
        const scopedProject = scopedProjectId
          ? projectRows.find((row) => row.id === scopedProjectId)
          : null;
        if (scopedProject) {
          setSelectedProjectId(String(scopedProject.id));
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

    setStatusMessage("Loading vendor bills...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/vendor-bills/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load vendor bills.");
        return;
      }

      const rows = (payload.data as VendorBillRecord[]) ?? [];
      const sortedRows = [...rows].sort((a, b) => {
        const updatedA = new Date(a.updated_at || a.created_at).getTime();
        const updatedB = new Date(b.updated_at || b.created_at).getTime();
        return updatedB - updatedA;
      });
      setVendorBills(sortedRows);
      setCurrentBillPage(1);
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
          const estimateLabel =
            budget.source_estimate_version != null
              ? `Estimate v${budget.source_estimate_version}`
              : budget.source_estimate
                ? `Estimate #${budget.source_estimate}`
                : "No estimate ref";
          return {
            budgetId: budget.id,
            budgetLabel: `Budget #${budget.id} (${estimateLabel})`,
            lines: (budget.line_items ?? []).map((line) => ({
              id: line.id,
              label: `${line.cost_code_code ?? "CC"} - ${line.description ?? "Line"} (#${line.id})`,
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
    setCurrentBillPage(1);
    setBillStatusFilters((current) =>
      current.includes(created.status) ? current : [...current, created.status],
    );
    setSelectedVendorBillId(String(created.id));
    hydrate(created);
    setCreateErrorMessage("");
    setNewBillNumber("");
    setNewTotal("0.00");
    setNewNotes("");
    setNewAllocations([{ budget_line: 0, amount: "", note: "" }]);
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
    setNewIssueDate(today);
    setNewDueDate(due);
    setNewScheduledFor("");
    setNewStatus(createStatusOptions[0] ?? billStatuses[0] ?? "planned");
    setNewTotal("0.00");
    setNewNotes("");
    setNewAllocations([{ budget_line: 0, amount: "", note: "" }]);
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
    setNewIssueDate(selected.issue_date);
    setNewDueDate(selected.due_date);
    setNewScheduledFor(selected.scheduled_for ?? "");
    setNewTotal(selected.total);
    setNewNotes(selected.notes || "");
    const copiedAllocations =
      selected.allocations?.map((row) => ({
        budget_line: row.budget_line,
        amount: row.amount,
        note: row.note || "",
      })) ?? [];
    setNewAllocations(
      copiedAllocations.length > 0 ? copiedAllocations : [{ budget_line: 0, amount: "", note: "" }],
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
    setNewIssueDate((current) => current || today);
    setNewDueDate((current) => current || due);
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
    setCurrentBillPage(1);
  }, [billStatusFilters, dueFilter, selectedProjectId]);

  useEffect(() => {
    if (!selectedVendorBill) {
      setViewerNextStatus("");
      return;
    }
    const nextStatuses = allowedStatusTransitions[selectedVendorBill.status] ?? [];
    setViewerNextStatus((current) => (nextStatuses.includes(current) ? current : (nextStatuses[0] ?? "")));
  }, [allowedStatusTransitions, selectedVendorBill]);

  return (
    <section className={styles.console}>
      {projects.length > 0 && isProjectScoped ? (
        <p>
          Project context:{" "}
          {selectedProject
            ? `#${selectedProject.id} - ${selectedProject.name} (${selectedProject.customer_display_name})`
            : `#${scopedProjectId}`}
        </p>
      ) : null}

      {projects.length > 0 && !isProjectScoped ? (
        <label>
          Project
          <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                #{project.id} - {project.name} ({project.customer_display_name})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {projects.length === 0 ? <p>Create or load a project before entering vendor bills.</p> : null}

      {vendorBills.length > 0 ? (
        <>
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
                    className={`${styles.statusFilterButton} ${active ? styles[statusClass] ?? "" : styles.statusFilterButtonInactive} ${active ? styles.statusFilterButtonActive : ""}`}
                    aria-pressed={active}
                    onClick={() => toggleBillStatusFilter(statusValue)}
                  >
                    {statusDisplayLabel(statusValue)}
                  </button>
                );
              })}
            </div>
            <label>
              Due filter
              <select
                value={dueFilter}
                onChange={(event) => setDueFilter(event.target.value as "all" | "due_soon" | "overdue")}
              >
                <option value="all">all</option>
                <option value="due_soon">due soon ({dueSoonWindowDays}d)</option>
                <option value="overdue">overdue</option>
              </select>
            </label>
          </div>
          {filteredVendorBills.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Bill</th>
                    <th>Vendor</th>
                    <th>Status</th>
                    <th>Budget impact</th>
                    <th>Total</th>
                    <th>Balance due</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedVendorBills.map((vendorBill) => {
                    const isSelected = selectedVendorBillId === String(vendorBill.id);
                    return (
                      <tr
                        key={vendorBill.id}
                        className={isSelected ? styles.rowSelected : undefined}
                        onClick={() => handleSelectVendorBill(String(vendorBill.id))}
                      >
                        <td>
                          #{vendorBill.id} {vendorBill.bill_number}
                        </td>
                        <td>{vendorBill.vendor_name}</td>
                        <td>
                          <span className={`${styles.tableStatusBadge} ${statusBadgeClass(vendorBill.status)}`}>
                            {statusDisplayLabel(vendorBill.status)}
                          </span>
                        </td>
                        <td>{statusImpactLabel(vendorBill.status)}</td>
                        <td>{vendorBill.total}</td>
                        <td>{vendorBill.balance_due}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className={styles.pagination}>
                <button
                  type="button"
                  onClick={() => setCurrentBillPage((page) => Math.max(1, page - 1))}
                  disabled={currentBillPageSafe <= 1}
                >
                  Prev
                </button>
                <span>
                  Page {currentBillPageSafe} of {totalBillPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentBillPage((page) => Math.min(totalBillPages, page + 1))}
                  disabled={currentBillPageSafe >= totalBillPages}
                >
                  Next
                </button>
              </div>
            </div>
          ) : (
            <p>No vendor bills match the selected status/due filters.</p>
          )}

          <section className={styles.viewerStatusPanel}>
            <div className={styles.viewerStatusHeader}>
              <h3>Bill Status & Recreate</h3>
              <span className={styles.viewerStatusBadge}>
                {selectedVendorBill ? `#${selectedVendorBill.id}` : "No selection"}
              </span>
            </div>

            {selectedVendorBill ? (
              <>
                <p className={styles.hintText}>
                  {selectedVendorBill.vendor_name} / {selectedVendorBill.bill_number} ({statusDisplayLabel(selectedVendorBill.status)})
                </p>
                <div className={styles.statusPicker}>
                  <span className={styles.statusPickerLabel}>Next status</span>
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
                  <p className={styles.hintText}>No next statuses available for this bill.</p>
                ) : null}
                <div className={styles.viewerStatusActions}>
                  <button
                    type="button"
                    onClick={() => void handleUpdateVendorBillStatus()}
                    disabled={!selectedVendorBillId || !viewerNextStatus || !canMutateVendorBills}
                  >
                    Save Status
                  </button>
                  <button
                    type="button"
                    onClick={handleRecreateAsNewDraftTemplate}
                    disabled={!selectedVendorBillId}
                  >
                    Recreate as New Planned
                  </button>
                </div>
              </>
            ) : (
              <p className={styles.hintText}>Select a vendor bill to manage status or recreate it as new.</p>
            )}
          </section>
        </>
      ) : null}

      <div>
        <button type="button" onClick={handleStartNewVendorBill}>
          New Bill
        </button>
      </div>

      <form onSubmit={handleSubmitVendorBillForm}>
        <h3>Bill Details</h3>
        <label>
          Vendor
          {isEditingMode ? (
            <input
              className={styles.readOnlyField}
              value={
                formVendorId
                  ? (() => {
                      const vendorRow = vendors.find((row) => String(row.id) === formVendorId);
                      if (!vendorRow) {
                        return `#${formVendorId}`;
                      }
                      return `#${vendorRow.id} - ${vendorRow.name} [${vendorRow.vendor_type}]${
                        vendorRow.is_canonical ? " [canonical]" : ""
                      }`;
                    })()
                  : ""
              }
              disabled
              readOnly
            />
          ) : (
            <select
              value={formVendorId}
              onChange={(event) => setFormVendorId(event.target.value)}
              required
              disabled={!selectedProjectId || activeVendors.length === 0}
            >
              <option value="">Select vendor</option>
              {activeVendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  #{vendor.id} - {vendor.name} [{vendor.vendor_type}]
                  {vendor.is_canonical ? " [canonical]" : ""}
                </option>
              ))}
            </select>
          )}
        </label>
        {!isEditingMode && activeVendors.length === 0 ? (
          <p>No active vendors available. Add or reactivate a vendor first.</p>
        ) : null}
        <label>
          Bill number
          {isEditingMode ? (
            <input className={styles.readOnlyField} value={formBillNumber} disabled readOnly required />
          ) : (
            <input
              value={formBillNumber}
              onChange={(event) => setFormBillNumber(event.target.value)}
              required
              disabled={!selectedProjectId || !formVendorId}
            />
          )}
        </label>
        <label>
          Issue date
          <input
            type="date"
            value={formIssueDate}
            onChange={(event) => setFormIssueDate(event.target.value)}
            required
            disabled={!selectedProjectId || !formVendorId}
          />
        </label>
        <label>
          Due date
          <input
            type="date"
            value={formDueDate}
            onChange={(event) => setFormDueDate(event.target.value)}
            required
            disabled={!selectedProjectId || !formVendorId}
          />
        </label>
        {!isEditingMode || canEditScheduledFor ? (
          <label>
            Scheduled for
            <input
              type="date"
              value={formScheduledFor}
              onChange={(event) => setFormScheduledFor(event.target.value)}
              disabled={!selectedProjectId || !formVendorId || !canEditScheduledFor}
            />
          </label>
        ) : null}
        <label>
          Total
          <input
            value={formTotal}
            onChange={(event) => setFormTotal(event.target.value)}
            inputMode="decimal"
            required
            disabled={!selectedProjectId || !formVendorId}
          />
        </label>
        <fieldset className={styles.allocationFieldset}>
          <legend>{isEditingMode ? "Allocations" : "Allocations (optional in planned)"}</legend>
          <div className={styles.allocationHeader}>
            <span>Budget line</span>
            <span>Amount</span>
            <span>Note</span>
            <span />
          </div>
          {!hasBudgetLineOptions ? (
            <p className={styles.hintText}>
              No budget lines available for this project yet. Create a budget first.
            </p>
          ) : null}
          {formAllocations.map((row, index) => {
            const selectedLineMeta = budgetLineMetaById.get(Number(row.budget_line));
            return (
              <div key={`form-allocation-${index}`} className={styles.allocationRowWrap}>
                <div className={styles.allocationRow}>
                  <select
                    value={row.budget_line || ""}
                    onChange={(event) => {
                      updateFormAllocation(index, {
                        budget_line: Number(event.target.value || 0),
                      });
                    }}
                    disabled={!hasBudgetLineOptions}
                  >
                    <option value="">Select budget line</option>
                    {budgetLineGroups.map((group) => (
                      <optgroup key={group.budgetId} label={group.budgetLabel}>
                        {group.lines.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
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
          <button
            type="button"
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
        <label>
          Notes
          <textarea
            value={formNotes}
            onChange={(event) => setFormNotes(event.target.value)}
            disabled={!selectedProjectId || !formVendorId}
          />
        </label>
        {!isEditingMode ? (
          <div className={styles.statusPicker}>
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
        {!isEditingMode && createErrorMessage ? <p className={styles.errorText}>{createErrorMessage}</p> : null}
        <button
          type="submit"
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
      {!canMutateVendorBills ? <p>Role `{role}` can view vendor bills but cannot create or update.</p> : null}
    </section>
  );
}
