"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { loadClientSession } from "../../session/client-session";
import styles from "./projects-console.module.css";
import {
  AccountingSyncEventRecord,
  ApiResponse,
  FinancialAuditEventRecord,
  ProjectFinancialSummary,
  ProjectRecord,
} from "../types";

type ProjectStatusValue = "prospect" | "active" | "on_hold" | "completed" | "cancelled";

export function ProjectsConsole() {
  const projectPageSize = 5;
  const projectStatusTransitions: Record<ProjectStatusValue, ProjectStatusValue[]> = {
    prospect: ["active", "cancelled"],
    active: ["on_hold", "completed", "cancelled"],
    on_hold: ["active", "completed", "cancelled"],
    completed: [],
    cancelled: [],
  };
  const defaultProjectStatusFilters: ProjectStatusValue[] = ["active", "prospect"];
  const [token, setToken] = useState("");
  const [authMessage, setAuthMessage] = useState("Checking session...");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilters, setProjectStatusFilters] = useState<ProjectStatusValue[]>(
    defaultProjectStatusFilters,
  );
  const [currentProjectPage, setCurrentProjectPage] = useState(1);
  const [summary, setSummary] = useState<ProjectFinancialSummary | null>(null);
  const [estimateStatusCounts, setEstimateStatusCounts] = useState<{
    draft: number;
    sent: number;
    approved: number;
  } | null>(null);
  const [auditEvents, setAuditEvents] = useState<FinancialAuditEventRecord[]>([]);
  const [syncEvents, setSyncEvents] = useState<AccountingSyncEventRecord[]>([]);
  const [syncProvider, setSyncProvider] = useState<"quickbooks_online">("quickbooks_online");
  const [syncObjectType, setSyncObjectType] = useState("invoice");
  const [syncObjectId, setSyncObjectId] = useState("");
  const [syncDirection, setSyncDirection] = useState<"push" | "pull">("push");
  const [syncStatus, setSyncStatus] = useState<"queued" | "success" | "failed">("queued");
  const [syncErrorMessage, setSyncErrorMessage] = useState("");
  const [retryTargetId, setRetryTargetId] = useState("");
  const [isProjectProfileOpen, setIsProjectProfileOpen] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatusValue>("prospect");
  const [contractCurrent, setContractCurrent] = useState("0.00");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const hasSelectedProject = Boolean(selectedProjectId);
  const selectedProject =
    projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const isSelectedProjectTerminal =
    selectedProject?.status === "completed" || selectedProject?.status === "cancelled";
  const allowedNextProjectStatuses = selectedProject
    ? projectStatusTransitions[selectedProject.status as ProjectStatusValue] ?? []
    : [];
  const needle = projectSearch.trim().toLowerCase();
  const filteredProjects = !needle
    ? projects
    : projects.filter((project) => {
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
  const statusFilteredProjects = filteredProjects.filter((project) =>
    projectStatusFilters.includes(project.status as ProjectStatusValue),
  );
  const totalProjectPages = Math.max(1, Math.ceil(statusFilteredProjects.length / projectPageSize));
  const currentProjectPageSafe = Math.min(currentProjectPage, totalProjectPages);
  const projectPageStartIndex = (currentProjectPageSafe - 1) * projectPageSize;
  const pagedProjects = statusFilteredProjects.slice(
    projectPageStartIndex,
    projectPageStartIndex + projectPageSize,
  );
  const summaryCounts = summary
    ? {
        changeOrders: summary.traceability.approved_change_orders.records.length,
        invoices: summary.traceability.ar_invoices.records.length,
        arPayments: summary.traceability.ar_payments.records.length,
        vendorBills: summary.traceability.ap_vendor_bills.records.length,
        apPayments: summary.traceability.ap_payments.records.length,
      }
    : null;
  const contractOriginalDisplay =
    summary?.contract_value_original ?? selectedProject?.contract_value_original ?? "--";
  const contractCurrentDisplay =
    summary?.contract_value_current ?? selectedProject?.contract_value_current ?? "--";
  const arOutstandingDisplay = summary?.ar_outstanding ?? "--";
  const apOutstandingDisplay = summary?.ap_outstanding ?? "--";
  const invoicedDisplay = summary?.invoiced_to_date ?? "--";
  const paidDisplay = summary?.paid_to_date ?? "--";
  const inboundCreditDisplay = summary?.inbound_unapplied_credit ?? "--";
  const outboundCreditDisplay = summary?.outbound_unapplied_credit ?? "--";

  function formatCustomerName(project: ProjectRecord): string {
    return project.customer_display_name || `Customer #${project.customer}`;
  }

  function projectStatusClass(statusValue: string): string {
    const key = `projectStatus${statusValue
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`;
    return styles[key] ?? "";
  }

  function projectStatusLabel(statusValue: string): string {
    return statusValue.replace("_", " ");
  }

  function toggleProjectStatusFilter(nextStatus: ProjectStatusValue) {
    setProjectStatusFilters((current) =>
      current.includes(nextStatus)
        ? current.filter((statusValue) => statusValue !== nextStatus)
        : [...current, nextStatus],
    );
  }

  function hydrateForm(project: ProjectRecord) {
    setProjectName(project.name);
    setProjectStatus(project.status as ProjectStatusValue);
    setContractCurrent(project.contract_value_current);
    setStartDate(project.start_date_planned ?? "");
    setEndDate(project.end_date_planned ?? "");
  }

  async function loadProjects() {
    setStatusMessage("Loading projects...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Could not load projects.");
        return;
      }
      const items = (payload.data as ProjectRecord[]) ?? [];
      setProjects(items);
      if (items[0]) {
        const preferredProject =
          items.find((project) => project.status === "active")
          ?? items.find((project) => project.status === "prospect")
          ?? items[0];
        setSelectedProjectId(String(preferredProject.id));
        hydrateForm(preferredProject);
        setSummary(null);
        setAuditEvents([]);
        setStatusMessage(`Loaded ${items.length} project(s).`);
      } else {
        setSelectedProjectId("");
        setSummary(null);
        setAuditEvents([]);
        setStatusMessage(
          "No projects found for this user. Create one from Intake -> Convert Lead to Project.",
        );
      }
    } catch {
      setStatusMessage("Could not reach projects endpoint.");
    }
  }

  async function loadFinancialSummary() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading financial summary...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/financial-summary/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Could not load financial summary.");
        setEstimateStatusCounts(null);
        return;
      }

      setSummary(payload.data as ProjectFinancialSummary);
      try {
        const estimatesResponse = await fetch(
          `${normalizedBaseUrl}/projects/${projectId}/estimates/`,
          {
            headers: { Authorization: `Token ${token}` },
          },
        );
        const estimatesPayload: ApiResponse = await estimatesResponse.json();
        if (!estimatesResponse.ok) {
          setEstimateStatusCounts(null);
        } else {
          const rows = (estimatesPayload.data as Array<{ status?: string }>) ?? [];
          let draft = 0;
          let sent = 0;
          let approved = 0;
          for (const estimate of rows) {
            if (estimate.status === "draft") {
              draft += 1;
            } else if (estimate.status === "sent") {
              sent += 1;
            } else if (estimate.status === "approved") {
              approved += 1;
            }
          }
          setEstimateStatusCounts({ draft, sent, approved });
        }
      } catch {
        setEstimateStatusCounts(null);
      }
      setStatusMessage("Financial summary loaded.");
    } catch {
      setStatusMessage("Could not reach financial summary endpoint.");
      setEstimateStatusCounts(null);
    }
  }

  useEffect(() => {
    const session = loadClientSession();
    if (!session?.token) {
      setToken("");
      setAuthMessage("No shared session found. Go to / and login first.");
      return;
    }
    setToken(session.token);
    setAuthMessage(`Using shared session for ${session.email || "user"}.`);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!token || !selectedProjectId) {
      return;
    }
    void loadFinancialSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, token]);

  useEffect(() => {
    setCurrentProjectPage(1);
  }, [projectSearch, projectStatusFilters]);

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
    setAuditEvents([]);
  }, [selectedProjectId, statusFilteredProjects]);

  function handleSelectProject(project: ProjectRecord) {
    setSelectedProjectId(String(project.id));
    setIsProjectProfileOpen(false);
    setSummary(null);
    setEstimateStatusCounts(null);
    setAuditEvents([]);
    hydrateForm(project);
  }

  async function handleSaveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage(
        "No project selected. Load projects first, then pick one from the project dropdown.",
      );
      return;
    }

    setStatusMessage("Saving project profile...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          name: projectName,
          status: projectStatus,
          contract_value_current: contractCurrent,
          start_date_planned: startDate || null,
          end_date_planned: endDate || null,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Save failed. Check values and auth token.");
        return;
      }

      const updated = payload.data as ProjectRecord;
      setProjects((current) =>
        current.map((project) => (project.id === updated.id ? updated : project)),
      );
      setStatusMessage(`Project #${updated.id} saved.`);
    } catch {
      setStatusMessage("Could not reach project detail endpoint.");
    }
  }

  async function downloadAccountingExport() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Downloading accounting export...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/accounting-export/?export_format=csv`,
        {
          headers: { Authorization: `Token ${token}` },
        },
      );
      if (!response.ok) {
        setStatusMessage("Could not download accounting export.");
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `project-${projectId}-accounting-export.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      setStatusMessage("Accounting export downloaded.");
    } catch {
      setStatusMessage("Could not reach accounting export endpoint.");
    }
  }

  async function loadAccountingSyncEvents() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading accounting sync events...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/accounting-sync-events/`,
        {
          headers: { Authorization: `Token ${token}` },
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load sync events.");
        return;
      }
      const rows = (payload.data as AccountingSyncEventRecord[]) ?? [];
      setSyncEvents(rows);
      const failed = rows.find((row) => row.status === "failed");
      setRetryTargetId(failed ? String(failed.id) : "");
      setStatusMessage(`Loaded ${rows.length} sync event(s).`);
    } catch {
      setStatusMessage("Could not reach accounting sync events endpoint.");
    }
  }

  async function loadAuditEvents() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading audit events...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/audit-events/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load audit events.");
        return;
      }
      const rows = (payload.data as FinancialAuditEventRecord[]) ?? [];
      setAuditEvents(rows);
      setStatusMessage(`Loaded ${rows.length} audit event(s).`);
    } catch {
      setStatusMessage("Could not reach project audit events endpoint.");
    }
  }

  async function createAccountingSyncEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Creating accounting sync event...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/accounting-sync-events/`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${token}`,
          },
          body: JSON.stringify({
            provider: syncProvider,
            object_type: syncObjectType,
            object_id: syncObjectId ? Number(syncObjectId) : null,
            direction: syncDirection,
            status: syncStatus,
            error_message: syncErrorMessage,
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not create sync event.");
        return;
      }
      const created = payload.data as AccountingSyncEventRecord;
      setSyncEvents((current) => [created, ...current]);
      if (created.status === "failed") {
        setRetryTargetId(String(created.id));
      }
      setSyncErrorMessage("");
      setStatusMessage(`Created sync event #${created.id}.`);
    } catch {
      setStatusMessage("Could not reach sync event create endpoint.");
    }
  }

  async function retryAccountingSyncEvent() {
    const syncEventId = Number(retryTargetId);
    if (!syncEventId) {
      setStatusMessage("Select a failed sync event to retry.");
      return;
    }

    setStatusMessage("Retrying sync event...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/accounting-sync-events/${syncEventId}/retry/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not retry sync event.");
        return;
      }
      const updated = payload.data as AccountingSyncEventRecord;
      setSyncEvents((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setStatusMessage(`Retry result: ${payload.meta?.retry_status ?? "ok"}.`);
    } catch {
      setStatusMessage("Could not reach sync event retry endpoint.");
    }
  }

  return (
    <section>
      <h2>Project Profile Editor</h2>
      <p>Load project shells and update baseline profile fields.</p>

      <p>{authMessage}</p>

      {projects.length === 0 ? (
        <p>
          No projects yet. Go to <code>/intake/quick-add</code>, create a lead, and convert it to
          a project shell.
        </p>
      ) : null}

      {projects.length > 0 ? (
        <section>
          <h3>Project List</h3>
          <p>Quick scan of loaded project shells.</p>
          <label className={styles.searchField}>
            Search projects
            <input
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              placeholder="ID, name, customer, or status"
            />
          </label>
          <div className={styles.projectFilters}>
            <span className={styles.projectFiltersLabel}>Project status filter</span>
            <div className={styles.projectFilterButtons}>
              {(["prospect", "active", "on_hold", "cancelled", "completed"] as ProjectStatusValue[]).map(
                (statusValue) => {
                  const active = projectStatusFilters.includes(statusValue);
                  return (
                    <button
                      key={statusValue}
                      type="button"
                      className={`${styles.projectFilterButton} ${
                        active ? projectStatusClass(statusValue) : styles.projectFilterButtonInactive
                      } ${active ? styles.projectFilterButtonActive : ""}`}
                      aria-pressed={active}
                      onClick={() => toggleProjectStatusFilter(statusValue)}
                    >
                      {projectStatusLabel(statusValue)}
                    </button>
                  );
                },
              )}
            </div>
            <div className={styles.projectFilterActions}>
              <button
                type="button"
                className={styles.projectFilterActionButton}
                onClick={() =>
                  setProjectStatusFilters(["active", "on_hold", "prospect", "completed", "cancelled"])
                }
              >
                Show All Projects
              </button>
              <button
                type="button"
                className={styles.projectFilterActionButton}
                onClick={() => setProjectStatusFilters(defaultProjectStatusFilters)}
              >
                Reset Filters
              </button>
            </div>
          </div>
          <div className={styles.projectTableWrap}>
            <table className={styles.projectTable}>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Workflow</th>
                  <th>Contract (Current)</th>
                  <th>Start</th>
                  <th>End</th>
                </tr>
              </thead>
              <tbody>
                {pagedProjects.map((project) => {
                  const isActive = String(project.id) === selectedProjectId;
                  const startLabel = project.start_date_planned ?? "TBD";
                  const endLabel = project.end_date_planned ?? "TBD";
                  return (
                    <tr
                      key={project.id}
                      className={`${styles.projectRow} ${isActive ? styles.projectRowActive : ""}`}
                      onClick={() => handleSelectProject(project)}
                    >
                      <td>
                        <div className={styles.projectCellTitle}>
                          <strong>
                            #{project.id} {project.name}
                          </strong>
                        </div>
                      </td>
                      <td>{formatCustomerName(project)}</td>
                      <td>
                        <span className={`${styles.projectStatus} ${projectStatusClass(project.status)}`}>
                          {project.status}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/estimates?project=${project.id}`}
                          className={styles.projectActionLink}
                        >
                          Open Estimates
                        </Link>
                      </td>
                      <td>{project.contract_value_current}</td>
                      <td>{startLabel}</td>
                      <td>{endLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className={styles.projectPagination}>
              <button
                type="button"
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
                onClick={() => setCurrentProjectPage((page) => Math.min(totalProjectPages, page + 1))}
                disabled={currentProjectPageSafe >= totalProjectPages}
              >
                Next
              </button>
            </div>
          </div>
          {statusFilteredProjects.length === 0 ? (
            <p className={styles.searchEmpty}>No projects match your search/filter.</p>
          ) : null}
        </section>
      ) : null}

      {selectedProject ? (
        <p>
          Active project: #{selectedProject.id} {selectedProject.name}
        </p>
      ) : null}

      {selectedProject ? (
        <section className={styles.overview}>
          <div className={styles.overviewHeader}>
            <div>
              <h3>Project Map</h3>
              <p>Downstream workflow map with quick financial context.</p>
            </div>
            <div className={styles.overviewActions}>
              <button type="button" onClick={loadFinancialSummary}>
                {summary ? "Refresh Summary" : "Load Summary"}
              </button>
              <button type="button" onClick={downloadAccountingExport}>
                Download Accounting Export
              </button>
            </div>
          </div>
          <div className={styles.overviewGrid}>
            <div className={styles.treePanel}>
              <div className={styles.treeRoot}>
                <span className={styles.rootLabel}>Project</span>
                <div className={styles.rootTitleRow}>
                  <span className={styles.rootTitle}>{selectedProject.name}</span>
                  {!isSelectedProjectTerminal ? (
                    <button
                      type="button"
                      className={styles.projectSettingsToggle}
                      aria-expanded={isProjectProfileOpen}
                      onClick={() => setIsProjectProfileOpen((current) => !current)}
                    >
                      {isProjectProfileOpen ? "Close Settings" : "Edit Project"}
                    </button>
                  ) : null}
                </div>
                <span className={styles.rootMeta}>
                  {formatCustomerName(selectedProject)} • {projectStatusLabel(selectedProject.status)}
                </span>
              </div>
              <div className={styles.treeBranches}>
                <div className={styles.branch}>
                  <span className={styles.branchLabel}>Scope</span>
                  <div className={styles.node}>
                    <Link href={`/estimates?project=${selectedProject.id}`}>Estimates</Link>
                    <span className={styles.nodeEstimateMeta}>
                      <span className={`${styles.estimateCountPill} ${styles.estimateCountDraft}`}>
                        D {estimateStatusCounts ? estimateStatusCounts.draft : "--"}
                      </span>
                      <span className={`${styles.estimateCountPill} ${styles.estimateCountSent}`}>
                        S {estimateStatusCounts ? estimateStatusCounts.sent : "--"}
                      </span>
                      <span className={`${styles.estimateCountPill} ${styles.estimateCountApproved}`}>
                        A {estimateStatusCounts ? estimateStatusCounts.approved : "--"}
                      </span>
                    </span>
                  </div>
                  <div className={styles.node}>
                    <Link href={`/budgets?project=${selectedProject.id}`}>Budgets</Link>
                  </div>
                  <div className={styles.node}>
                    <Link href="/change-orders">Change Orders</Link>
                    <span className={styles.nodeCount}>
                      {summaryCounts ? summaryCounts.changeOrders : "--"}
                    </span>
                  </div>
                </div>
                <div className={styles.branch}>
                  <span className={styles.branchLabel}>Receivables</span>
                  <div className={styles.node}>
                    <Link href="/invoices">Invoices</Link>
                    <span className={styles.nodeCount}>
                      {summaryCounts ? summaryCounts.invoices : "--"}
                    </span>
                  </div>
                  <div className={styles.node}>
                    <Link href="/payments">Payments (AR)</Link>
                    <span className={styles.nodeCount}>
                      {summaryCounts ? summaryCounts.arPayments : "--"}
                    </span>
                  </div>
                </div>
                <div className={styles.branch}>
                  <span className={styles.branchLabel}>Payables</span>
                  <div className={styles.node}>
                    <Link href={`/vendor-bills?project=${selectedProject.id}`}>Vendor Bills</Link>
                    <span className={styles.nodeCount}>
                      {summaryCounts ? summaryCounts.vendorBills : "--"}
                    </span>
                  </div>
                  <div className={styles.node}>
                    <Link href={`/expenses?project=${selectedProject.id}`}>Expenses</Link>
                  </div>
                  <div className={styles.node}>
                    <Link href="/payments">Payments (AP)</Link>
                    <span className={styles.nodeCount}>
                      {summaryCounts ? summaryCounts.apPayments : "--"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.metricsPanel}>
              <div className={styles.metricRow}>
                <span>Contract original</span>
                <strong>{contractOriginalDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Contract current</span>
                <strong>{contractCurrentDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Invoiced to date</span>
                <strong>{invoicedDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Paid to date</span>
                <strong>{paidDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>AR outstanding</span>
                <strong>{arOutstandingDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>AP outstanding</span>
                <strong>{apOutstandingDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Inbound credit</span>
                <strong>{inboundCreditDisplay}</strong>
              </div>
              <div className={styles.metricRow}>
                <span>Outbound credit</span>
                <strong>{outboundCreditDisplay}</strong>
              </div>
              <p className={styles.metricHint}>
                {summary
                  ? "Summary auto-refreshed on project selection."
                  : "Load summary to populate totals."}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {selectedProject && isProjectProfileOpen && !isSelectedProjectTerminal ? (
        <form className={styles.projectProfileForm} onSubmit={handleSaveProject}>
          <h3>Project Details</h3>
          <label>
            Project name
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} required />
          </label>
          <label>
            Status
            <select value={projectStatus} onChange={(event) => setProjectStatus(event.target.value as ProjectStatusValue)}>
              {[selectedProject.status as ProjectStatusValue, ...allowedNextProjectStatuses]
                .filter((value, index, source) => source.indexOf(value) === index)
                .map((statusOption) => (
                  <option key={statusOption} value={statusOption}>
                    {projectStatusLabel(statusOption)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Contract value (current)
            <input
              value={contractCurrent}
              onChange={(event) => setContractCurrent(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Planned start date
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label>
            Planned end date
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <button type="submit" disabled={!hasSelectedProject}>
            Save Project Profile
          </button>
        </form>
      ) : null}

      <section>
        <h3>Financial Summary (FIN-01)</h3>
        <p>One-screen view for contract, AR, and AP totals on this project.</p>
        <button type="button" onClick={loadFinancialSummary} disabled={!hasSelectedProject}>
          Load Financial Summary
        </button>
        <button type="button" onClick={downloadAccountingExport} disabled={!hasSelectedProject}>
          Download Accounting Export (CSV)
        </button>

        {summary ? (
          <div>
            <p>
              Contract: original {summary.contract_value_original} | current{" "}
              {summary.contract_value_current}
            </p>
            <p>Approved CO total: {summary.approved_change_orders_total}</p>
            <p>
              AR: invoiced {summary.invoiced_to_date} | paid {summary.paid_to_date} | outstanding{" "}
              {summary.ar_outstanding}
            </p>
            <p>
              AP: total {summary.ap_total} | paid {summary.ap_paid} | outstanding{" "}
              {summary.ap_outstanding}
            </p>
            <p>
              Unapplied credit: inbound {summary.inbound_unapplied_credit} | outbound{" "}
              {summary.outbound_unapplied_credit}
            </p>
            <h4>Traceability Links (FIN-02)</h4>
            <p>
              <Link href={summary.traceability.approved_change_orders.ui_route}>
                Change orders
              </Link>{" "}
              | <Link href={summary.traceability.ar_invoices.ui_route}>Invoices</Link> |{" "}
              <Link href={summary.traceability.ar_payments.ui_route}>Payments (AR)</Link> |{" "}
              <Link href={summary.traceability.ap_vendor_bills.ui_route}>Vendor bills</Link> |{" "}
              <Link href={summary.traceability.ap_payments.ui_route}>Payments (AP)</Link>
            </p>
            <label>
              AR invoice sources
              <textarea
                readOnly
                rows={Math.min(6, summary.traceability.ar_invoices.records.length + 1)}
                value={summary.traceability.ar_invoices.records
                  .map(
                    (row) =>
                      `${row.label} (${row.status}) amount ${row.amount} | ${row.detail_endpoint}`,
                  )
                  .join("\n")}
              />
            </label>
            <label>
              AR payment allocation sources
              <textarea
                readOnly
                rows={Math.min(6, summary.traceability.ar_payments.records.length + 1)}
                value={summary.traceability.ar_payments.records
                  .map(
                    (row) =>
                      `${row.label} (${row.status}) amount ${row.amount} | ${row.detail_endpoint}`,
                  )
                  .join("\n")}
              />
            </label>
            <label>
              AP vendor bill sources
              <textarea
                readOnly
                rows={Math.min(6, summary.traceability.ap_vendor_bills.records.length + 1)}
                value={summary.traceability.ap_vendor_bills.records
                  .map(
                    (row) =>
                      `${row.label} (${row.status}) amount ${row.amount} | ${row.detail_endpoint}`,
                  )
                  .join("\n")}
              />
            </label>
            <label>
              AP payment allocation sources
              <textarea
                readOnly
                rows={Math.min(6, summary.traceability.ap_payments.records.length + 1)}
                value={summary.traceability.ap_payments.records
                  .map(
                    (row) =>
                      `${row.label} (${row.status}) amount ${row.amount} | ${row.detail_endpoint}`,
                  )
                  .join("\n")}
              />
            </label>
          </div>
        ) : null}
      </section>

      <section>
        <h3>Financial Audit Trail (QA-01)</h3>
        <p>Immutable event log for money-impacting transitions.</p>
        <button type="button" onClick={loadAuditEvents} disabled={!hasSelectedProject}>
          Load Audit Events
        </button>
        {auditEvents.length > 0 ? (
          <label>
            Audit event log
            <textarea
              readOnly
              rows={Math.min(10, auditEvents.length + 1)}
              value={auditEvents
                .map((item) => {
                  const amount = item.amount ? ` amount=${item.amount}` : "";
                  const transition =
                    item.from_status || item.to_status
                      ? ` ${item.from_status || "-"} -> ${item.to_status || "-"}`
                      : "";
                  return `#${item.id} ${item.event_type} ${item.object_type}:${item.object_id}${transition}${amount} at ${item.created_at}`;
                })
                .join("\n")}
            />
          </label>
        ) : null}
      </section>

      <section>
        <h3>Accounting Sync Events (ACC-02)</h3>
        <p>Track sync status and safely retry failed events.</p>
        <button type="button" onClick={loadAccountingSyncEvents} disabled={!hasSelectedProject}>
          Load Sync Events
        </button>

        <form onSubmit={createAccountingSyncEvent}>
          <label>
            Provider
            <select value={syncProvider} onChange={() => setSyncProvider("quickbooks_online")}>
              <option value="quickbooks_online">quickbooks_online</option>
            </select>
          </label>
          <label>
            Object type
            <input
              value={syncObjectType}
              onChange={(event) => setSyncObjectType(event.target.value)}
              required
            />
          </label>
          <label>
            Object id
            <input value={syncObjectId} onChange={(event) => setSyncObjectId(event.target.value)} />
          </label>
          <label>
            Direction
            <select
              value={syncDirection}
              onChange={(event) => setSyncDirection(event.target.value as "push" | "pull")}
            >
              <option value="push">push</option>
              <option value="pull">pull</option>
            </select>
          </label>
          <label>
            Status
            <select
              value={syncStatus}
              onChange={(event) =>
                setSyncStatus(event.target.value as "queued" | "success" | "failed")
              }
            >
              <option value="queued">queued</option>
              <option value="success">success</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label>
            Error message
            <input
              value={syncErrorMessage}
              onChange={(event) => setSyncErrorMessage(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!hasSelectedProject}>
            Create Sync Event
          </button>
        </form>

        {syncEvents.length > 0 ? (
          <label>
            Failed event to retry
            <select value={retryTargetId} onChange={(event) => setRetryTargetId(event.target.value)}>
              <option value="">Select failed event</option>
              {syncEvents
                .filter((item) => item.status === "failed" || item.status === "queued")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.id} {item.object_type} ({item.status}) retries:{item.retry_count}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <button type="button" onClick={retryAccountingSyncEvent} disabled={!retryTargetId}>
          Retry Selected Sync Event
        </button>

        {syncEvents.length > 0 ? (
          <label>
            Sync event log
            <textarea
              readOnly
              rows={Math.min(8, syncEvents.length + 1)}
              value={syncEvents
                .map(
                  (item) =>
                    `#${item.id} ${item.provider} ${item.object_type}:${item.object_id ?? "-"} ${item.direction} ${item.status} retries=${item.retry_count} error="${item.error_message}"`,
                )
                .join("\n")}
            />
          </label>
        ) : null}
      </section>

      <p>{statusMessage}</p>
    </section>
  );
}
