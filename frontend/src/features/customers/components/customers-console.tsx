"use client";

/**
 * Top-level customer management page. Lists all customers with search/filter controls,
 * provides modal-based editing of customer details, and supports inline project creation
 * that routes the user into the new project workspace.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { canDo } from "@/shared/session/rbac";
import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { ProjectRecord } from "@/features/projects/types";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { ApiResponse, CustomerRow } from "../types";
import { CustomerEditorForm } from "./customer-editor-form";
import { CustomersFilters } from "./customers-filters";
import { CustomersList } from "./customers-list";
import { CustomerProjectCreateForm } from "./customer-project-create-form";
import { QuickAddConsole } from "./quick-add-console";
import { collapseToggleButtonStyles as collapseButtonStyles } from "@/shared/project-list-viewer";
import styles from "./customers-console.module.css";

type ActivityFilter = "all" | "active";
type ProjectFilter = "all" | "with_project";
type ProjectStatusValue = "prospect" | "active";

type ProjectCreateApiResponse = {
  data?: {
    project?: ProjectRecord;
  };
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
  };
};

/** Root console component for customer CRUD, filtering, and project creation. */
export function CustomersConsole() {
  const { token, capabilities } = useSharedSessionAuth();
  const canMutateCustomers = canDo(capabilities, "customers", "create");
  const canMutateProjects = canDo(capabilities, "projects", "create");
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isQuickAddExpanded, setIsQuickAddExpanded] = useState(true);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [projectsByCustomer, setProjectsByCustomer] = useState<Record<number, ProjectRecord[]>>({});
  const [editingId, setEditingId] = useState("");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [createProjectCustomerId, setCreateProjectCustomerId] = useState<number | null>(null);
  const [isProjectCreatorOpen, setIsProjectCreatorOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const backdropPointerStartRef = useRef(false);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("active");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [email, setEmail] = useState("");
  const [isArchived, setIsArchived] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectSiteAddress, setProjectSiteAddress] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatusValue>("prospect");

  const normalizedBaseUrl = useMemo(() => normalizeApiBaseUrl(defaultApiBaseUrl), []);
  const scopedCustomerIdParam = searchParams.get("customer");
  const scopedCustomerId =
    scopedCustomerIdParam && /^\d+$/.test(scopedCustomerIdParam) ? Number(scopedCustomerIdParam) : null;

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const inactive = Boolean(row.is_archived);
      const hasProject = row.has_project ?? (row.project_count ?? 0) > 0;

      const activityMatch =
        activityFilter === "all" || (activityFilter === "active" && !inactive);

      const projectMatch =
        projectFilter === "all" || (projectFilter === "with_project" && hasProject);

      return activityMatch && projectMatch;
    });
  }, [activityFilter, projectFilter, rows]);
  const editingCustomer = rows.find((entry) => String(entry.id) === editingId) ?? null;
  const createProjectCustomer =
    createProjectCustomerId === null
      ? null
      : rows.find((entry) => entry.id === createProjectCustomerId) ?? null;

  /** Populate editor form fields from a customer record. */
  function hydrate(customer: CustomerRow) {
    setDisplayName(customer.display_name ?? "");
    setPhone(customer.phone ?? "");
    setBillingAddress(customer.billing_address ?? "");
    setEmail(customer.email ?? "");
    setIsArchived(Boolean(customer.is_archived));
  }

  /** Fetch the customer list from the API, optionally filtered by search text. */
  async function loadCustomers(searchQuery: string, requestedPage: number) {
    setStatusMessage("");
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }
      params.set("page", String(requestedPage));
      params.set("page_size", "25");
      const url = `${normalizedBaseUrl}/customers/?${params.toString()}`;
      const response = await fetch(url, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse & { meta?: { page?: number; total_pages?: number; total_count?: number } } =
        await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load customers.");
        return;
      }

      const items = (payload.data as CustomerRow[]) ?? [];
      setRows(items);
      setTotalPages(payload.meta?.total_pages ?? 1);
      setTotalCount(payload.meta?.total_count ?? items.length);
      setPage(payload.meta?.page ?? requestedPage);
      const scopedId = scopedCustomerId;
      const scopedCustomer = scopedId ? items.find((entry) => entry.id === scopedId) : null;
      if (scopedCustomer) {
        setEditingId(String(scopedCustomer.id));
        hydrate(scopedCustomer);
      }
      setStatusMessage("");
    } catch {
      setStatusMessage("Could not reach customers endpoint.");
    }
  }

  /** Load all projects and group them by customer for the expandable project accordion. */
  async function loadProjectsIndex() {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: { data?: ProjectRecord[] } = await response.json();
      if (!response.ok) {
        return;
      }

      const rows = payload.data ?? [];
      const nextMap: Record<number, ProjectRecord[]> = {};
      for (const project of rows) {
        if (!nextMap[project.customer]) {
          nextMap[project.customer] = [];
        }
        nextMap[project.customer].push(project);
      }
      for (const key of Object.keys(nextMap)) {
        nextMap[Number(key)].sort((a, b) => b.id - a.id);
      }
      setProjectsByCustomer(nextMap);
    } catch {
      // best-effort for lookup UX; primary page still works without this index
    }
  }

  // Debounce customer search so the API isn't hit on every keystroke
  useEffect(() => {
    if (!token) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadCustomers(query, page);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, query, page, normalizedBaseUrl, scopedCustomerId, refreshKey]);

  // Fetch project index for the per-customer project accordion (re-runs on refreshKey so newly created projects appear)
  useEffect(() => {
    if (!token) {
      return;
    }
    void loadProjectsIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, normalizedBaseUrl, refreshKey]);

  /** Open the edit modal for a customer, closing the project creator if open. */
  function openEditor(id: string) {
    const row = rows.find((entry) => String(entry.id) === id);
    if (!row) {
      return;
    }
    setIsProjectCreatorOpen(false);
    setEditingId(id);
    hydrate(row);
    setIsEditorOpen(true);
  }

  function closeEditor() {
    setIsEditorOpen(false);
  }

  /** Open the project creation modal, pre-filling name and address from the customer. */
  function openProjectCreator(customer: CustomerRow) {
    setIsEditorOpen(false);
    setCreateProjectCustomerId(customer.id);
    setProjectName(`${customer.display_name} Project`);
    setProjectSiteAddress(customer.billing_address ?? "");
    setProjectStatus("prospect");
    setIsProjectCreatorOpen(true);
  }

  function closeProjectCreator() {
    setIsProjectCreatorOpen(false);
  }

  /** Track where a click started so we only close the modal on full backdrop clicks. */
  function handleOverlayMouseDown(event: MouseEvent<HTMLDivElement>) {
    backdropPointerStartRef.current = event.target === event.currentTarget;
  }

  /** Complete the backdrop-click check and close the editor if both events hit the overlay. */
  function handleOverlayMouseUp(event: MouseEvent<HTMLDivElement>) {
    const endedOnBackdrop = event.target === event.currentTarget;
    if (backdropPointerStartRef.current && endedOnBackdrop) {
      closeEditor();
    }
    backdropPointerStartRef.current = false;
  }

  /** PATCH the customer record, update the local list, and close the editor on success. */
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateCustomers) {
      setStatusMessage("Your role is read-only for customer mutations.");
      return;
    }
    const customerId = Number(editingId);
    if (!customerId) {
      setStatusMessage("Select a customer first.");
      return;
    }
    if (!displayName.trim()) {
      setStatusMessage("Display name is required.");
      return;
    }

    setStatusMessage("");

    try {
      const response = await fetch(`${normalizedBaseUrl}/customers/${customerId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          display_name: displayName,
          phone,
          billing_address: billingAddress,
          email,
          is_archived: isArchived,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Save failed.");
        return;
      }

      const updated = payload.data as CustomerRow;

      setRows((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      hydrate(updated);
      setIsEditorOpen(false);
      setStatusMessage(`Saved ${updated.display_name || "customer"}.`);
    } catch {
      setStatusMessage("Could not reach customer detail endpoint.");
    }
  }

  /** POST a new project under the selected customer, then navigate to its workspace. */
  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateProjects) {
      setStatusMessage("Your role is read-only for project creation.");
      return;
    }
    const customerId = createProjectCustomerId;
    if (!customerId) {
      setStatusMessage("Select a customer first.");
      return;
    }
    if (!projectName.trim()) {
      setStatusMessage("Project name is required.");
      return;
    }
    if (!projectSiteAddress.trim()) {
      setStatusMessage("Site address is required.");
      return;
    }

    setStatusMessage("");
    try {
      const response = await fetch(`${normalizedBaseUrl}/customers/${customerId}/projects/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          name: projectName,
          site_address: projectSiteAddress,
          status: projectStatus,
        }),
      });
      const payload: ProjectCreateApiResponse = await response.json();
      if (!response.ok) {
        const fieldMessage = payload.error?.fields
          ? Object.values(payload.error.fields).flat()[0]
          : undefined;
        setStatusMessage(
          payload.error?.message ?? fieldMessage ?? "Could not create project for this customer.",
        );
        return;
      }

      const createdProject = payload.data?.project;
      if (!createdProject) {
        setStatusMessage("Project created, but response payload was incomplete.");
        closeProjectCreator();
        return;
      }

      closeProjectCreator();
      setStatusMessage(`Created project #${createdProject.id}. Opening project workspace...`);
      router.push(`/projects?project=${createdProject.id}`);
    } catch {
      setStatusMessage("Could not reach customer project creation endpoint.");
    }
  }

  return (
    <section className={styles.section}>
      {/* Quick Add — collapsible intake form */}
      <div className={styles.quickAddSection}>
        <div className={styles.quickAddHeader}>
          <h3 className={styles.quickAddTitle}>Quick Add Customer</h3>
          <button
            type="button"
            className={collapseButtonStyles.collapseButton}
            onClick={() => setIsQuickAddExpanded((v) => !v)}
            aria-expanded={isQuickAddExpanded}
          >
            {isQuickAddExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
        {isQuickAddExpanded ? (
          <QuickAddConsole
            onCustomerCreated={() => setRefreshKey((k) => k + 1)}
            onBrowseCustomer={(searchTerm) => {
              setQuery(searchTerm);
              setPage(1);
              setActivityFilter("all");
            }}
          />
        ) : null}
      </div>

      {/* Browse — search, filters, customer list, pagination */}
      <div className={styles.browseSection}>
        <h3 className={styles.browseSectionTitle}>Browse Customers</h3>

        <CustomersFilters
          query={query}
          onQueryChange={(next) => {
            setQuery(next);
            setPage(1);
          }}
          activityFilter={activityFilter}
          onActivityFilterChange={setActivityFilter}
          projectFilter={projectFilter}
          onProjectFilterChange={setProjectFilter}
        />

        {statusMessage ? <p className={styles.statusMessage}>{statusMessage}</p> : null}

        <CustomersList
          rows={rows}
          filteredRows={filteredRows}
          query={query}
          projectsByCustomer={projectsByCustomer}
          onEdit={openEditor}
          onCreateProject={openProjectCreator}
        />

        {totalPages > 1 ? (
          <nav className={styles.pagination} aria-label="Customer list pagination">
            <button
              type="button"
              className={styles.paginationButton}
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className={styles.paginationInfo}>
              Page {page} of {totalPages} ({totalCount} customers)
            </span>
            <button
              type="button"
              className={styles.paginationButton}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </nav>
        ) : null}
      </div>

      {/* Edit customer modal */}

      {isEditorOpen && editingCustomer ? (
        <div
          className={styles.modalOverlay}
          onMouseDown={handleOverlayMouseDown}
          onMouseUp={handleOverlayMouseUp}
        >
          <section className={styles.modalCard} role="dialog" aria-modal="true" aria-label="Edit customer">
            <button type="button" className={styles.modalClose} onClick={closeEditor}>
              Close
            </button>
            <CustomerEditorForm
              selectedId={editingId}
              selectedCustomerName={editingCustomer.display_name ?? ""}
              displayName={displayName}
              onDisplayNameChange={setDisplayName}
              phone={phone}
              onPhoneChange={setPhone}
              email={email}
              onEmailChange={setEmail}
              billingAddress={billingAddress}
              onBillingAddressChange={setBillingAddress}
              isArchived={isArchived}
              onIsArchivedChange={setIsArchived}
              projectCount={editingCustomer.project_count ?? 0}
              activeProjectCount={editingCustomer.active_project_count ?? 0}
              hasActiveOrOnHoldProject={Boolean(editingCustomer.has_active_or_on_hold_project)}
              onSubmit={handleSave}
              readOnly={!canMutateCustomers}
            />
          </section>
        </div>
      ) : null}

      {/* Create project modal */}

      {isProjectCreatorOpen && createProjectCustomer ? (
        <div
          className={styles.modalOverlay}
          onMouseDown={handleOverlayMouseDown}
          onMouseUp={handleOverlayMouseUp}
        >
          <section className={styles.modalCard} role="dialog" aria-modal="true" aria-label="Create project">
            <button type="button" className={styles.modalClose} onClick={closeProjectCreator}>
              Close
            </button>
            <CustomerProjectCreateForm
              customerName={createProjectCustomer.display_name}
              projectName={projectName}
              onProjectNameChange={setProjectName}
              projectSiteAddress={projectSiteAddress}
              onProjectSiteAddressChange={setProjectSiteAddress}
              projectStatus={projectStatus}
              onProjectStatusChange={setProjectStatus}
              onSubmit={handleCreateProject}
              readOnly={!canMutateProjects}
              formMessage={statusMessage}
            />
          </section>
        </div>
      ) : null}
    </section>
  );
}
