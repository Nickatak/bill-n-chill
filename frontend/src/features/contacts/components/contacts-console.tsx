"use client";

/**
 * Top-level customer management page. Lists all customers with search/filter controls,
 * provides modal-based editing of customer details, and supports inline project creation
 * that routes the user into the new project workspace.
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { canDo } from "@/features/session/rbac";
import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { ProjectRecord } from "@/features/projects/types";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { ApiResponse, CustomerRow } from "../types";
import { ContactEditorForm } from "./contact-editor-form";
import { ContactsFilters } from "./contacts-filters";
import { ContactsList } from "./contacts-list";
import { CustomerProjectCreateForm } from "./customer-project-create-form";
import styles from "./contacts-console.module.css";

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
export function ContactsConsole() {
  const { token, capabilities } = useSharedSessionAuth();
  const canMutateCustomers = canDo(capabilities, "customers", "create");
  const canMutateProjects = canDo(capabilities, "projects", "create");
  const router = useRouter();
  const searchParams = useSearchParams();

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

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [email, setEmail] = useState("");
  const [isArchived, setIsArchived] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectSiteAddress, setProjectSiteAddress] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatusValue>("prospect");

  const normalizedBaseUrl = useMemo(() => normalizeApiBaseUrl(defaultApiBaseUrl), []);
  const scopedContactIdParam = searchParams.get("contact");
  const scopedCustomerIdParam = searchParams.get("customer");
  const scopedContactId =
    scopedContactIdParam && /^\d+$/.test(scopedContactIdParam) ? Number(scopedContactIdParam) : null;
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
  async function loadContacts(searchQuery: string) {
    setStatusMessage("");
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }
      const url = `${normalizedBaseUrl}/customers/${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load customers.");
        return;
      }

      const items = (payload.data as CustomerRow[]) ?? [];
      setRows(items);
      const scopedId = scopedCustomerId ?? scopedContactId;
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
      void loadContacts(query);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, query, normalizedBaseUrl, scopedContactId, scopedCustomerId]);

  // Fetch project index once on mount for the per-customer project accordion
  useEffect(() => {
    if (!token) {
      return;
    }
    void loadProjectsIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, normalizedBaseUrl]);

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
      setStatusMessage(`Saved customer #${updated.id}.`);
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
      <header className={styles.intro}>
        <h2>Customers</h2>
        <p>Find customers quickly and jump directly to their project workspaces.</p>
      </header>

      <ContactsFilters
        query={query}
        onQueryChange={setQuery}
        activityFilter={activityFilter}
        onActivityFilterChange={setActivityFilter}
        projectFilter={projectFilter}
        onProjectFilterChange={setProjectFilter}
      />

      {statusMessage ? <p className={styles.statusMessage}>{statusMessage}</p> : null}

      {/* Customer table with expandable project accordions */}

      <ContactsList
        rows={rows}
        filteredRows={filteredRows}
        query={query}
        projectsByCustomer={projectsByCustomer}
        onEdit={openEditor}
        onCreateProject={openProjectCreator}
      />

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
            <ContactEditorForm
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
            />
          </section>
        </div>
      ) : null}
    </section>
  );
}
