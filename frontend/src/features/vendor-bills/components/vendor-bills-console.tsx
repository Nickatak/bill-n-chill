"use client";

/**
 * Vendor bills (accounts payable) console. Lets users browse, create, edit,
 * and manage the lifecycle of vendor bills for a selected project. Includes
 * line items, duplicate detection, status transitions driven by a policy
 * contract, and a "recreate as new" workflow.
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
import { usePolicyContract } from "@/shared/hooks/use-policy-contract";
import { useStatusFilters } from "@/shared/hooks/use-status-filters";
import {
  VendorBillLineFormRow,
  createEmptyVendorBillLineRow,
  defaultBillStatusFilters,
  projectStatusLabel,
} from "../helpers";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { canDo } from "../../session/rbac";
import {
  ApiResponse,
  ProjectRecord,
  VendorBillLineInput,
  VendorBillPolicyContract,
  VendorBillPayload,
  VendorBillRecord,
  VendorBillStatus,
  VendorRecord,
} from "../types";
import { PaymentRecorder, type AllocationTarget } from "@/features/payments";
import styles from "./vendor-bills-console.module.css";
import creatorStyles from "../../../shared/document-creator/creator-foundation.module.css";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

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

type CostCodeOption = {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
};

type VendorBillsConsoleProps = {
  scopedProjectId?: number | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Renders the vendor bills dashboard: project picker, bill list, status panel, and bill form. */
export function VendorBillsConsole({ scopedProjectId: scopedProjectIdProp = null }: VendorBillsConsoleProps) {
  const searchParams = useSearchParams();
  const queryProjectParam = searchParams.get("project");
  const queryProjectId =
    queryProjectParam && /^\d+$/.test(queryProjectParam) ? Number(queryProjectParam) : null;
  const scopedProjectId = scopedProjectIdProp;
  const preferredProjectId = scopedProjectId ?? queryProjectId;

  const { token, role, capabilities } = useSharedSessionAuth();
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
  const [costCodes, setCostCodes] = useState<CostCodeOption[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedVendorBillId, setSelectedVendorBillId] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const {
    statuses: billStatuses,
    statusLabels: billStatusLabels,
    allowedTransitions: allowedStatusTransitions,
    defaultCreateStatus: policyDefaultCreateStatus,
  } = usePolicyContract<VendorBillPolicyContract>({
    fetchContract: fetchVendorBillPolicyContract,
    fallbackStatuses: VENDOR_BILL_STATUSES_FALLBACK,
    fallbackLabels: VENDOR_BILL_STATUS_LABELS_FALLBACK,
    fallbackTransitions: VENDOR_BILL_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
    baseUrl: normalizedBaseUrl,
    token,
    onLoaded(contract) {
      // Resolve create-shortcut statuses from contract.
      const shortcuts =
        Array.isArray(contract.create_shortcut_statuses) && contract.create_shortcut_statuses.length
          ? contract.create_shortcut_statuses
          : VENDOR_BILL_CREATE_SHORTCUT_STATUSES_FALLBACK.filter((s) =>
              contract.statuses.includes(s),
            );
      const fallbackCreate =
        contract.default_create_status || contract.statuses[0] || VENDOR_BILL_STATUSES_FALLBACK[0];
      setCreateStatusOptions(shortcuts.length ? shortcuts : [fallbackCreate]);
      setBillStatusFilters((current) => {
        const retained = current.filter((s) => contract.statuses.includes(s));
        return retained.length ? retained : defaultBillStatusFilters(contract.statuses);
      });
      setNewStatus((current) => {
        if (contract.statuses.includes(current)) return current;
        return shortcuts[0] || fallbackCreate;
      });
      setStatus((current) =>
        contract.statuses.includes(current) ? current : fallbackCreate,
      );
    },
  });

  const [createStatusOptions, setCreateStatusOptions] = useState<string[]>(
    VENDOR_BILL_CREATE_SHORTCUT_STATUSES_FALLBACK,
  );
  const {
    filters: billStatusFilters,
    setFilters: setBillStatusFilters,
    toggleFilter: toggleBillStatusFilter,
  } = useStatusFilters({
    allStatuses: billStatuses,
    defaultFilters: defaultBillStatusFilters(VENDOR_BILL_STATUSES_FALLBACK),
  });
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
  const [newLineItems, setNewLineItems] = useState<VendorBillLineFormRow[]>([
    createEmptyVendorBillLineRow(),
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
  const [lineItems, setLineItems] = useState<VendorBillLineFormRow[]>([createEmptyVendorBillLineRow()]);
  const [status, setStatus] = useState<string>("planned");
  const [viewerNextStatus, setViewerNextStatus] = useState<string>("");

  const [duplicateCandidates, setDuplicateCandidates] = useState<VendorBillRecord[]>([]);

  // Accordion section state for inline viewer expansion
  const [isStatusSectionOpen, setIsStatusSectionOpen] = useState(true);
  const [isLineItemsSectionOpen, setIsLineItemsSectionOpen] = useState(false);
  const [isDetailsSectionOpen, setIsDetailsSectionOpen] = useState(false);

  // Content tab (bills vs payments)
  const [activeContentTab, setActiveContentTab] = useState<"bills" | "payments">("bills");

  // Workspace visibility + flash animation
  const [isWorkspaceExpanded, setIsWorkspaceExpanded] = useState(true);
  const billFormRef = useRef<HTMLFormElement>(null);
  const [creatorFlashCount, setCreatorFlashCount] = useState(0);
  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

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
  const activeCostCodes = useMemo(
    () => costCodes.filter((cc) => cc.is_active),
    [costCodes],
  );

  const canMutateVendorBills = canDo(capabilities, "vendor_bills", "create");
  const canApproveVendorBills = canDo(capabilities, "vendor_bills", "approve");
  const canPayVendorBills = canDo(capabilities, "vendor_bills", "pay");
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
  const formLineItems = isEditingMode ? lineItems : newLineItems;
  const formStatus: VendorBillStatus = isEditingMode ? status : newStatus;
  const canEditScheduledFor = formStatus === "approved" || formStatus === "scheduled";
  const scheduledForMissing = canEditScheduledFor && !formScheduledFor;
  const formSubtotalAmount = Number(formSubtotal || 0);
  const formTaxAmountValue = Number(formTaxAmount || 0);
  const formShippingAmountValue = Number(formShippingAmount || 0);
  const quickStatusOptions = (selectedVendorBill
    ? allowedStatusTransitions[selectedVendorBill.status] ?? []
    : []
  ).filter((status: string) => {
    if (status === "approved") return canApproveVendorBills;
    if (status === "paid") return canPayVendorBills;
    return true;
  });
  const computedTotalFromParts = (
    formSubtotalAmount +
    formTaxAmountValue +
    formShippingAmountValue
  ).toFixed(2);

  // -------------------------------------------------------------------------
  // Display helpers
  // -------------------------------------------------------------------------

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

  function setFormLineItems(next: VendorBillLineFormRow[]) {
    if (isEditingMode) {
      setLineItems(next);
    } else {
      setNewLineItems(next);
    }
  }

  /** Patches a single line item row by index. */
  function updateFormLineItem(index: number, patch: Partial<VendorBillLineFormRow>) {
    const next = [...formLineItems];
    next[index] = { ...next[index], ...patch };
    setFormLineItems(next);
  }

  /** Removes a line item row, keeping at least one row. */
  function removeFormLineItem(index: number) {
    const current = formLineItems;
    setFormLineItems(
      current.length > 1 ? current.filter((_, rowIndex) => rowIndex !== index) : current,
    );
  }

  /** Appends a new blank line item row to the form. */
  function addFormLineItem() {
    setFormLineItems([...formLineItems, createEmptyVendorBillLineRow()]);
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
    const mapped = (item.line_items ?? []).map((row) => ({
      costCode: row.cost_code,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      unitPrice: row.unit_price,
    }));
    setLineItems(mapped.length > 0 ? mapped : [createEmptyVendorBillLineRow()]);
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

  // -------------------------------------------------------------------------
  // Data loading & form hydration
  // -------------------------------------------------------------------------

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

  /** Fetches the organization's cost codes for the line item cost code dropdown. */
  async function loadCostCodes() {
    try {
      const response = await fetch(`${normalizedBaseUrl}/cost-codes/`, {
        headers: buildAuthHeaders(token),
      });
      const payload = await response.json();
      if (!response.ok) {
        setCostCodes([]);
        return;
      }
      setCostCodes((payload.data as CostCodeOption[]) ?? []);
    } catch {
      setCostCodes([]);
    }
  }

  // -------------------------------------------------------------------------
  // Submit & mutation handlers
  // -------------------------------------------------------------------------

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
          line_items: (payloadBody.line_items ?? []).map((row) => ({
            cost_code: row.costCode || null,
            description: row.description,
            quantity: row.quantity,
            unit: row.unit,
            unit_price: row.unitPrice,
          })),
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
    setNewLineItems([createEmptyVendorBillLineRow()]);
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
    setStatusMessage("Creating vendor bill...");
    const normalizedLineItems: VendorBillLineInput[] = newLineItems
      .filter((row) => row.description || row.quantity || row.unitPrice)
      .map((row) => ({
        costCode: row.costCode || null,
        description: row.description,
        quantity: row.quantity,
        unit: row.unit,
        unitPrice: row.unitPrice,
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
      line_items: normalizedLineItems,
    });
  }

  /** Selects a vendor bill from the list and hydrates the edit form. */
  function handleSelectVendorBill(id: string) {
    setSelectedVendorBillId(id);
    setViewerErrorMessage("");
    setStatusMessage("");
    // Reset accordion sections to defaults on selection change
    setIsStatusSectionOpen(true);
    setIsLineItemsSectionOpen(false);
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
    setNewLineItems([createEmptyVendorBillLineRow()]);
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
          line_items: lineItems
            .filter((row) => row.description || row.quantity || row.unitPrice)
            .map((row) => ({
              cost_code: row.costCode || null,
              description: row.description,
              quantity: row.quantity,
              unit: row.unit,
              unit_price: row.unitPrice,
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
      setViewerNextStatus("");
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
    const copiedLineItems = (selected.line_items ?? []).map((row) => ({
      costCode: row.cost_code,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      unitPrice: row.unit_price,
    }));
    setNewLineItems(
      copiedLineItems.length > 0 ? copiedLineItems : [createEmptyVendorBillLineRow()],
    );
    setSelectedVendorBillId("");
    setDuplicateCandidates([]);
    setCreateErrorMessage("Enter a new bill number, then create the recreated planned bill.");
    setStatusMessage(`Copied bill #${selected.id} into create form.`);
    setCreatorFlashCount((c) => c + 1);
    setIsWorkspaceExpanded(true);
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  // Bootstrap: load project/vendor lists once authenticated.
  useEffect(() => {
    if (!token) {
      return;
    }
    const timer = window.setTimeout(() => {
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
    void loadCostCodes();
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
    setViewerNextStatus("");
  }, [allowedStatusTransitions, selectedVendorBill]);



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

  const billAllocationTargets: AllocationTarget[] = useMemo(
    () =>
      vendorBills.map((bill) => ({
        id: bill.id,
        label: bill.bill_number
          ? `${bill.bill_number} — ${bill.vendor_name}`
          : `Bill #${bill.id} — ${bill.vendor_name}`,
        balanceDue: bill.balance_due,
      })),
    [vendorBills],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

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

      {selectedProjectId ? (
        <div className={styles.contentTabBar}>
          <button
            type="button"
            className={`${styles.contentTab} ${activeContentTab === "bills" ? styles.contentTabActive : ""}`}
            onClick={() => setActiveContentTab("bills")}
          >
            Bills
          </button>
          <button
            type="button"
            className={`${styles.contentTab} ${activeContentTab === "payments" ? styles.contentTabActive : ""}`}
            onClick={() => setActiveContentTab("payments")}
          >
            Payments
          </button>
        </div>
      ) : null}

      {activeContentTab === "payments" && selectedProjectId ? (
        <PaymentRecorder
          projectId={Number(selectedProjectId)}
          direction="outbound"
          allocationTargets={billAllocationTargets}
          onPaymentsChanged={loadVendorBills}
        />
      ) : null}

      {activeContentTab === "bills" ? (
      <>
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

                            {/* Line Items */}
                            <div className={styles.viewerSection}>
                              <button
                                type="button"
                                className={styles.viewerSectionToggle}
                                onClick={(e) => { e.stopPropagation(); setIsLineItemsSectionOpen((v) => !v); }}
                                aria-expanded={isLineItemsSectionOpen}
                              >
                                <h4>Line Items ({vendorBill.line_items?.length ?? 0})</h4>
                                <span className={styles.viewerSectionArrow}>&#9660;</span>
                              </button>
                              {isLineItemsSectionOpen ? (
                                <div className={styles.viewerSectionContent} onClick={(e) => e.stopPropagation()}>
                                  {vendorBill.line_items && vendorBill.line_items.length > 0 ? (
                                    <div className={styles.readOnlyTableWrap}>
                                      <table className={styles.readOnlyTable}>
                                        <thead>
                                          <tr>
                                            <th>Cost Code</th>
                                            <th>Description</th>
                                            <th>Qty</th>
                                            <th>Unit</th>
                                            <th>Unit Price</th>
                                            <th>Total</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {vendorBill.line_items.map((lineItem, lineIdx) => (
                                              <tr key={lineIdx}>
                                                <td>{lineItem.cost_code_code || "—"}</td>
                                                <td>{lineItem.description || "—"}</td>
                                                <td>{lineItem.quantity}</td>
                                                <td>{lineItem.unit || "—"}</td>
                                                <td>${lineItem.unit_price}</td>
                                                <td>${lineItem.line_total}</td>
                                              </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <p className={styles.viewerHint}>No line items on this bill.</p>
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
                    <h4 className={styles.formSectionTitle}>Line Items</h4>
                    <p className={styles.formSectionHint}>Itemize this bill with cost codes, quantities, and unit prices.</p>
                  </div>
                  <div className={creatorStyles.lineTable}>
                    <div className={`${creatorStyles.lineHeader} ${styles.allocationLineHeader}`}>
                      <div className={creatorStyles.lineHeaderCell}>Cost Code</div>
                      <div className={creatorStyles.lineHeaderCell}>Description</div>
                      <div className={creatorStyles.lineHeaderCell}>Qty</div>
                      <div className={creatorStyles.lineHeaderCell}>Unit</div>
                      <div className={creatorStyles.lineHeaderCell}>Unit Price</div>
                      <div className={creatorStyles.lineHeaderCell} />
                    </div>
                    {formLineItems.map((row, index) => (
                      <div key={`form-line-${index}`}>
                        <div className={`${creatorStyles.lineRow} ${styles.allocationLineRow}`}>
                          <div className={creatorStyles.lineCell}>
                            <select
                              className={creatorStyles.lineSelect}
                              value={row.costCode != null ? String(row.costCode) : ""}
                              onChange={(event) => {
                                const val = event.target.value;
                                updateFormLineItem(index, { costCode: val ? Number(val) : null });
                              }}
                            >
                              <option value="">None</option>
                              {activeCostCodes.map((cc) => (
                                <option key={cc.id} value={cc.id}>
                                  {cc.code} - {cc.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className={creatorStyles.lineCell}>
                            <input
                              className={creatorStyles.lineInput}
                              value={row.description}
                              onChange={(event) => updateFormLineItem(index, { description: event.target.value })}
                              placeholder="Description"
                            />
                          </div>
                          <div className={creatorStyles.lineCell}>
                            <input
                              className={creatorStyles.lineInput}
                              value={row.quantity}
                              onChange={(event) => updateFormLineItem(index, { quantity: event.target.value })}
                              placeholder="1"
                              inputMode="decimal"
                            />
                          </div>
                          <div className={creatorStyles.lineCell}>
                            <input
                              className={creatorStyles.lineInput}
                              value={row.unit}
                              onChange={(event) => updateFormLineItem(index, { unit: event.target.value })}
                              placeholder="ea"
                            />
                          </div>
                          <div className={creatorStyles.lineCell}>
                            <input
                              className={creatorStyles.lineInput}
                              value={row.unitPrice}
                              onChange={(event) => updateFormLineItem(index, { unitPrice: event.target.value })}
                              placeholder="0.00"
                              inputMode="decimal"
                            />
                          </div>
                          <div className={`${creatorStyles.lineCell} ${creatorStyles.lineActionsCell}`}>
                            <button
                              type="button"
                              className={creatorStyles.removeButton}
                              onClick={() => removeFormLineItem(index)}
                              disabled={formLineItems.length <= 1}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={creatorStyles.lineActions}>
                    <button
                      type="button"
                      className={creatorStyles.secondaryButton}
                      onClick={addFormLineItem}
                    >
                      Add Line Item
                    </button>
                  </div>
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
      </>
      ) : null}

      {statusMessage ? <p className={styles.inlineHint}>{statusMessage}</p> : null}
      {!canMutateVendorBills ? <p className={styles.inlineHint}>Role `{role}` can view bills but cannot create or update.</p> : null}
    </section>
  );
}
