"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { ProjectRecord } from "@/features/projects/types";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { ApiResponse, CustomerRow } from "../types";
import { ContactEditorForm } from "./contact-editor-form";
import { ContactsFilters } from "./contacts-filters";
import { ContactsList } from "./contacts-list";
import styles from "./contacts-console.module.css";

type ActivityFilter = "all" | "active" | "inactive";
type ProjectFilter = "all" | "with_project" | "without_project";

export function ContactsConsole() {
  const { token, authMessage } = useSharedSessionAuth();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [projectsByCustomer, setProjectsByCustomer] = useState<Record<number, ProjectRecord[]>>({});
  const [editingId, setEditingId] = useState("");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");

  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [email, setEmail] = useState("");
  const [isArchived, setIsArchived] = useState(false);

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
        activityFilter === "all" ||
        (activityFilter === "active" && !inactive) ||
        (activityFilter === "inactive" && inactive);

      const projectMatch =
        projectFilter === "all" ||
        (projectFilter === "with_project" && hasProject) ||
        (projectFilter === "without_project" && !hasProject);

      return activityMatch && projectMatch;
    });
  }, [activityFilter, projectFilter, rows]);
  const editingCustomer = rows.find((entry) => String(entry.id) === editingId) ?? null;

  function hydrate(customer: CustomerRow) {
    setDisplayName(customer.display_name ?? "");
    setPhone(customer.phone ?? "");
    setBillingAddress(customer.billing_address ?? "");
    setEmail(customer.email ?? "");
    setIsArchived(Boolean(customer.is_archived));
  }

  async function loadContacts(searchQuery: string) {
    setStatusMessage("Loading customers...");
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }
      const url = `${normalizedBaseUrl}/contacts/${params.toString() ? `?${params.toString()}` : ""}`;
      const response = await fetch(url, {
        headers: { Authorization: `Token ${token}` },
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
      setStatusMessage(`Loaded ${items.length} customer(s).`);
    } catch {
      setStatusMessage("Could not reach customers endpoint.");
    }
  }

  async function loadProjectsIndex() {
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: { data?: ProjectRecord[] } = await response.json();
      if (!response.ok) {
        return;
      }

      const rows = payload.data ?? [];
      const nextMap: Record<number, ProjectRecord[]> = {};
      for (const project of rows) {
        if (project.status === "prospect") {
          continue;
        }
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

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadProjectsIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, normalizedBaseUrl]);

  function openEditor(id: string) {
    const row = rows.find((entry) => String(entry.id) === id);
    if (!row) {
      return;
    }
    setEditingId(id);
    hydrate(row);
    setIsEditorOpen(true);
  }

  function closeEditor() {
    setIsEditorOpen(false);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const customerId = Number(editingId);
    if (!customerId) {
      setStatusMessage("Select a customer first.");
      return;
    }

    setStatusMessage("Saving customer...");

    try {
      const response = await fetch(`${normalizedBaseUrl}/contacts/${customerId}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
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

  async function handleDelete() {
    const customerId = Number(editingId);
    if (!customerId) {
      setStatusMessage("Select a customer first.");
      return;
    }

    const confirmed = window.confirm(`Delete customer #${customerId}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setStatusMessage("Deleting customer...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/contacts/${customerId}/`, {
        method: "DELETE",
        headers: { Authorization: `Token ${token}` },
      });

      if (!response.ok) {
        let message = "Delete failed.";
        try {
          const payload: ApiResponse = await response.json();
          message = payload.error?.message ?? message;
        } catch {
          // no-op: non-json response
        }
        setStatusMessage(message);
        return;
      }

      setRows((current) => current.filter((entry) => entry.id !== customerId));
      setProjectsByCustomer((current) => {
        const next = { ...current };
        delete next[customerId];
        return next;
      });
      setIsEditorOpen(false);
      setEditingId("");
      setStatusMessage(`Deleted customer #${customerId}.`);
    } catch {
      setStatusMessage("Could not reach customer detail endpoint.");
    }
  }

  return (
    <section className={styles.section}>
      <header className={styles.intro}>
        <h2>Customers</h2>
        <p>Find customers quickly and jump directly to their project workspaces.</p>
        <p className={styles.authMessage}>{authMessage}</p>
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

      <ContactsList
        rows={rows}
        filteredRows={filteredRows}
        query={query}
        projectsByCustomer={projectsByCustomer}
        onEdit={openEditor}
      />

      {isEditorOpen && editingCustomer ? (
        <div
          className={styles.modalOverlay}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeEditor();
            }
          }}
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
              onDelete={handleDelete}
            />
          </section>
        </div>
      ) : null}
    </section>
  );
}
