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
import { useCombobox } from "@/shared/hooks/use-combobox";
import { useCreatorFlash } from "@/shared/hooks/use-creator-flash";
import { useSearchParams } from "next/navigation";
import { formatDateDisplay } from "@/shared/date-format";
import { readApiErrorMessage } from "@/shared/api/error";
import {
  collapseToggleButtonStyles as collapseButtonStyles,
} from "@/shared/project-list-viewer";

import { useMediaQuery } from "@/shared/hooks/use-media-query";
import creatorStyles from "@/shared/document-creator/creator-foundation.module.css";
import { MobileLineItemCard } from "@/shared/document-creator/mobile-line-card";
import mobileCardStyles from "@/shared/document-creator/mobile-line-card.module.css";
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
  const vendorOptions = vendors;
  const quickStatusOptions = selectedVendorBill
    ? allowedStatusTransitions[selectedVendorBill.status] ?? []
    : [];

  // Workspace visibility + flash animation
  const [isViewerExpanded, setIsViewerExpanded] = useState(true);
  const { ref: billFormRef, flash: flashCreator } = useCreatorFlash<HTMLFormElement>();

  // -------------------------------------------------------------------------
  // Display helpers
  // -------------------------------------------------------------------------

  // --- Vendor combobox ---
  type VendorOption = { id: number; name: string; label: string };

  const vendorComboItems: VendorOption[] = useMemo(() => {
    return vendorOptions.map((v) => ({
      id: v.id,
      name: v.name,
      label: v.name,
    }));
  }, [vendorOptions]);

  const { inputRef: vendorInputRef, menuRef: vendorMenuRef, ...vendorCombobox } = useCombobox<VendorOption>({
    items: vendorComboItems,
    getLabel: (item) => item.label,
    onCommit: (item) => {
      setFormVendorId(item ? String(item.id) : "");
      vendorCombobox.close(item !== null);
    },
  });

  /** The currently selected vendor option for display. */
  const selectedVendorOption: VendorOption | null = useMemo(() => {
    if (formVendorId) {
      return vendorComboItems.find((o) => String(o.id) === formVendorId) ?? null;
    }
    return null;
  }, [formVendorId, vendorComboItems]);

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

  /** Renders the collapsible expanded sections for a selected vendor bill (shared between mobile cards and desktop table). */
  function renderExpandedSections(vendorBill: VendorBillRecord) {
    return (
      <div className={styles.expandedSections} onClick={(e) => e.stopPropagation()}>
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
              <label className={styles.statusPickerLabel}>
                Note
                <textarea
                  className={styles.viewerNoteInput}
                  value={viewerNote}
                  onChange={(e) => setViewerNote(e.target.value)}
                  placeholder="Optional note..."
                  disabled={!canMutateVendorBills}
                />
              </label>
              <div className={styles.viewerStatusActions}>
                <button
                  type="button"
                  className={styles.formPrimaryButton}
                  onClick={() => void handleUpdateVendorBillStatus()}
                  disabled={!selectedVendorBillId || !viewerNextStatus || !canMutateVendorBills}
                >
                  Update Status
                </button>
                <button
                  type="button"
                  className={styles.formSecondaryButton}
                  onClick={() => void handleUpdateVendorBillNote()}
                  disabled={!selectedVendorBillId || !canMutateVendorBills}
                >
                  Update Note
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
                        <th>Description</th>
                        <th>Qty</th>
                        <th>Unit Price</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendorBill.line_items.map((lineItem, lineIdx) => (
                        <tr key={lineIdx}>
                          <td>{lineItem.description || "—"}</td>
                          <td>{lineItem.quantity}</td>
                          <td>${lineItem.unit_price}</td>
                          <td>${lineItem.amount}</td>
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
                  <p className={styles.detailValue}>{vendorBill.vendor_name || "Expense"}</p>
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

        {/* Status History */}
        {snapshots.length > 0 ? (
          <div className={styles.viewerSection}>
            <button
              type="button"
              className={styles.viewerSectionToggle}
              onClick={(e) => { e.stopPropagation(); setIsHistorySectionOpen((v) => !v); }}
              aria-expanded={isHistorySectionOpen}
            >
              <h4>Status History ({snapshots.length})</h4>
              <span className={styles.viewerSectionArrow}>&#9660;</span>
            </button>
            {isHistorySectionOpen ? (
              <div className={styles.viewerSectionContent} onClick={(e) => e.stopPropagation()}>
                <div className={styles.readOnlyTableWrap}>
                  <table className={styles.readOnlyTable}>
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Date</th>
                        <th>Note</th>
                        <th>Who</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshots.map((snap) => (
                        <tr key={snap.id}>
                          <td>
                            <span className={`${styles.tableStatusBadge} ${statusBadgeClass(snap.capture_status as VendorBillStatus)}`}>
                              {snap.action_type === "notate" ? "note" : statusDisplayLabel(snap.capture_status as VendorBillStatus)}
                            </span>
                          </td>
                          <td>{formatDateDisplay(snap.created_at)}</td>
                          <td>{snap.status_note || "—"}</td>
                          <td>{snap.acted_by_display || snap.acted_by_email || "Unknown"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }


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
      tax_amount: billForm.newTaxAmount,
      shipping_amount: billForm.newShippingAmount,
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
          tax_amount: billForm.taxAmount,
          shipping_amount: billForm.shippingAmount,
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
        vendorCombobox.setQuery(unmatchedName);
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
      {/* ── Viewer Panel: bill table + inline expansion ──────────── */}
      <div className={styles.viewerPanel}>
        <div className={styles.panelHeader}>
          <h3>{selectedProject ? `Bills for: ${selectedProject.name}` : "Bills"}</h3>
          {!isMobile ? (
            <button
              type="button"
              className={collapseButtonStyles.collapseButton}
              style={{ background: "var(--surface)" }}
              onClick={() => setIsViewerExpanded((current) => !current)}
              aria-expanded={isViewerExpanded}
            >
              {isViewerExpanded ? "Collapse" : "Expand"}
            </button>
          ) : null}
        </div>

        {(isMobile || isViewerExpanded) ? (
        <>
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
          </div>
          <div className={styles.filterActions}>
            <button
              type="button"
              className={styles.filterActionButton}
              onClick={() => { setBillStatusFilters([...billStatuses]); }}
            >
              Show All
            </button>
            <button
              type="button"
              className={styles.filterActionButton}
              onClick={() => { setBillStatusFilters(defaultBillStatusFilters(billStatuses)); }}
            >
              Reset Filters
            </button>
          </div>
        </div>

        {isMobile ? (
          /* ── Mobile: card list ── */
          <div className={styles.billCardList}>
            {filteredVendorBills.length ? (
              filteredVendorBills.map((vendorBill) => {
                const isSelected = selectedVendorBillId === String(vendorBill.id);
                return (
                  <div
                    key={vendorBill.id}
                    className={`${styles.billCard} ${isSelected ? styles.billCardSelected : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectVendorBill(String(vendorBill.id))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelectVendorBill(String(vendorBill.id));
                      }
                    }}
                  >
                    <div className={styles.billCardTop}>
                      <div className={styles.billCardIdentity}>
                        <span className={styles.billCardVendor}>{vendorBill.vendor_name || "Expense"}</span>
                        <span className={styles.billCardMeta}>
                          #{vendorBill.id} {vendorBill.bill_number}
                          {vendorBill.due_date ? ` · Due ${formatDateDisplay(vendorBill.due_date)}` : ""}
                        </span>
                      </div>
                      <div className={styles.billCardAmountBlock}>
                        <span className={styles.billCardAmount}>${vendorBill.total}</span>
                        {Number(vendorBill.balance_due) > 0 && Number(vendorBill.balance_due) < Number(vendorBill.total) ? (
                          <span className={styles.billCardBalance}>{`$${vendorBill.balance_due} due`}</span>
                        ) : Number(vendorBill.balance_due) <= 0 && Number(vendorBill.total) > 0 ? (
                          <span className={styles.billCardBalancePaid}>Paid</span>
                        ) : null}
                      </div>
                    </div>
                    <div className={styles.billCardFooter}>
                      <span className={`${styles.tableStatusBadge} ${statusBadgeClass(vendorBill.status)}`}>
                        {statusDisplayLabel(vendorBill.status)}
                      </span>
                    </div>
                    {isSelected ? renderExpandedSections(vendorBill) : null}
                  </div>
                );
              })
            ) : (
              <p className={styles.viewerHint}>No bills match the selected status/due filters.</p>
            )}
          </div>
        ) : (
          /* ── Desktop: table ── */
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Vendor</th>
                  <th>Status</th>
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
                        <td>{vendorBill.vendor_name || "Expense"}</td>
                        <td>
                          <span className={`${styles.tableStatusBadge} ${statusBadgeClass(vendorBill.status)}`}>
                            {statusDisplayLabel(vendorBill.status)}
                          </span>
                        </td>
                        <td>{formatDateDisplay(vendorBill.due_date)}</td>
                        <td>${vendorBill.total}</td>
                        <td>${vendorBill.balance_due}</td>
                      </tr>,
                      isSelected ? (
                        <tr key={`expanded-${vendorBill.id}`} className={styles.expandedRow}>
                          <td colSpan={6}>
                            {renderExpandedSections(vendorBill)}
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className={styles.projectEmptyCell}>
                      No bills match the selected status/due filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        </>
        ) : null}
      </div>

      {/* ── Workspace Panel: bill form (create/edit) ─────────────── */}
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
                    Duplicate Bill
                  </button>
                  <button
                    type="button"
                    className={styles.toolbarActionButton}
                    onClick={handleStartNewVendorBill}
                  >
                    New Bill
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.toolbarActionButton}
                  onClick={() => { billForm.resetCreateForm(); flashCreator(); }}
                >
                  Reset
                </button>
              )}
              {canMutateVendorBills ? (
                <>
                  <input
                    ref={scanInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic"
                    className={styles.hiddenInput}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleScanFile(file);
                    }}
                  />
                  <button
                    type="button"
                    className={`${styles.toolbarActionButton} ${isScanning ? styles.scanningPulse : ""}`}
                    onClick={() => scanInputRef.current?.click()}
                    disabled={isScanning || !selectedProjectId}
                  >
                    {isScanning ? "Scanning…" : "Scan Bill/Receipt"}
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {/* ── WYSIWYG Bill Document Form ───────────────────────────── */}
          <form ref={billFormRef} className={styles.billDocument} onSubmit={handleSubmitVendorBillForm}>

            {/* Header: vendor (letterhead) + bill number */}
            <div className={styles.billDocHeader}>
              <div className={styles.billDocFrom}>
                <span className={styles.billDocFieldLabel}>From</span>
                <div className={styles.vendorCombobox}>
                  <div className={styles.vendorInputWrap}>
                    <input
                      ref={vendorInputRef}
                      className={styles.vendorInput}
                      role="combobox"
                      aria-expanded={vendorCombobox.isOpen}
                      aria-controls="vendor-combobox-listbox"
                      value={vendorCombobox.isOpen ? vendorCombobox.query : (selectedVendorOption ? selectedVendorOption.name : vendorCombobox.query)}
                      placeholder="Select vendor..."
                      onFocus={() => vendorCombobox.open(selectedVendorOption ? selectedVendorOption.name : "")}
                      onChange={(e) => {
                        vendorCombobox.handleInput(e.target.value);
                        if (formVendorId) setFormVendorId("");
                      }}
                      onKeyDown={vendorCombobox.handleKeyDown}
                      autoComplete="off"
                      disabled={workspaceIsLocked}
                    />
                    {!workspaceIsLocked ? (
                      <button
                        type="button"
                        className={styles.vendorChevron}
                        aria-label={selectedVendorOption ? "Clear selection" : "Open list"}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (selectedVendorOption) {
                            setFormVendorId("");
                            vendorCombobox.close(false);
                          } else {
                            vendorInputRef.current?.focus();
                            vendorCombobox.open("");
                          }
                        }}
                      >
                        {selectedVendorOption ? "×" : "▾"}
                      </button>
                    ) : null}
                  </div>
                  {vendorCombobox.isOpen && !workspaceIsLocked ? (
                    <div
                      ref={vendorMenuRef}
                      id="vendor-combobox-listbox"
                      className={styles.vendorMenu}
                      role="listbox"
                    >
                      {vendorCombobox.filteredItems.map((item, i) => (
                        <button
                          key={item.id}
                          type="button"
                          role="option"
                          aria-selected={String(item.id) === formVendorId}
                          className={`${styles.vendorOption} ${vendorCombobox.highlightIndex === i ? styles.vendorOptionActive : ""}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => vendorCombobox.setHighlightIndex(i)}
                          onClick={() => {
                            setFormVendorId(String(item.id));
                            vendorCombobox.close(true);
                          }}
                        >
                          {item.name}
                        </button>
                      ))}
                      {vendorCombobox.filteredItems.length === 0 && vendorCombobox.query.trim() ? (
                        <div className={styles.vendorNoResults}>No matches.</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className={styles.billDocBillNum}>
                <span className={styles.billDocFieldLabel}>Bill #</span>
                <input
                  className={styles.billDocBillNumInput}
                  value={formBillNumber}
                  onChange={(event) => setFormBillNumber(event.target.value)}
                  placeholder="e.g. INV-001"
                  disabled={workspaceIsLocked || !selectedProjectId}
                />
              </div>
            </div>

            {/* Dates row */}
            <div className={styles.billDocDates}>
              <label className={styles.billDocDateField}>
                <span className={styles.billDocFieldLabel}>Date</span>
                <input
                  type="date"
                  value={formIssueDate}
                  onChange={(event) => setFormIssueDate(event.target.value)}
                  disabled={workspaceIsLocked || !selectedProjectId}
                />
              </label>
              <label className={styles.billDocDateField}>
                <span className={styles.billDocFieldLabel}>Due Date</span>
                <input
                  type="date"
                  value={formDueDate}
                  onChange={(event) => setFormDueDate(event.target.value)}
                  disabled={workspaceIsLocked || !selectedProjectId}
                />
              </label>
              <label className={styles.billDocDateField}>
                <span className={styles.billDocFieldLabel}>Received</span>
                <input
                  type="date"
                  value={formReceivedDate}
                  onChange={(event) => setFormReceivedDate(event.target.value)}
                  disabled={workspaceIsLocked || !selectedProjectId}
                />
              </label>
            </div>

            {/* Line items */}
            {isMobile ? (
              <div className={mobileCardStyles.cardList}>
                {formLineItems.map((row, index) => (
                  <MobileLineItemCard
                    key={`line-${index}`}
                    index={index}
                    readOnly={workspaceIsLocked}
                    isFirst={index === 0}
                    isLast={index === formLineItems.length - 1}
                    onRemove={workspaceIsLocked ? undefined : () => removeFormLineItem(index)}
                    fields={[
                      {
                        label: "Description",
                        key: "description",
                        span: "full",
                        render: () => (
                          <input
                            className={mobileCardStyles.fieldInput}
                            value={row.description}
                            onChange={(event) => updateFormLineItem(index, { description: event.target.value })}
                            placeholder="Description"
                            disabled={workspaceIsLocked}
                          />
                        ),
                      },
                      {
                        label: "Qty",
                        key: "quantity",
                        render: () => (
                          <input
                            className={mobileCardStyles.fieldInput}
                            value={row.quantity}
                            onChange={(event) => updateFormLineItem(index, { quantity: event.target.value })}
                            placeholder="1"
                            inputMode="decimal"
                            disabled={workspaceIsLocked}
                          />
                        ),
                      },
                      {
                        label: "Unit Price",
                        key: "unit_price",
                        render: () => (
                          <input
                            className={mobileCardStyles.fieldInput}
                            value={row.unit_price}
                            onChange={(event) => updateFormLineItem(index, { unit_price: event.target.value })}
                            placeholder="0.00"
                            inputMode="decimal"
                            disabled={workspaceIsLocked}
                          />
                        ),
                      },
                      {
                        label: "Amount",
                        key: "amount",
                        align: "right",
                        render: () => (
                          <span className={`${mobileCardStyles.fieldStatic} ${mobileCardStyles.fieldStaticRight}`}>
                            ${((Number(row.quantity) || 0) * (Number(row.unit_price) || 0)).toFixed(2)}
                          </span>
                        ),
                      },
                    ]}
                  />
                ))}
              </div>
            ) : (
              <div className={`${creatorStyles.lineTable} ${styles.billLineTable}`}>
                <div className={workspaceIsLocked ? creatorStyles.lineHeaderSimpleReadOnly : creatorStyles.lineHeaderSimple}>
                  <div className={creatorStyles.lineHeaderCell}><span>Description</span></div>
                  <div className={creatorStyles.lineHeaderCell}><span>Qty</span></div>
                  <div className={creatorStyles.lineHeaderCell}><span>Unit Price</span></div>
                  <div className={creatorStyles.lineHeaderCell}><span>Amount</span></div>
                  {!workspaceIsLocked ? <div className={creatorStyles.lineHeaderCell} /> : null}
                </div>
                {formLineItems.map((row, index) => (
                  <div
                    key={`line-${index}`}
                    className={workspaceIsLocked ? creatorStyles.lineRowSimpleReadOnly : creatorStyles.lineRowSimple}
                  >
                    <div className={creatorStyles.lineCell}>
                      <input
                        className={creatorStyles.lineInput}
                        value={row.description}
                        onChange={(event) => updateFormLineItem(index, { description: event.target.value })}
                        placeholder="Description"
                        disabled={workspaceIsLocked}
                      />
                    </div>
                    <div className={creatorStyles.lineCell}>
                      <input
                        className={creatorStyles.lineInput}
                        value={row.quantity}
                        onChange={(event) => updateFormLineItem(index, { quantity: event.target.value })}
                        placeholder="1"
                        inputMode="decimal"
                        disabled={workspaceIsLocked}
                        style={{ textAlign: "right" }}
                      />
                    </div>
                    <div className={creatorStyles.lineCell}>
                      <input
                        className={creatorStyles.lineInput}
                        value={row.unit_price}
                        onChange={(event) => updateFormLineItem(index, { unit_price: event.target.value })}
                        placeholder="0.00"
                        inputMode="decimal"
                        disabled={workspaceIsLocked}
                        style={{ textAlign: "right" }}
                      />
                    </div>
                    <div className={creatorStyles.lineCell}>
                      <div className={creatorStyles.amountCell}>
                        ${((Number(row.quantity) || 0) * (Number(row.unit_price) || 0)).toFixed(2)}
                      </div>
                    </div>
                    {!workspaceIsLocked ? (
                      <div className={creatorStyles.lineCell}>
                        <button
                          type="button"
                          className={creatorStyles.removeButton}
                          onClick={() => removeFormLineItem(index)}
                          disabled={formLineItems.length <= 1}
                          aria-label="Remove line"
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            {/* Add line + summary */}
            {!workspaceIsLocked ? (
              <div className={creatorStyles.lineActions}>
                <button
                  type="button"
                  className={creatorStyles.secondaryButton}
                  onClick={addFormLineItem}
                >
                  Add Line Item
                </button>
              </div>
            ) : null}

            <div className={creatorStyles.summary}>
              <div className={creatorStyles.summaryRow}>
                <span>Subtotal</span>
                <span>${computedSubtotal.toFixed(2)}</span>
              </div>
              <div className={creatorStyles.summaryRow}>
                <span>Tax</span>
                <span className={creatorStyles.summaryTaxLine}>
                  <input
                    className={`${creatorStyles.summaryTaxInput} ${styles.billSummaryDollarInput}`}
                    value={formTaxAmount}
                    onChange={(event) => setFormTaxAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    disabled={workspaceIsLocked}
                  />
                </span>
              </div>
              <div className={creatorStyles.summaryRow}>
                <span>Shipping / Freight</span>
                <span className={creatorStyles.summaryTaxLine}>
                  <input
                    className={`${creatorStyles.summaryTaxInput} ${styles.billSummaryDollarInput}`}
                    value={formShippingAmount}
                    onChange={(event) => setFormShippingAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    disabled={workspaceIsLocked}
                  />
                </span>
              </div>
              <div className={`${creatorStyles.summaryRow} ${creatorStyles.summaryTotal}`}>
                <span>Total</span>
                <strong>${computedTotal.toFixed(2)}</strong>
              </div>
            </div>

            {/* Notes */}
            <div className={styles.billDocNotes}>
              <span className={styles.billDocFieldLabel}>Notes</span>
              <textarea
                className={styles.billDocNotesInput}
                value={formNotes}
                onChange={(event) => setFormNotes(event.target.value)}
                disabled={workspaceIsLocked}
                placeholder="Optional notes from the vendor bill..."
              />
            </div>

            {/* Submit */}
            {!workspaceIsLocked ? (
              <div className={styles.submitRow}>
                {formMessage ? (
                  <p className={formTone === "error" ? styles.submitErrorText : styles.submitSuccessText} role="alert" aria-live="polite">
                    {formMessage}
                  </p>
                ) : null}
                <button
                  type="submit"
                  className={styles.formPrimaryButton}
                  disabled={!canMutateVendorBills || !selectedProjectId || !formVendorId}
                >
                  {isEditingMode ? "Save Vendor Bill" : "Create Vendor Bill"}
                </button>
              </div>
            ) : null}
          </form>

          {duplicateCandidates.length > 0 ? (
            <div className={styles.impactCard}>
              <p><strong>Duplicate candidates:</strong></p>
              {duplicateCandidates.map((candidate) => (
                <p key={candidate.id}>
                  #{candidate.id} {candidate.vendor_name || "Expense"} / {candidate.bill_number} (
                  {statusDisplayLabel(candidate.status)})
                </p>
              ))}
              <p>Void matching bill(s) first if you need to reuse this bill number.</p>
            </div>
          ) : null}
        </div>

      {!canMutateVendorBills ? <p className={styles.inlineHint}>Role `{role}` can view bills but cannot create or update.</p> : null}
    </section>
  );
}
