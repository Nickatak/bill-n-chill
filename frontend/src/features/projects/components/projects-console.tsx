"use client";

/**
 * Primary project hub — browse, select, and manage projects.
 *
 * Three-panel layout: filterable project list (left), financial snapshot
 * with scope control and billing tree (center), and inline project
 * profile editor (right). All state is local — no extracted hooks yet.
 *
 * Parent: app/projects/page.tsx
 *
 * ## Page layout
 *
 * ┌──────────────┬──────────────────────────────────┐
 * │ Project list │ Financial snapshot                │
 * │   ├── Search │   ├── Contract / AR / AP metrics  │
 * │   ├── Status │   ├── Estimate status counts      │
 * │   │   pills  │   ├── CO / Invoice / Bill counts  │
 * │   └── Cards  │   ├── Quick-entry tabs             │
 * │              │   └── Billing tree (scoped links)  │
 * │              ├──────────────────────────────────┤
 * │              │ Profile editor (collapsible)      │
 * │              │   ├── Project name                │
 * │              │   ├── Status selector             │
 * │              │   └── Save                        │
 * └──────────────┴──────────────────────────────────┘
 *
 * ## State (useState) — 14 calls
 *
 * Data: projects, summary, estimate/CO/bill/invoice status counts,
 *       acceptedEstimateTotal, invoiceAllocationTargets
 * Selection: selectedProjectId, isProjectEditOpen
 * Filters: projectSearch, projectStatusFilters
 * Form: projectName, projectStatus
 *
 * ## Functions
 *
 * - loadProjects() — fetches all projects, auto-selects based on URL scope
 * - loadFinancialSummary() — fetches /projects/:id/financial-summary/
 * - loadStatusCounts() — fetches status breakdowns for estimates, COs, bills, invoices
 * - hydrateForm(project) — populates name + status fields
 * - handleProjectSave(event) — PATCHes project profile
 * - toggleProjectStatusFilter(status) — toggles a status pill in/out
 *
 * ## Effects (5)
 *
 * 1. Fetch projects on mount (deps: [token])
 * 2. Fetch financial summary when selection changes (deps: [selectedProjectId, token])
 * 3. Fetch status counts when selection changes (deps: [selectedProjectId, token])
 * 4. Fetch allocation targets when selection changes (deps: [selectedProjectId, token])
 * 5. Auto-select scoped project from URL params (deps: [projects, scopedProjectId])
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { readApiErrorMessage } from "@/shared/api/error";
import { formatCurrency } from "@/shared/money-format";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { useStatusMessage } from "@/shared/hooks/use-status-message";
import styles from "./projects-console.module.css";
import { PaymentRecorder, type AllocationTarget } from "@/features/payments";
import { QuickReceipt } from "@/features/vendor-bills/components/quick-receipt";
import { ProjectListViewer } from "@/shared/project-list-viewer";
import { ApiResponse, ProjectFinancialSummary, ProjectRecord } from "../types";
import {
  PROJECT_STATUS_VALUES,
  DEFAULT_PROJECT_STATUS_FILTERS,
  parseMoneyValue,
  formatCustomerName,
  projectStatusLabel,
  allowedProfileStatuses,
} from "../utils/project-helpers";
import type { ProjectStatusValue } from "../utils/project-helpers";

/** Renders the main project dashboard with list, financial map, and profile editor. */
export function ProjectsConsole() {
  const searchParams = useSearchParams();
  const { token: authToken, authMessage } = useSharedSessionAuth();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const {
    message: statusMessage,
    tone: statusMessageTone,
    setSuccess: setSuccessStatusMessage,
    setError: setErrorStatusMessage,
  } = useStatusMessage();
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilters, setProjectStatusFilters] = useState<ProjectStatusValue[]>(
    DEFAULT_PROJECT_STATUS_FILTERS,
  );
  const [summary, setSummary] = useState<ProjectFinancialSummary | null>(null);
  const [estimateStatusCounts, setEstimateStatusCounts] = useState<{
    draft: number;
    sent: number;
    approved: number;
  } | null>(null);
  const [changeOrderStatusCounts, setChangeOrderStatusCounts] = useState<{
    draft: number;
    sent: number;
    accepted: number;
  } | null>(null);
  const [billStatusCounts, setBillStatusCounts] = useState<{
    received: number;
    approved: number;
    disputed: number;
  } | null>(null);
  const [invoiceStatusCounts, setInvoiceStatusCounts] = useState<{
    draft: number;
    sent: number;
    partially_paid: number;
  } | null>(null);
  const [acceptedEstimateTotal, setAcceptedEstimateTotal] = useState("--");
  const [invoiceAllocationTargets, setInvoiceAllocationTargets] = useState<AllocationTarget[]>([]);
  const [toolbarPanel, setToolbarPanel] = useState<"payment" | "receipt" | null>(null);
  const [isProjectEditOpen, setIsProjectEditOpen] = useState(false);
  const projectEditFormRef = useRef<HTMLFormElement | null>(null);

  const [projectName, setProjectName] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatusValue>("prospect");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const scopedProjectIdParam = searchParams.get("project");
  const scopedCustomerIdParam = searchParams.get("customer");
  const scopedProjectId =
    scopedProjectIdParam && /^\d+$/.test(scopedProjectIdParam)
      ? Number(scopedProjectIdParam)
      : null;
  const scopedCustomerId =
    scopedCustomerIdParam && /^\d+$/.test(scopedCustomerIdParam)
      ? Number(scopedCustomerIdParam)
      : null;
  const customerScopedProjects = scopedCustomerId
    ? projects.filter((project) => project.customer === scopedCustomerId)
    : projects;
  const hasSelectedProject = Boolean(selectedProjectId);
  const selectedProject =
    projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const isSelectedProjectTerminal =
    selectedProject?.status === "completed" || selectedProject?.status === "cancelled";
  const isSelectedProjectProspect = selectedProject?.status === "prospect";
  const hasApprovedEstimate = (estimateStatusCounts?.approved ?? 0) > 0;
  const hasPayableInvoices = invoiceAllocationTargets.length > 0;
  const computedProfileStatuses = selectedProject
    ? allowedProfileStatuses(selectedProject.status as ProjectStatusValue)
    : [];
  const needle = projectSearch.trim().toLowerCase();
  const filteredProjects = !needle
    ? customerScopedProjects
    : customerScopedProjects.filter((project) => {
        const haystack = [
          String(project.id),
          project.name,
          formatCustomerName(project),
          project.status,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
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
  const statusFilteredProjects = filteredProjects.filter((project) =>
    projectStatusFilters.includes(project.status as ProjectStatusValue),
  );
  const acceptedContractRaw =
    summary?.accepted_contract_total ??
    selectedProject?.accepted_contract_total ??
    acceptedEstimateTotal;
  const acceptedContractDisplay = summary ? formatCurrency(parseMoneyValue(acceptedContractRaw)) : "--";
  const invoicedDisplay = summary ? formatCurrency(parseMoneyValue(summary.invoiced_to_date)) : "--";
  const paidDisplay = summary ? formatCurrency(parseMoneyValue(summary.paid_to_date)) : "--";
  const arOutstandingDisplay = summary ? formatCurrency(parseMoneyValue(summary.ar_outstanding)) : "--";
  const remainingToInvoiceDisplay = summary
    ? formatCurrency(parseMoneyValue(acceptedContractRaw) - parseMoneyValue(summary.invoiced_to_date))
    : "--";

  /** Maps a status value like "on_hold" to its corresponding CSS module class. */
  function projectStatusClass(statusValue: string): string {
    const key = `projectStatus${statusValue
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`;
    return styles[key] ?? "";
  }

  /** Toggles a status value in or out of the active project list filters. */
  function toggleProjectStatusFilter(nextStatus: ProjectStatusValue) {
    setProjectStatusFilters((current) =>
      current.includes(nextStatus)
        ? current.filter((statusValue) => statusValue !== nextStatus)
        : [...current, nextStatus],
    );
  }

  /** Populates the profile form fields from a project record. */
  function hydrateForm(project: ProjectRecord) {
    setProjectName(project.name);
    setProjectStatus(project.status as ProjectStatusValue);
  }

  /** Fetches all projects and auto-selects based on URL scope or default filters. */
  async function loadProjects() {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        return;
      }
      const items = (payload.data as ProjectRecord[]) ?? [];
      const scopedItems = scopedCustomerId
        ? items.filter((project) => project.customer === scopedCustomerId)
        : items;
      setProjects(items);
      if (scopedItems[0]) {
        const scopedMatch = scopedProjectId
          ? scopedItems.find((project) => project.id === scopedProjectId)
          : null;
        const preferredProject =
          scopedMatch ??
          scopedItems.find((project) =>
            DEFAULT_PROJECT_STATUS_FILTERS.includes(project.status as ProjectStatusValue),
          ) ?? scopedItems[0];
        if (scopedMatch) {
          const scopedStatus = scopedMatch.status as ProjectStatusValue;
          setProjectStatusFilters((current) =>
            current.includes(scopedStatus) ? current : [...current, scopedStatus],
          );
        }
        setSelectedProjectId(String(preferredProject.id));
        hydrateForm(preferredProject);
        setSummary(null);
      } else {
        setSelectedProjectId("");
        setSummary(null);
        setEstimateStatusCounts(null);
        setChangeOrderStatusCounts(null);
        setBillStatusCounts(null);
        setInvoiceStatusCounts(null);
      }
    } catch {
      // Network error — silently fail; the empty project list is visible feedback.
    }
  }

  /** Fetches the financial summary (contract, AR, AP totals) for the selected project. */
  async function loadFinancialSummary() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      return;
    }
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/financial-summary/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        return;
      }

      setSummary(payload.data as ProjectFinancialSummary);
    } catch {
      // Network error — summary panel will remain empty.
    }
  }

  /** Loads estimate counts by status for the scope-control badges. */
  async function loadEstimateStatusCounts(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setEstimateStatusCounts(null);
        return;
      }
      const rows = (payload.data as Array<{ status?: string; grand_total?: string | number }>) ?? [];
      let draft = 0;
      let sent = 0;
      let approved = 0;
      let acceptedTotal = 0;
      for (const estimate of rows) {
        if (estimate.status === "draft") {
          draft += 1;
        } else if (estimate.status === "sent") {
          sent += 1;
        } else if (estimate.status === "approved") {
          approved += 1;
          acceptedTotal += parseMoneyValue(estimate.grand_total);
        }
      }
      setEstimateStatusCounts({ draft, sent, approved });
      setAcceptedEstimateTotal(formatCurrency(acceptedTotal));
    } catch {
      setEstimateStatusCounts(null);
      setAcceptedEstimateTotal("--");
    }
  }

  /** Loads change order counts by status for the scope-control badges. */
  async function loadChangeOrderStatusCounts(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/change-orders/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setChangeOrderStatusCounts(null);
        return;
      }
      const rows = (payload.data as Array<{ status?: string; amount_delta?: string | number }>) ?? [];
      let draft = 0;
      let sent = 0;
      let accepted = 0;
      for (const changeOrder of rows) {
        if (changeOrder.status === "draft") {
          draft += 1;
        } else if (changeOrder.status === "sent") {
          sent += 1;
        } else if (changeOrder.status === "approved") {
          accepted += 1;
        }
      }
      setChangeOrderStatusCounts({ draft, sent, accepted });
    } catch {
      setChangeOrderStatusCounts(null);
    }
  }

  /** Loads vendor bill counts by status for the pipeline badges. */
  async function loadBillStatusCounts(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/vendor-bills/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setBillStatusCounts(null);
        return;
      }
      const rows = (payload.data as Array<{ status?: string }>) ?? [];
      let received = 0;
      let approved = 0;
      let disputed = 0;
      for (const bill of rows) {
        if (bill.status === "received") {
          received += 1;
        } else if (bill.status === "approved") {
          approved += 1;
        } else if (bill.status === "disputed") {
          disputed += 1;
        }
      }
      setBillStatusCounts({ received, approved, disputed });
    } catch {
      setBillStatusCounts(null);
    }
  }

  /** Loads invoice counts by status for the pipeline badges. */
  async function loadInvoiceStatusCounts(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/invoices/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setInvoiceStatusCounts(null);
        return;
      }
      const rows = (payload.data as Array<{ status?: string }>) ?? [];
      let draft = 0;
      let sent = 0;
      let partially_paid = 0;
      for (const invoice of rows) {
        if (invoice.status === "draft") {
          draft += 1;
        } else if (invoice.status === "sent") {
          sent += 1;
        } else if (invoice.status === "partially_paid") {
          partially_paid += 1;
        }
      }
      setInvoiceStatusCounts({ draft, sent, partially_paid });
    } catch {
      setInvoiceStatusCounts(null);
    }
  }

  /** Loads invoices for the selected project and maps them to allocation targets. */
  async function loadInvoiceAllocationTargets(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/invoices/`, {
        headers: buildAuthHeaders(authToken),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setInvoiceAllocationTargets([]);
        return;
      }
      const rows = (payload.data as Array<{
        id: number;
        invoice_number?: string;
        balance_due?: string;
        status?: string;
      }>) ?? [];
      setInvoiceAllocationTargets(
        rows
          .filter((inv) => inv.status !== "void" && inv.status !== "draft" && Number(inv.balance_due || 0) > 0)
          .map((inv) => ({
            id: inv.id,
            label: inv.invoice_number ? `Invoice ${inv.invoice_number}` : `Invoice #${inv.id}`,
            balanceDue: inv.balance_due ?? "0.00",
          })),
      );
    } catch {
      setInvoiceAllocationTargets([]);
    }
  }

  // Fetch the full project list whenever auth or URL scope changes.
  useEffect(() => {
    if (!authToken) {
      return;
    }
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, scopedProjectId, scopedCustomerId]);

  // Re-load financials and scope-control counts when a different project is selected.
  useEffect(() => {
    if (!authToken || !selectedProjectId) {
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      return;
    }
    void loadFinancialSummary();
    void loadEstimateStatusCounts(projectId);
    void loadChangeOrderStatusCounts(projectId);
    void loadBillStatusCounts(projectId);
    void loadInvoiceStatusCounts(projectId);
    void loadInvoiceAllocationTargets(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, authToken]);

  // If the selected project is no longer visible after filtering, fall back to the first visible one.
  useEffect(() => {
    if (statusFilteredProjects.length === 0) {
      return;
    }
    const selectedStillVisible = statusFilteredProjects.some(
      (project) => String(project.id) === selectedProjectId,
    );
    if (selectedStillVisible) {
      return;
    }

    const fallbackProject = statusFilteredProjects[0];
    setSelectedProjectId(String(fallbackProject.id));
    hydrateForm(fallbackProject);

    setSummary(null);
    setEstimateStatusCounts(null);
    setChangeOrderStatusCounts(null);
    setBillStatusCounts(null);
    setInvoiceStatusCounts(null);
    setAcceptedEstimateTotal("--");
  }, [selectedProjectId, statusFilteredProjects]);

  // Scroll the profile form into view when it opens, so users don't miss it off-screen.
  useEffect(() => {
    if (!isProjectEditOpen || isSelectedProjectTerminal) {
      return;
    }
    const formEl = projectEditFormRef.current;
    if (!formEl) {
      return;
    }

    const rect = formEl.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const isFullyVisible = rect.top >= 0 && rect.bottom <= viewportHeight;
    if (!isFullyVisible) {
      formEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isProjectEditOpen, isSelectedProjectTerminal, selectedProjectId]);

  /** Switches the selected project and resets downstream financial state. */
  function handleSelectProject(project: { id: number }) {
    if (String(project.id) === selectedProjectId) {
      return;
    }
    const selected = projects.find((row) => row.id === project.id);
    if (!selected) {
      return;
    }
    setSelectedProjectId(String(project.id));
    setIsProjectEditOpen(false);
    setToolbarPanel(null);
    hydrateForm(selected);

    // Clear stale financial data so it re-loads for the new project.
    setSummary(null);
    setEstimateStatusCounts(null);
    setChangeOrderStatusCounts(null);
    setBillStatusCounts(null);
    setInvoiceStatusCounts(null);
    setAcceptedEstimateTotal("--");
  }

  /** Toggles the project profile editor open/closed, pre-selecting the first allowed status. */
  function toggleProjectEdit() {
    setIsProjectEditOpen((current) => {
      const nextOpen = !current;
      if (nextOpen && selectedProject) {
        setProjectStatus(selectedProject.status as ProjectStatusValue);
      }
      return nextOpen;
    });
  }

  /** Validates and PATCHes the project profile form to the API. */
  async function handleSaveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setErrorStatusMessage(
        "No project selected. Load projects first, then pick one from the project dropdown.",
      );
      return;
    }
    // Validation passed -- submit the PATCH.
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({
          name: projectName,
          status: projectStatus,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatusMessage(readApiErrorMessage(payload, "Save failed. Check values and auth token."));
        return;
      }

      const updated = payload.data as ProjectRecord;
      setProjects((current) =>
        current.map((project) => (project.id === updated.id ? updated : project)),
      );
      setSuccessStatusMessage(`Project #${updated.id} saved.`);
    } catch {
      setErrorStatusMessage("Could not reach project detail endpoint.");
    }
  }

  return (
    <section className={styles.pageRoot}>
      {authMessage.startsWith("No shared session") ? <p>{authMessage}</p> : null}

      {projects.length === 0 ? (
        <p className={styles.emptyState}>
          No projects yet. Head to <Link href="/customers" style={{ fontWeight: 600 }}>Customers</Link> and
          use the &ldquo;Add Project&rdquo; button on any customer to get started.
        </p>
      ) : null}

      {projects.length > 0 ? (
        <ProjectListViewer
          title="Choose a project below"
          expandedHint="Select a project to open its map, financial snapshot, and downstream actions."
          showSearchAndFilters
          searchValue={projectSearch}
          onSearchChange={setProjectSearch}
          statusValues={[...PROJECT_STATUS_VALUES]}
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
            customer_display_name: formatCustomerName(project),
            status: project.status,
          }))}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
          statusLabel={projectStatusLabel}
        />
      ) : null}

      {selectedProject ? (
        <section className={styles.overview}>
          <div className={styles.overviewGrid}>
            <div className={styles.treePanel}>
              <div className={styles.treeRoot}>
                <div className={styles.rootTitleRow}>
                  <span className={styles.rootTitle}>{selectedProject.name}</span>
                  {!isSelectedProjectTerminal ? (
                    <button
                      type="button"
                      className={styles.projectSettingsToggle}
                      aria-expanded={isProjectEditOpen}
                      onClick={toggleProjectEdit}
                    >
                      {isProjectEditOpen ? "Close Edit" : "Edit Project"}
                    </button>
                  ) : (
                    <span className={styles.terminalHint}>
                      {selectedProject?.status === "completed" ? "Completed" : "Cancelled"} — no longer editable
                    </span>
                  )}
                </div>
                {isProjectEditOpen && !isSelectedProjectTerminal ? (
                  <form ref={projectEditFormRef} className={styles.projectEditForm} onSubmit={handleSaveProject}>
                    <label>
                      Project name
                      <input value={projectName} onChange={(event) => setProjectName(event.target.value)} required />
                    </label>
                    <label>
                      Status
                      <div className={styles.projectStatusPills}>
                        <span className={styles.projectStatusCurrentLabel}>
                          Current: {projectStatusLabel(selectedProject.status)}
                        </span>
                        {computedProfileStatuses.map((statusOption) => {
                          const active = projectStatus === statusOption;
                          return (
                            <button
                              key={statusOption}
                              type="button"
                              className={`${styles.projectStatusPill} ${
                                active ? projectStatusClass(statusOption) : styles.projectStatusPillInactive
                              } ${active ? styles.projectStatusPillActive : ""}`}
                              aria-pressed={active}
                              onClick={() => setProjectStatus(statusOption)}
                            >
                              {projectStatusLabel(statusOption)}
                            </button>
                          );
                        })}
                      </div>
                    </label>
                    {statusMessage ? (
                      <p
                        className={`${styles.statusMessage} ${
                          statusMessageTone === "success"
                            ? styles.statusMessageSuccess
                            : statusMessageTone === "error"
                              ? styles.statusMessageError
                              : ""
                        }`}
                      >
                        {statusMessage}
                      </p>
                    ) : null}
                    <button
                      type="submit"
                      className={styles.projectEditSubmit}
                      disabled={!hasSelectedProject}
                    >
                      Save
                    </button>
                  </form>
                ) : null}
              </div>
              <nav className={styles.pipeline} aria-label="Project workflow">
                <Link href={`/projects/${selectedProject.id}/estimates`} className={styles.pipelineStage}>
                  <svg className={styles.pipelineIcon} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                  </svg>
                  <span className={styles.pipelineLabel}>Estimates</span>
                  <span className={styles.pipelineCounts}>
                    <span className={`${styles.estimateCountPill} ${styles.estimateCountDraft}`}>
                      D{estimateStatusCounts ? estimateStatusCounts.draft : "--"}
                    </span>
                    <span className={`${styles.estimateCountPill} ${styles.estimateCountSent}`}>
                      S{estimateStatusCounts ? estimateStatusCounts.sent : "--"}
                    </span>
                    <span className={`${styles.estimateCountPill} ${styles.estimateCountApproved}`}>
                      A{estimateStatusCounts ? estimateStatusCounts.approved : "--"}
                    </span>
                  </span>
                </Link>

                <span className={styles.pipelineArrow} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>

                <Link href={`/projects/${selectedProject.id}/change-orders`} className={styles.pipelineStage}>
                  <svg className={styles.pipelineIcon} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="17 1 21 5 17 9" />
                    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                    <polyline points="7 23 3 19 7 15" />
                    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                  </svg>
                  <span className={styles.pipelineLabel}>Change Orders</span>
                  <span className={styles.pipelineCounts}>
                    <span className={`${styles.estimateCountPill} ${styles.estimateCountDraft}`}>
                      D{changeOrderStatusCounts ? changeOrderStatusCounts.draft : "--"}
                    </span>
                    <span className={`${styles.estimateCountPill} ${styles.estimateCountSent}`}>
                      S{changeOrderStatusCounts ? changeOrderStatusCounts.sent : "--"}
                    </span>
                    <span className={`${styles.estimateCountPill} ${styles.estimateCountApproved}`}>
                      A{changeOrderStatusCounts ? changeOrderStatusCounts.accepted : "--"}
                    </span>
                  </span>
                </Link>

                <span className={styles.pipelineArrow} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>

                <Link href={`/projects/${selectedProject.id}/invoices`} className={styles.pipelineStage}>
                  <svg className={styles.pipelineIcon} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  <span className={styles.pipelineLabel}>Invoices</span>
                  <span className={styles.pipelineCounts}>
                    <span className={`${styles.estimateCountPill} ${styles.estimateCountDraft}`}>
                      D{invoiceStatusCounts ? invoiceStatusCounts.draft : "--"}
                    </span>
                    <span className={`${styles.estimateCountPill} ${styles.estimateCountSent}`}>
                      S{invoiceStatusCounts ? invoiceStatusCounts.sent : "--"}
                    </span>
                    <span className={`${styles.estimateCountPill} ${styles.invoiceCountPartial}`}>
                      P{invoiceStatusCounts ? invoiceStatusCounts.partially_paid : "--"}
                    </span>
                  </span>
                </Link>

                <span className={styles.pipelineArrow} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>

                <Link href={`/projects/${selectedProject.id}/bills`} className={styles.pipelineStage}>
                  <svg className={styles.pipelineIcon} width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M7 15h0M2 9.5h20" />
                  </svg>
                  <span className={styles.pipelineLabel}>Bills</span>
                  <span className={styles.pipelineCounts}>
                    <span className={`${styles.estimateCountPill} ${styles.billCountReceived}`}>
                      R{billStatusCounts ? billStatusCounts.received : "--"}
                    </span>
                    <span className={`${styles.estimateCountPill} ${styles.billCountDisputed}`}>
                      D{billStatusCounts ? billStatusCounts.disputed : "--"}
                    </span>
                    <span className={`${styles.estimateCountPill} ${styles.estimateCountApproved}`}>
                      A{billStatusCounts ? billStatusCounts.approved : "--"}
                    </span>
                  </span>
                </Link>

              </nav>

              <div className={styles.actionToolbar} role="toolbar" aria-label="Project actions">
                <Link
                  href={`/projects/${selectedProject.id}/invoices?action=deposit`}
                  className={`${styles.toolbarAction} ${styles.toolbarActionLaunch} ${!hasApprovedEstimate ? styles.toolbarActionDisabled : ""}`}
                  aria-disabled={!hasApprovedEstimate}
                  tabIndex={!hasApprovedEstimate ? -1 : undefined}
                  onClick={(e) => { if (!hasApprovedEstimate) e.preventDefault(); }}
                >
                  Invoice Deposit
                </Link>
                <Link
                  href={`/projects/${selectedProject.id}/invoices?action=from-estimate`}
                  className={`${styles.toolbarAction} ${styles.toolbarActionLaunch} ${!hasApprovedEstimate ? styles.toolbarActionDisabled : ""}`}
                  aria-disabled={!hasApprovedEstimate}
                  tabIndex={!hasApprovedEstimate ? -1 : undefined}
                  onClick={(e) => { if (!hasApprovedEstimate) e.preventDefault(); }}
                >
                  Invoice from Estimate + COs
                </Link>
                <button
                  type="button"
                  className={`${styles.toolbarAction} ${toolbarPanel === "payment" ? styles.toolbarActionActive : ""}`}
                  disabled={!hasPayableInvoices || isSelectedProjectProspect}
                  onClick={() => setToolbarPanel(toolbarPanel === "payment" ? null : "payment")}
                >
                  Record Payment
                </button>
                <button
                  type="button"
                  className={`${styles.toolbarAction} ${toolbarPanel === "receipt" ? styles.toolbarActionActive : ""}`}
                  onClick={() => setToolbarPanel(toolbarPanel === "receipt" ? null : "receipt")}
                >
                  Log Receipt
                </button>
              </div>

            </div>

            <div className={styles.paymentRecorderSection}>
              {toolbarPanel === "payment" ? (
                <PaymentRecorder
                  projectId={selectedProject.id}
                  direction="inbound"
                  allocationTargets={invoiceAllocationTargets}
                  hideHeader
                  createOnly
                  hideWorkspaceTitle
                  onPaymentsChanged={() => {
                    void loadFinancialSummary();
                    void loadInvoiceAllocationTargets(selectedProject.id);
                  }}
                />
              ) : toolbarPanel === "receipt" ? (
                <QuickReceipt
                  projectId={selectedProject.id}
                  authToken={authToken ?? ""}
                />
              ) : (
                <p className={styles.toolbarPanelPrompt}>
                  Select an action from the toolbar to get started.
                </p>
              )}
            </div>

            <div className={styles.metricsPanel}>
              <div className={styles.metricRow}>
                <span>Contract Total</span>
                <strong>{acceptedContractDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Invoiced</span>
                <strong>{invoicedDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Paid</span>
                <strong>{paidDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Outstanding</span>
                <strong>{arOutstandingDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Remaining to Invoice</span>
                <strong>{remainingToInvoiceDisplay}</strong>
              </div>
            </div>
          </div>

        </section>
      ) : null}

    </section>
  );
}
