"use client";

/**
 * Primary project hub that lets users browse, select, and manage projects.
 * Shows a paginated/filterable project list, a financial snapshot with scope
 * control and billing tree, and an inline project profile editor.
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { readApiErrorMessage } from "@/shared/api/error";
import { formatCurrency } from "@/shared/money-format";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { usePagination } from "@/shared/hooks/use-pagination";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { useStatusMessage } from "@/shared/hooks/use-status-message";
import styles from "./projects-console.module.css";
import { ProjectListStatusValue, ProjectListViewer } from "@/shared/project-list-viewer";
import { ApiResponse, ProjectFinancialSummary, ProjectRecord } from "../types";

type ProjectStatusValue = ProjectListStatusValue;
const PROJECT_STATUS_VALUES: ProjectStatusValue[] = ["prospect", "active", "on_hold", "completed", "cancelled"];

/** Renders the main project dashboard with list, financial map, and profile editor. */
export function ProjectsConsole() {
  const searchParams = useSearchParams();
  const projectStatusTransitions: Record<ProjectStatusValue, ProjectStatusValue[]> = {
    prospect: ["active", "cancelled"],
    active: ["on_hold", "completed", "cancelled"],
    on_hold: ["active", "completed", "cancelled"],
    completed: [],
    cancelled: [],
  };
  const defaultProjectStatusFilters: ProjectStatusValue[] = ["active", "prospect"];
  const { token, authMessage } = useSharedSessionAuth();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const { message: statusMessage, tone: statusMessageTone, setNeutral: setNeutralStatusMessage, setSuccess: setSuccessStatusMessage, setError: setErrorStatusMessage, setMessage: setStatusMessage } = useStatusMessage();
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilters, setProjectStatusFilters] = useState<ProjectStatusValue[]>(
    defaultProjectStatusFilters,
  );
  const [isProjectListExpanded, setIsProjectListExpanded] = useState(true);
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
  const [acceptedEstimateTotal, setAcceptedEstimateTotal] = useState("--");
  const [acceptedChangeOrderDeltaTotal, setAcceptedChangeOrderDeltaTotal] = useState("--");
  const [isProjectProfileOpen, setIsProjectProfileOpen] = useState(false);
  const projectProfileFormRef = useRef<HTMLFormElement | null>(null);

  const [projectName, setProjectName] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatusValue>("prospect");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

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
  const allowedNextProjectStatuses = selectedProject
    ? projectStatusTransitions[selectedProject.status as ProjectStatusValue] ?? []
    : [];
  const allowedProfileStatuses = selectedProject
    ? [...allowedNextProjectStatuses].filter((value, index, source) => source.indexOf(value) === index)
    : [];
  const hasInvalidDateRange = Boolean(startDate && endDate && endDate < startDate);
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
  const { pageItems: pagedProjects, currentPage: currentProjectPageSafe, totalPages: totalProjectPages, prevPage: prevProjectPage, nextPage: nextProjectPage, resetPage: resetProjectPage } = usePagination(statusFilteredProjects, 5);
  const summaryCounts = summary
    ? {
        invoices: summary.traceability.ar_invoices.records.length,
        arPayments: summary.traceability.ar_payments.records.length,
        vendorBills: summary.traceability.ap_vendor_bills.records.length,
        apPayments: summary.traceability.ap_payments.records.length,
      }
    : null;
  const contractOriginalDisplay =
    summary?.contract_value_original ?? selectedProject?.contract_value_original ?? "--";
  const acceptedContractDisplay =
    summary?.accepted_contract_total ?? selectedProject?.accepted_contract_total ?? acceptedEstimateTotal;
  const arOutstandingDisplay = summary?.ar_outstanding ?? "--";
  const unbilledFromAcceptedDisplay = summary
    ? formatCurrency(parseMoneyValue(acceptedContractDisplay) - parseMoneyValue(arOutstandingDisplay))
    : "--";
  const apOutstandingDisplay = summary?.ap_outstanding ?? "--";
  const apTotalDisplay = summary?.ap_total ?? "--";
  const apPaidDisplay = summary?.ap_paid ?? "--";
  const invoicedDisplay = summary?.invoiced_to_date ?? "--";
  const paidDisplay = summary?.paid_to_date ?? "--";
  const inboundCreditDisplay = summary?.inbound_unapplied_credit ?? "--";
  const outboundCreditDisplay = summary?.outbound_unapplied_credit ?? "--";
  const activeFinancialEstimateDisplay = summary
    ? summary.active_budget_source_estimate_id
      ? `Estimate #${summary.active_budget_source_estimate_id} v${summary.active_budget_source_estimate_version ?? "?"}`
      : "No active estimate"
    : "--";
  const activeFinancialBudgetDisplay = summary
    ? summary.active_budget_id
      ? `Budget #${summary.active_budget_id}`
      : "Approve an estimate to activate project financials."
    : "--";
  const unspentFromAcceptedDisplay = summary
    ? formatCurrency(parseMoneyValue(acceptedContractDisplay) - parseMoneyValue(apOutstandingDisplay))
    : "--";

  /** Coerces a string or number to a numeric dollar value, defaulting to 0 for unparseable input. */
  function parseMoneyValue(value: unknown): number {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value !== "string") {
      return 0;
    }
    const normalized = value.replace(/[^0-9.-]/g, "");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /** Returns the display name for a project's customer, falling back to "Customer #id". */
  function formatCustomerName(project: ProjectRecord): string {
    return project.customer_display_name || `Customer #${project.customer}`;
  }

  /** Maps a status value like "on_hold" to its corresponding CSS module class. */
  function projectStatusClass(statusValue: string): string {
    const key = `projectStatus${statusValue
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`;
    return styles[key] ?? "";
  }

  /** Converts a snake_case status value to a human-readable label. */
  function projectStatusLabel(statusValue: string): string {
    return statusValue.replace("_", " ");
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
    setStartDate(project.start_date_planned ?? "");
    setEndDate(project.end_date_planned ?? "");
  }

  /** Fetches all projects and auto-selects based on URL scope or default filters. */
  async function loadProjects() {
    setNeutralStatusMessage("Loading projects...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatusMessage("Could not load projects.");
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
            defaultProjectStatusFilters.includes(project.status as ProjectStatusValue),
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
        if (scopedProjectId && !scopedMatch) {
          setNeutralStatusMessage(
            `Project #${scopedProjectId} is not available in your scope. Loaded default project.`,
          );
          return;
        }
        if (scopedCustomerId) {
          setStatusMessage("");
          return;
        }
        setStatusMessage("");
      } else if (scopedCustomerId) {
        setSelectedProjectId("");
        setSummary(null);
        setEstimateStatusCounts(null);
        setChangeOrderStatusCounts(null);
        setNeutralStatusMessage(`No projects found for customer #${scopedCustomerId}.`);
      } else {
        setSelectedProjectId("");
        setSummary(null);
        setEstimateStatusCounts(null);
        setChangeOrderStatusCounts(null);
        setNeutralStatusMessage(
          "No projects found for this user. Create one from Intake -> Convert Lead to Project.",
        );
      }
    } catch {
      setErrorStatusMessage("Could not reach projects endpoint.");
    }
  }

  /** Fetches the financial summary (contract, AR, AP totals) for the selected project. */
  async function loadFinancialSummary() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setErrorStatusMessage("Select a project first.");
      return;
    }
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/financial-summary/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatusMessage("Could not load financial summary.");
        return;
      }

      setSummary(payload.data as ProjectFinancialSummary);
    } catch {
      setErrorStatusMessage("Could not reach financial summary endpoint.");
    }
  }

  /** Loads estimate counts by status for the scope-control badges. */
  async function loadEstimateStatusCounts(projectId: number) {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        headers: buildAuthHeaders(token),
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
        } else if (estimate.status === "approved" || estimate.status === "accepted") {
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
        headers: buildAuthHeaders(token),
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
      let acceptedDelta = 0;
      for (const changeOrder of rows) {
        if (changeOrder.status === "draft") {
          draft += 1;
        } else if (changeOrder.status === "pending_approval" || changeOrder.status === "sent") {
          sent += 1;
        } else if (changeOrder.status === "accepted" || changeOrder.status === "approved") {
          accepted += 1;
          acceptedDelta += parseMoneyValue(changeOrder.amount_delta);
        }
      }
      setChangeOrderStatusCounts({ draft, sent, accepted });
      setAcceptedChangeOrderDeltaTotal(formatCurrency(acceptedDelta));
    } catch {
      setChangeOrderStatusCounts(null);
      setAcceptedChangeOrderDeltaTotal("--");
    }
  }

  // Fetch the full project list whenever auth or URL scope changes.
  useEffect(() => {
    if (!token) {
      return;
    }
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, scopedProjectId, scopedCustomerId]);

  // Re-load financials and scope-control counts when a different project is selected.
  useEffect(() => {
    if (!token || !selectedProjectId) {
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      return;
    }
    void loadFinancialSummary();
    void loadEstimateStatusCounts(projectId);
    void loadChangeOrderStatusCounts(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, token]);

  // Reset to page 1 whenever the user changes search text or status filters.
  useEffect(() => {
    resetProjectPage();
  }, [projectSearch, projectStatusFilters, resetProjectPage]);

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
    setAcceptedEstimateTotal("--");
    setAcceptedChangeOrderDeltaTotal("--");
  }, [selectedProjectId, statusFilteredProjects]);

  // Scroll the profile form into view when it opens, so users don't miss it off-screen.
  useEffect(() => {
    if (!isProjectProfileOpen || isSelectedProjectTerminal) {
      return;
    }
    const formEl = projectProfileFormRef.current;
    if (!formEl) {
      return;
    }

    const rect = formEl.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const isFullyVisible = rect.top >= 0 && rect.bottom <= viewportHeight;
    if (!isFullyVisible) {
      formEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isProjectProfileOpen, isSelectedProjectTerminal, selectedProjectId]);

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
    setIsProjectProfileOpen(false);
    hydrateForm(selected);

    // Clear stale financial data so it re-loads for the new project.
    setSummary(null);
    setEstimateStatusCounts(null);
    setChangeOrderStatusCounts(null);
    setAcceptedEstimateTotal("--");
    setAcceptedChangeOrderDeltaTotal("--");
  }

  /** Toggles the project profile editor open/closed, pre-selecting the first allowed status. */
  function toggleProjectProfile() {
    setIsProjectProfileOpen((current) => {
      const nextOpen = !current;
      if (nextOpen && selectedProject) {
        const currentStatus = selectedProject.status as ProjectStatusValue;
        const nextStatuses = projectStatusTransitions[currentStatus] ?? [];
        setProjectStatus(nextStatuses[0] ?? currentStatus);
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
    if (hasInvalidDateRange) {
      setErrorStatusMessage("Planned end date cannot be before planned start date.");
      return;
    }

    // Validation passed -- submit the PATCH.
    setNeutralStatusMessage("Saving project profile...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          name: projectName,
          status: projectStatus,
          start_date_planned: startDate || null,
          end_date_planned: endDate || null,
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
      setIsProjectProfileOpen(false);
      setSuccessStatusMessage(`Project #${updated.id} saved.`);
    } catch {
      setErrorStatusMessage("Could not reach project detail endpoint.");
    }
  }

  return (
    <section>
      {authMessage.startsWith("No shared session") ? <p>{authMessage}</p> : null}

      {projects.length === 0 ? (
        <p>
          No projects yet. Create one from <code>/customers</code> or <code>/intake/quick-add</code>.
        </p>
      ) : null}

      {projects.length > 0 ? (
        <ProjectListViewer
          title="Choose a project below"
          isExpanded={isProjectListExpanded}
          onToggleExpanded={() => setIsProjectListExpanded((current) => !current)}
          expandedHint="Select a project to open its map, financial snapshot, and downstream actions."
          showSearchAndFilters
          searchValue={projectSearch}
          onSearchChange={setProjectSearch}
          statusValues={PROJECT_STATUS_VALUES}
          statusFilters={projectStatusFilters}
          statusCounts={projectStatusCounts}
          onToggleStatusFilter={toggleProjectStatusFilter}
          onShowAllStatuses={() =>
            setProjectStatusFilters(["active", "on_hold", "prospect", "completed", "cancelled"])
          }
          onResetStatuses={() => setProjectStatusFilters(defaultProjectStatusFilters)}
          pagedProjects={pagedProjects.map((project) => ({
            id: project.id,
            name: project.name,
            customer_display_name: formatCustomerName(project),
            status: project.status,
          }))}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
          statusLabel={projectStatusLabel}
          showPagination
          currentPage={currentProjectPageSafe}
          totalPages={totalProjectPages}
          onPrevPage={prevProjectPage}
          onNextPage={nextProjectPage}
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
                      aria-expanded={isProjectProfileOpen}
                      onClick={toggleProjectProfile}
                    >
                      {isProjectProfileOpen ? "Close Settings" : "Edit Project"}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className={styles.treeBranches}>
                <div className={styles.branch}>
                  <span className={styles.branchLabel}>Scope Control</span>
                  <div className={styles.node}>
                    <Link href={`/projects/${selectedProject.id}/estimates`}>Estimates</Link>
                    <span className={styles.nodeEstimateMeta}>
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
                  </div>
                  <div className={styles.node}>
                    <Link href={`/projects/${selectedProject.id}/change-orders`}>Change Orders</Link>
                    <span className={styles.nodeEstimateMeta}>
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
                  </div>
                  <div className={styles.node}>
                    <Link
                      href={`/projects/${selectedProject.id}/budgets/analytics`}
                      prefetch={false}
                    >
                      Budget Analytics
                    </Link>
                    <span className={styles.nodeCount}>Auto</span>
                  </div>
                  <div className={styles.node}>
                    <Link href={`/projects/${selectedProject.id}/activity`}>Activity Timeline</Link>
                  </div>
                </div>
                <div className={styles.branch}>
                  <span className={styles.branchLabel}>Billing</span>
                  <div className={styles.branchGroup}>
                    <span className={styles.branchSubLabel}>Receivables</span>
                    <div className={styles.node}>
                      <Link href="/invoices">Invoices</Link>
                      <span className={styles.nodeCount}>
                        {summaryCounts ? summaryCounts.invoices : "--"}
                      </span>
                    </div>
                    <div className={styles.node}>
                      <Link href={`/financials-auditing?project=${selectedProject.id}`}>
                        Payments In (AR)
                      </Link>
                      <span className={styles.nodeCount}>
                        {summaryCounts ? summaryCounts.arPayments : "--"}
                      </span>
                    </div>
                  </div>
                  <div className={styles.branchGroup}>
                    <span className={styles.branchSubLabel}>Payables</span>
                    <div className={styles.node}>
                      <Link href={`/bills?project=${selectedProject.id}`}>Bills</Link>
                      <span className={styles.nodeCount}>
                        {summaryCounts ? summaryCounts.vendorBills : "--"}
                      </span>
                    </div>
                    <div className={styles.node}>
                      <Link href={`/financials-auditing?project=${selectedProject.id}`}>
                        Payments Out (AP)
                      </Link>
                      <span className={styles.nodeCount}>
                        {summaryCounts ? summaryCounts.apPayments : "--"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.metricsPanel}>
              <div className={styles.baselineCard}>
                <span className={styles.baselineCardLabel}>Active Estimate</span>
                <strong className={styles.baselineCardValue}>{activeFinancialEstimateDisplay}</strong>
                <span className={styles.baselineCardMeta}>{activeFinancialBudgetDisplay}</span>
              </div>
              <section className={styles.metricSection}>
                <h4 className={styles.metricSectionTitle}>Estimates / Approvals</h4>
                <div className={styles.metricRow}>
                  <span>Eyeball / Initial Estimate</span>
                  <strong>{contractOriginalDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Accepted Contract Total</span>
                  <strong>{acceptedContractDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Accepted CO Delta</span>
                  <strong>{acceptedChangeOrderDeltaTotal}</strong>
                </div>
              </section>
              <section className={styles.metricSection}>
                <h4 className={styles.metricSectionTitle}>Income</h4>
                <div className={styles.metricRow}>
                  <span>Invoiced to date</span>
                  <strong>{invoicedDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Inbound payments to date</span>
                  <strong>{paidDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Inbound credit</span>
                  <strong>{inboundCreditDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>AR outstanding</span>
                  <strong>{arOutstandingDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Not Yet Billed</span>
                  <strong>{unbilledFromAcceptedDisplay}</strong>
                </div>
              </section>
              <section className={styles.metricSection}>
                <h4 className={styles.metricSectionTitle}>Expenses</h4>
                <div className={styles.metricRow}>
                  <span>Bills to date</span>
                  <strong>{apTotalDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Payments out to date</span>
                  <strong>{apPaidDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Outbound credit</span>
                  <strong>{outboundCreditDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>AP outstanding</span>
                  <strong>{apOutstandingDisplay}</strong>
                </div>
                <div className={styles.metricRow}>
                  <span>Not Yet Expensed</span>
                  <strong>{unspentFromAcceptedDisplay}</strong>
                </div>
              </section>
            </div>
          </div>
        </section>
      ) : null}

      {selectedProject && isProjectProfileOpen && !isSelectedProjectTerminal ? (
        <form ref={projectProfileFormRef} className={styles.projectProfileForm} onSubmit={handleSaveProject}>
          <h3>Project Details</h3>
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
              {allowedProfileStatuses.map((statusOption) => {
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
          <label>
            Planned start date
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label>
            Planned end date
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          {hasInvalidDateRange ? (
            <p className={styles.projectProfileError}>
              Planned end date cannot be before planned start date.
            </p>
          ) : null}
          <button
            type="submit"
            className={styles.projectProfileSubmit}
            disabled={!hasSelectedProject || hasInvalidDateRange}
          >
            Save Project Profile
          </button>
        </form>
      ) : null}

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
    </section>
  );
}
