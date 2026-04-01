"use client";

/**
 * Vendor bills (accounts payable) console. Orchestrates bill browsing,
 * creation, editing, and lifecycle management for a selected project.
 *
 * Parent: `/app/projects/[projectId]/bills/page.tsx`
 *
 * ## Page layout
 *
 * ┌─────────────────────────────────────────────┐
 * │  Viewer Panel                                │
 * │  ┌─ panelHeader (title + hide/show form) ─┐ │
 * │  │  statusFilters (pill bar)               │ │
 * │  │  bill table (desktop) / card list (mob) │ │
 * │  │    └─ expandedSections (inline viewer)  │ │
 * │  └────────────────────────────────────────┘  │
 * │  Workspace Panel                              │
 * │  ┌─ workspaceToolbar (context + actions) ─┐  │
 * │  │  billDocument form (WYSIWYG)           │  │
 * │  │    header → dates → lines → summary    │  │
 * │  │    notes → submit                      │  │
 * │  │  duplicateCandidates (impact card)     │  │
 * │  └───────────────────────────────────────┘   │
 * └─────────────────────────────────────────────┘
 *
 * ## Hook dependency graph
 *
 * useSharedSessionAuth → token, role, capabilities
 * usePolicyContract    → billStatuses, billStatusLabels, allowedStatusTransitions
 * useStatusFilters     → billStatusFilters, toggleBillStatusFilter
 * useVendorBillForm    → create/edit field state, line items, hydrate, reset
 * useVendorBillViewer  → viewer state, accordions, snapshots
 * useStatusMessage     → formMessage/formTone
 * useCombobox          → vendor picker
 * useCreatorFlash      → bill form flash animation
 *
 * ## Functions
 *
 * - loadDependencies()              — bootstrap: fetch projects + vendors
 * - loadVendorBills()               — fetch bills for selected project
 * - createVendorBill(payload)       — POST new bill (handles 409 dupes)
 * - handleCreateVendorBill(event)   — validate + delegate to createVendorBill
 * - handleSaveVendorBill(event)     — PATCH existing bill
 * - handleSubmitVendorBillForm(e)   — unified submit router
 * - handleSelectVendorBill(id)      — select bill, hydrate, load snapshots
 * - handleStartNewVendorBill()      — switch to create mode
 * - handleRecreateAsNewDraftTemplate() — copy bill into create form
 * - handleQuickVendorBillStatus(s)  — PATCH status transition
 * - handleUpdateVendorBillStatus()  — validate + delegate to quick status
 * - handleUpdateVendorBillNote()    — PATCH note-only (notate snapshot)
 * - statusDisplayLabel(status)      — policy-aware label lookup
 * - statusBadgeClass(status)        — CSS class for table badge
 * - statusPillClass(status)         — CSS class for status pill
 * - commitVendor(vendor)            — combobox commit delegate
 * - renderExpandedSections(bill)    — inline viewer sections JSX
 *
 * ## Effects
 *
 * - Bootstrap: load projects/vendors once authenticated
 * - Date defaults: ensure sensible dates on mount
 * - Reload bills: when selectedProjectId changes
 * - Filter fallback: if selected bill is hidden by filter change
 * - Viewer sync: reset next-status when selected bill changes
 *
 * ## Orchestration (in JSX)
 *
 * Viewer panel renders filtered bills as a table (desktop) or card list
 * (mobile), each with inline expandable sections. Workspace panel renders
 * the WYSIWYG bill form that adapts between create/edit based on selection.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useStatusMessage } from "@/shared/hooks/use-status-message";
import { useCreatorFlash } from "@/shared/hooks/use-creator-flash";
import { useSearchParams } from "next/navigation";
import { readApiErrorMessage } from "@/shared/api/error";

import { useMediaQuery } from "@/shared/hooks/use-media-query";
import {
  fetchVendorBillPolicyContract,
} from "../api";
import { apiBaseUrl } from "@/shared/api/base";
import { usePolicyContract } from "@/shared/hooks/use-policy-contract";
import { useStatusFilters } from "@/shared/hooks/use-status-filters";
import {
  createEmptyVendorBillLineRow,
  defaultBillStatusFilters,
} from "../helpers";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { canDo } from "@/shared/session/rbac";
import type {
  ApiResponse,
  ProjectRecord,
  ScanResult,
  VendorBillLineInput,
  VendorBillPolicyContract,
  VendorBillPayload,
  VendorBillRecord,
  VendorBillStatus,
  VendorRecord,
} from "../types";
import { useVendorBillForm } from "../hooks/use-vendor-bill-form";
import { useVendorBillViewer } from "../hooks/use-vendor-bill-viewer";
import styles from "./vendor-bills-console.module.css";
import { VendorBillsViewerPanel } from "./vendor-bills-viewer-panel";
import { VendorBillsWorkspacePanel } from "./vendor-bills-workspace-panel";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

const VENDOR_BILL_STATUSES_FALLBACK: string[] = [
  "open",
  "disputed",
  "closed",
  "void",
];
const VENDOR_BILL_ALLOWED_STATUS_TRANSITIONS_FALLBACK: Record<string, string[]> = {
  open: ["disputed", "closed", "void"],
  disputed: ["open", "void"],
  closed: [],
  void: [],
};
const VENDOR_BILL_STATUS_LABELS_FALLBACK: Record<string, string> = {
  open: "Open",
  disputed: "Disputed",
  closed: "Closed",
  void: "Void",
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

  const isMobile = useMediaQuery("(max-width: 850px)");
  const { token: authToken, role, capabilities } = useSharedSessionAuth();
  const { message: formMessage, tone: formTone, setSuccess: setFormSuccess, setError: setFormError, clear: clearFormMessage } = useStatusMessage();

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [vendorBills, setVendorBills] = useState<VendorBillRecord[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedVendorBillId, setSelectedVendorBillId] = useState("");

  const {
    statuses: billStatuses,
    statusLabels: billStatusLabels,
    allowedTransitions: allowedStatusTransitions,
  } = usePolicyContract<VendorBillPolicyContract>({
    fetchContract: fetchVendorBillPolicyContract,
    fallbackStatuses: VENDOR_BILL_STATUSES_FALLBACK,
    fallbackLabels: VENDOR_BILL_STATUS_LABELS_FALLBACK,
    fallbackTransitions: VENDOR_BILL_ALLOWED_STATUS_TRANSITIONS_FALLBACK,
    baseUrl: apiBaseUrl,
    authToken,
    onLoaded(contract) {
      setBillStatusFilters((current) => {
        const retained = current.filter((s) => contract.statuses.includes(s));
        return retained.length ? retained : defaultBillStatusFilters(contract.statuses);
      });
      billForm.setStatus((current) =>
        contract.statuses.includes(current) ? current : (contract.default_create_status || contract.statuses[0] || VENDOR_BILL_STATUSES_FALLBACK[0]),
      );
    },
  });

  const {
    filters: billStatusFilters,
    setFilters: setBillStatusFilters,
    toggleFilter: toggleBillStatusFilter,
  } = useStatusFilters({
    allStatuses: billStatuses,
    defaultFilters: defaultBillStatusFilters(VENDOR_BILL_STATUSES_FALLBACK),
  });

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const canMutateVendorBills = canDo(capabilities, "vendor_bills", "create");
  const isEditingMode = Boolean(selectedVendorBillId);

  // -------------------------------------------------------------------------
  // Composed hooks
  // -------------------------------------------------------------------------

  const billForm = useVendorBillForm({
    isEditingMode,
    activeVendors: vendors,
  });

  const viewer = useVendorBillViewer({
    authToken,
  });

  // -------------------------------------------------------------------------
  // Destructure hook returns for JSX compatibility
  // -------------------------------------------------------------------------

  const {
    formVendorId, formBillNumber, formReceivedDate, formIssueDate, formDueDate,
    formTaxAmount, formShippingAmount, formNotes, formLineItems,
    computedSubtotal, computedTotal, duplicateCandidates,
    setFormVendorId, setFormBillNumber, setFormReceivedDate,
    setFormIssueDate, setFormDueDate, setFormTaxAmount,
    setFormShippingAmount, setFormNotes,
    updateFormLineItem, removeFormLineItem, addFormLineItem,
  } = billForm;

  const {
    viewerNextStatus, viewerNote, viewerErrorMessage, snapshots,
    isStatusSectionOpen, isLineItemsSectionOpen, isDetailsSectionOpen, isHistorySectionOpen,
    setViewerNextStatus, setViewerNote, setViewerErrorMessage,
    setIsStatusSectionOpen, setIsLineItemsSectionOpen, setIsDetailsSectionOpen, setIsHistorySectionOpen,
  } = viewer;

  // -------------------------------------------------------------------------
  // More derived values (depend on hooks)
  // -------------------------------------------------------------------------

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
    return true;
  });

  const selectedProject =
    projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const isProjectCancelled = selectedProject?.status === "cancelled";
  const selectedVendorBill =
    vendorBills.find((vendorBill) => String(vendorBill.id) === selectedVendorBillId) ?? null;
  const workspaceIsLockedByStatus = selectedVendorBill ? selectedVendorBill.status !== "open" : false;
  const workspaceIsLocked = !canMutateVendorBills || isProjectCancelled || workspaceIsLockedByStatus;
  const workspaceBadgeLabel = !selectedVendorBill
    ? "CREATING"
    : workspaceIsLocked
      ? "READ-ONLY"
      : "EDITING";
  const workspaceBadgeClass = !selectedVendorBill
    ? styles.tableStatusOpen
    : workspaceIsLocked
      ? styles[`tableStatus${selectedVendorBill.status[0].toUpperCase()}${selectedVendorBill.status.slice(1)}`] ?? ""
      : styles.tableStatusOpen;
  const workspaceContext = selectedVendorBill
    ? `#${selectedVendorBill.id} — ${selectedVendorBill.bill_number || "Untitled"}`
    : "New vendor bill";
  const quickStatusOptions = selectedVendorBill
    ? allowedStatusTransitions[selectedVendorBill.status] ?? []
    : [];

  // Workspace visibility + flash animation
  const [isViewerExpanded, setIsViewerExpanded] = useState(true);
  const { ref: billFormRef, flash: flashCreator } = useCreatorFlash<HTMLFormElement>();


  // -------------------------------------------------------------------------
  // Data loading & form hydration
  // -------------------------------------------------------------------------

  /** Loads projects and vendors in parallel on initial mount. */
  async function loadDependencies() {
    try {
      const [projectsResponse, vendorsResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/projects/`, {
          headers: buildAuthHeaders(authToken),
        }),
        fetch(`${apiBaseUrl}/vendors/`, {
          headers: buildAuthHeaders(authToken),
        }),
      ]);

      const projectsPayload: ApiResponse = await projectsResponse.json();
      const vendorsPayload: ApiResponse = await vendorsResponse.json();
      if (!projectsResponse.ok || !vendorsResponse.ok) {
        setFormError("Could not load projects/vendors.");
        return;
      }

      const projectRows = (projectsPayload.data as ProjectRecord[]) ?? [];
      const vendorRows = (vendorsPayload.data as VendorRecord[]) ?? [];
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
          setFormError(
            `Project #${scopedProjectId} is not available in your scope. Select a valid project.`,
          );
          return;
        } else {
          setSelectedProjectId(String(projectRows[0].id));
        }
      }
      if (vendorRows[0]) {
        billForm.setNewVendorId(String(vendorRows[0].id));
      }
    } catch {
      setFormError("Could not reach projects/vendors endpoints.");
    }
  }

  /** Fetches vendor bills for the selected project and auto-selects the most recent non-void bill. */
  async function loadVendorBills() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setFormError("Select a project first.");
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/projects/${projectId}/vendor-bills/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setFormError(payload.error?.message ?? "Could not load bills.");
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
        billForm.hydrate(preferred);
        viewer.setViewerNote("");
        void viewer.loadSnapshots(preferred.id);
      } else {
        setSelectedVendorBillId("");
        viewer.setSnapshots([]);
      }
      clearFormMessage();
    } catch {
      setFormError("Could not reach vendor-bills endpoint.");
    }
  }

  // -------------------------------------------------------------------------
  // Submit & mutation handlers
  // -------------------------------------------------------------------------

  /** POSTs a new vendor bill to the API, handling duplicate detection. */
  async function createVendorBill(payloadBody: VendorBillPayload) {
    const response = await fetch(
      `${apiBaseUrl}/projects/${payloadBody.projectId}/vendor-bills/`,
      {
        method: "POST",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({
          vendor: payloadBody.vendor,
          bill_number: payloadBody.bill_number,
          issue_date: payloadBody.issue_date,
          due_date: payloadBody.due_date,
          total: payloadBody.total,
          notes: payloadBody.notes,
          line_items: (payloadBody.line_items ?? []).map((row) => ({
            description: row.description,
            quantity: row.quantity,
            unit_price: row.unit_price,
          })),
        }),
      },
    );
    const payload: ApiResponse = await response.json();

    if (response.status === 409 && payload.error?.code === "duplicate_detected") {
      const duplicateData = payload.data as { duplicate_candidates?: VendorBillRecord[] };
      billForm.setDuplicateCandidates(duplicateData.duplicate_candidates ?? []);
      setFormError("Duplicate blocked: void existing matching bill(s) before reusing this bill number.");
      return;
    }

    if (!response.ok) {
      setFormError(payload.error?.message ?? "Create vendor bill failed.");
      return;
    }

    const created = payload.data as VendorBillRecord;
    setVendorBills((current) => [created, ...current]);
    setBillStatusFilters((current) =>
      current.includes(created.status) ? current : [...current, created.status],
    );
    setSelectedVendorBillId(String(created.id));
    billForm.hydrate(created);
    viewer.setViewerNote("");
    void viewer.loadSnapshots(created.id);
    billForm.setNewBillNumber("");
    billForm.setNewNotes("");
    billForm.setNewLineItems([createEmptyVendorBillLineRow()]);
    billForm.setDuplicateCandidates([]);
    setFormSuccess(`Created vendor bill #${created.id}.`);
  }

  /** Validates form inputs and delegates to createVendorBill. */
  async function handleCreateVendorBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFormMessage();
    const projectId = Number(selectedProjectId);
    const vendor = Number(billForm.newVendorId);

    if (!projectId) {
      setFormError("Select a project first.");
      return;
    }
    if (!vendor) {
      setFormError("Select a vendor.");
      return;
    }
    if (!billForm.newIssueDate) {
      setFormError("Issue date is required.");
      return;
    }
    if (!billForm.newDueDate) {
      setFormError("Due date is required.");
      return;
    }
    const normalizedLineItems: VendorBillLineInput[] = billForm.newLineItems
      .filter((row) => row.description || row.unit_price)
      .map((row) => ({
        description: row.description,
        quantity: row.quantity,
        unit_price: row.unit_price,
      }));
    await createVendorBill({
      projectId,
      vendor: vendor || null,
      bill_number: billForm.newBillNumber,
      received_date: billForm.newReceivedDate || null,
      issue_date: billForm.newIssueDate,
      due_date: billForm.newDueDate,
      subtotal: computedSubtotal.toFixed(2),
      tax_total: billForm.newTaxAmount,
      shipping_total: billForm.newShippingAmount,
      total: computedTotal.toFixed(2),
      notes: billForm.newNotes,
      line_items: normalizedLineItems,
    });
  }

  function handleSubmitVendorBillForm(event: FormEvent<HTMLFormElement>) {
    if (!canMutateVendorBills) {
      event.preventDefault();
      setFormError(`Role ${role} is read-only for vendor bill mutations.`);
      return;
    }
    if (isEditingMode) {
      void handleSaveVendorBill(event);
      return;
    }
    void handleCreateVendorBill(event);
  }

  /** Selects a vendor bill from the list and hydrates the edit form. */
  function handleSelectVendorBill(id: string) {
    setSelectedVendorBillId(id);
    viewer.resetOnSelect();
    clearFormMessage();
    const selected = vendorBills.find((row) => String(row.id) === id);
    if (!selected) return;

    billForm.hydrate(selected);
    viewer.setViewerNote("");
    void viewer.loadSnapshots(selected.id);
    flashCreator();
  }

  /** Resets the form to create-mode with default values for a new bill. */
  function handleStartNewVendorBill() {
    setSelectedVendorBillId("");
    clearFormMessage();
    viewer.clearViewer();
    billForm.resetCreateForm();
    flashCreator();
  }

  /** PATCHes the currently selected vendor bill with the edit form values. */
  async function handleSaveVendorBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFormMessage();
    const vendorBillId = Number(selectedVendorBillId);
    const vendor = Number(billForm.vendorId);
    if (!vendorBillId) {
      setFormError("Select a vendor bill first.");
      return;
    }
    if (!vendor) {
      setFormError("Select a vendor.");
      return;
    }
    if (!billForm.issueDate) {
      setFormError("Issue date is required.");
      return;
    }
    if (!billForm.dueDate) {
      setFormError("Due date is required.");
      return;
    }
    try {
      const response = await fetch(`${apiBaseUrl}/vendor-bills/${vendorBillId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({
          vendor: vendor || null,
          bill_number: billForm.billNumber,
          received_date: billForm.receivedDate || null,
          issue_date: billForm.issueDate,
          due_date: billForm.dueDate,
          subtotal: computedSubtotal.toFixed(2),
          tax_total: billForm.taxAmount,
          shipping_total: billForm.shippingAmount,
          total: computedTotal.toFixed(2),
          notes: billForm.notes,
          line_items: billForm.lineItems
            .filter((row) => row.description || row.unit_price)
            .map((row) => ({
              description: row.description,
              quantity: row.quantity,
              unit_price: row.unit_price,
            })),
          status: billForm.status,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (response.status === 409 && payload.error?.code === "duplicate_detected") {
        const duplicateData = payload.data as { duplicate_candidates?: VendorBillRecord[] };
        billForm.setDuplicateCandidates(duplicateData.duplicate_candidates ?? []);
        setFormError("Duplicate blocked: void existing matching bill(s) before reusing this bill number.");
        return;
      }
      if (!response.ok) {
        setFormError(readApiErrorMessage(payload, "Save vendor bill failed."));
        return;
      }

      const updated = payload.data as VendorBillRecord;
      setVendorBills((current) =>
        current.map((vendorBill) => (vendorBill.id === updated.id ? updated : vendorBill)),
      );
      billForm.setDuplicateCandidates([]);
      setFormSuccess(`Saved vendor bill #${updated.id}.`);
    } catch {
      setFormError("Could not reach vendor bill detail endpoint.");
    }
  }

  /** Applies a single-field status transition to the selected vendor bill. */
  async function handleQuickVendorBillStatus(nextStatus: VendorBillStatus) {
    if (!canMutateVendorBills) {
      setViewerErrorMessage(`Role ${role} is read-only for vendor bill mutations.`);
      return;
    }
    const vendorBillId = Number(selectedVendorBillId);
    if (!vendorBillId) {
      setViewerErrorMessage("Select a vendor bill first.");
      return;
    }
    setViewerErrorMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/vendor-bills/${vendorBillId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({ status: nextStatus, status_note: viewerNote }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setViewerErrorMessage(readApiErrorMessage(payload, "Quick status update failed."));
        return;
      }
      const updated = payload.data as VendorBillRecord;
      setVendorBills((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      billForm.hydrate(updated);
      setViewerErrorMessage("");
      setViewerNextStatus("");
      viewer.setViewerNote("");
      setFormSuccess(`Updated status to ${updated.status}.`);
      void viewer.loadSnapshots(updated.id);
    } catch {
      setViewerErrorMessage("Could not reach vendor bill quick status endpoint.");
    }
  }

  /** Validates that a next status is selected, then delegates to the quick status handler. */
  async function handleUpdateVendorBillStatus() {
    if (!viewerNextStatus) {
      setViewerErrorMessage("Select a next status first.");
      return;
    }
    await handleQuickVendorBillStatus(viewerNextStatus);
  }

  /** PATCHes only the status_note on the selected vendor bill (records a snapshot without changing status). */
  async function handleUpdateVendorBillNote() {
    const vendorBillId = Number(selectedVendorBillId);
    if (!vendorBillId) return;
    setViewerErrorMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/vendor-bills/${vendorBillId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({ status_note: viewerNote }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setViewerErrorMessage(readApiErrorMessage(payload, "Note update failed."));
        return;
      }
      const updated = payload.data as VendorBillRecord;
      setVendorBills((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      billForm.hydrate(updated);
      viewer.setViewerNote("");
      setFormSuccess("Note recorded.");
      void viewer.loadSnapshots(updated.id);
    } catch {
      setViewerErrorMessage("Could not reach vendor bill endpoint.");
    }
  }

  /** Copies the selected bill's details into the create form for a "recreate" workflow. */
  function handleRecreateAsNewDraftTemplate() {
    if (!selectedVendorBillId) {
      setFormError("Select a vendor bill first.");
      return;
    }
    const selected = vendorBills.find((row) => String(row.id) === selectedVendorBillId);
    if (!selected) {
      setFormError("Selected vendor bill could not be found.");
      return;
    }
    billForm.populateCreateFromBill(selected);
    setSelectedVendorBillId("");
    setFormSuccess(`Copied bill #${selected.id} into create form. Enter a new bill number.`);
    flashCreator();
  }

  // -------------------------------------------------------------------------
  // Document scanning
  // -------------------------------------------------------------------------

  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanUnmatchedVendorName, setScanUnmatchedVendorName] = useState("");

  /** Handles file selection from the hidden input, sends to scan endpoint. */
  async function handleScanFile(file: File) {
    if (!authToken) return;
    setIsScanning(true);
    clearFormMessage();
    try {
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch(`${apiBaseUrl}/vendor-bills/scan/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken),
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        setFormError(payload?.error?.message || "Document scan failed.");
        return;
      }
      const scan = payload.data as ScanResult;
      // Switch to create mode and prefill from scan.
      setSelectedVendorBillId("");
      const unmatchedName = billForm.populateFromScan(scan);
      // Pre-fill combobox with scanned name so user can create a new vendor.
      if (unmatchedName) {
        setScanUnmatchedVendorName(unmatchedName);
      }
      flashCreator();

      const docLabel = scan.document_type === "bill" ? "bill" : "receipt";
      const name = scan.vendor_name || "";
      setFormSuccess(
        `Scanned ${docLabel}${name ? ` from ${name}` : ""}. Review and submit.`,
      );
    } catch {
      setFormError("Could not reach document scanning service.");
    } finally {
      setIsScanning(false);
      // Reset file input so re-selecting the same file triggers onChange.
      if (scanInputRef.current) scanInputRef.current.value = "";
    }
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  // Bootstrap: load project/vendor lists once authenticated.
  useEffect(() => {
    if (!authToken) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadDependencies();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  // Ensure date fields have sensible defaults on mount.
  useEffect(() => {
    billForm.ensureDateDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload vendor bills whenever the selected project changes.
  useEffect(() => {
    if (!authToken || !selectedProjectId) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadVendorBills();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, selectedProjectId]);

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
    billForm.hydrate(fallbackVendorBill);
    viewer.setViewerNote("");
    void viewer.loadSnapshots(fallbackVendorBill.id);
  }, [filteredVendorBills, selectedVendorBillId]);

  // Keep the viewer's next-status picker in sync with the selected bill's allowed transitions.
  useEffect(() => {
    if (!selectedVendorBill) {
      setViewerNextStatus("");
      return;
    }
    setViewerNextStatus("");
  }, [allowedStatusTransitions, selectedVendorBill]);




  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <section className={styles.console}>
      <VendorBillsViewerPanel
        isMobile={isMobile}
        selectedProject={selectedProject}
        isViewerExpanded={isViewerExpanded}
        setIsViewerExpanded={setIsViewerExpanded}
        billStatuses={billStatuses}
        billStatusFilters={billStatusFilters}
        billStatusCounts={billStatusCounts}
        billStatusLabels={billStatusLabels}
        toggleBillStatusFilter={toggleBillStatusFilter}
        setBillStatusFilters={setBillStatusFilters}
        defaultBillStatusFiltersFn={defaultBillStatusFilters}
        filteredVendorBills={filteredVendorBills}
        selectedVendorBillId={selectedVendorBillId}
        onSelectVendorBill={handleSelectVendorBill}
        canMutateVendorBills={canMutateVendorBills}
        quickStatusOptions={quickStatusOptions}
        viewerNextStatus={viewerNextStatus}
        setViewerNextStatus={setViewerNextStatus}
        viewerNote={viewerNote}
        setViewerNote={setViewerNote}
        viewerErrorMessage={viewerErrorMessage}
        onUpdateStatus={handleUpdateVendorBillStatus}
        onUpdateNote={handleUpdateVendorBillNote}
        isStatusSectionOpen={isStatusSectionOpen}
        setIsStatusSectionOpen={setIsStatusSectionOpen}
        isLineItemsSectionOpen={isLineItemsSectionOpen}
        setIsLineItemsSectionOpen={setIsLineItemsSectionOpen}
        isDetailsSectionOpen={isDetailsSectionOpen}
        setIsDetailsSectionOpen={setIsDetailsSectionOpen}
        isHistorySectionOpen={isHistorySectionOpen}
        setIsHistorySectionOpen={setIsHistorySectionOpen}
        snapshots={snapshots}
      />

      <VendorBillsWorkspacePanel
        isMobile={isMobile}
        canMutateVendorBills={canMutateVendorBills}
        role={role}
        selectedProjectId={selectedProjectId}
        selectedVendorBill={selectedVendorBill}
        workspaceIsLocked={workspaceIsLocked}
        workspaceContext={workspaceContext}
        workspaceBadgeLabel={workspaceBadgeLabel}
        workspaceBadgeClass={workspaceBadgeClass}
        isEditingMode={isEditingMode}
        onStartNew={handleStartNewVendorBill}
        onDuplicate={handleRecreateAsNewDraftTemplate}
        onResetCreate={() => { billForm.resetCreateForm(); flashCreator(); }}
        scanInputRef={scanInputRef}
        isScanning={isScanning}
        onScanFile={handleScanFile}
        billFormRef={billFormRef}
        onSubmit={handleSubmitVendorBillForm}
        vendors={vendors}
        formVendorId={formVendorId}
        setFormVendorId={setFormVendorId}
        formBillNumber={formBillNumber}
        setFormBillNumber={setFormBillNumber}
        formIssueDate={formIssueDate}
        setFormIssueDate={setFormIssueDate}
        formDueDate={formDueDate}
        setFormDueDate={setFormDueDate}
        formReceivedDate={formReceivedDate}
        setFormReceivedDate={setFormReceivedDate}
        formTaxAmount={formTaxAmount}
        setFormTaxAmount={setFormTaxAmount}
        formShippingAmount={formShippingAmount}
        setFormShippingAmount={setFormShippingAmount}
        formNotes={formNotes}
        setFormNotes={setFormNotes}
        formLineItems={formLineItems}
        updateFormLineItem={updateFormLineItem}
        removeFormLineItem={removeFormLineItem}
        addFormLineItem={addFormLineItem}
        computedSubtotal={computedSubtotal}
        computedTotal={computedTotal}
        duplicateCandidates={duplicateCandidates}
        formMessage={formMessage}
        formTone={formTone}
        billStatusLabels={billStatusLabels}
        scanUnmatchedVendorName={scanUnmatchedVendorName}
        onScanUnmatchedConsumed={() => setScanUnmatchedVendorName("")}
      />
    </section>
  );
}
