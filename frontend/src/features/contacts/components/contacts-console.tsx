"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { ApiResponse, ContactRecord } from "../types";
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
  const [rows, setRows] = useState<ContactRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState("field_manual");
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
      const hasProject = row.has_project ?? Boolean(row.converted_project);

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
  const selectedContact = rows.find((entry) => String(entry.id) === selectedId) ?? null;

  function hydrate(contact: ContactRecord) {
    setFullName(contact.full_name ?? "");
    setPhone(contact.phone ?? "");
    setProjectAddress(contact.project_address ?? "");
    setEmail(contact.email ?? "");
    setNotes(contact.notes ?? "");
    setSource(contact.source ?? "field_manual");
    setIsArchived(Boolean(contact.is_archived));
  }

  function clearForm() {
    setFullName("");
    setPhone("");
    setProjectAddress("");
    setEmail("");
    setNotes("");
    setSource("field_manual");
    setIsArchived(false);
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

      const items = (payload.data as ContactRecord[]) ?? [];
      setRows(items);
      const activeId = selectedId ? Number(selectedId) : null;
      const scopedContact = scopedContactId
        ? items.find((entry) => entry.id === scopedContactId)
        : null;
      const scopedCustomer = scopedCustomerId
        ? items.find((entry) => entry.converted_customer === scopedCustomerId)
        : null;
      const selected =
        scopedContact ??
        scopedCustomer ??
        (activeId ? items.find((entry) => entry.id === activeId) : null);
      if (selected) {
        setSelectedId(String(selected.id));
        hydrate(selected);
      } else if (items[0]) {
        setSelectedId(String(items[0].id));
        hydrate(items[0]);
      } else {
        setSelectedId("");
        clearForm();
      }
      setStatusMessage(`Loaded ${items.length} customer(s).`);
    } catch {
      setStatusMessage("Could not reach customers endpoint.");
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
    // Intentionally excludes selectedId to avoid reload loops when selecting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, query, normalizedBaseUrl, scopedContactId, scopedCustomerId]);

  function handleSelect(id: string) {
    setSelectedId(id);
    const row = rows.find((entry) => String(entry.id) === id);
    if (row) {
      hydrate(row);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const contactId = Number(selectedId);
    if (!contactId) {
      setStatusMessage("Select a customer first.");
      return;
    }

    setStatusMessage("Saving customer...");

    try {
      const response = await fetch(`${normalizedBaseUrl}/contacts/${contactId}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          full_name: fullName,
          phone,
          project_address: projectAddress,
          email,
          notes,
          source,
          is_archived: isArchived,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Save failed.");
        return;
      }

      const updated = payload.data as ContactRecord;
      setRows((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      hydrate(updated);
      setStatusMessage(`Saved customer #${updated.id}.`);
    } catch {
      setStatusMessage("Could not reach customer detail endpoint.");
    }
  }

  async function handleDelete() {
    const contactId = Number(selectedId);
    if (!contactId) {
      setStatusMessage("Select a customer first.");
      return;
    }

    const confirmed = window.confirm(`Delete customer #${contactId}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setStatusMessage("Deleting customer...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/contacts/${contactId}/`, {
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

      setRows((current) => {
        const nextRows = current.filter((entry) => entry.id !== contactId);
        const nextSelected = nextRows[0];
        if (nextSelected) {
          setSelectedId(String(nextSelected.id));
          hydrate(nextSelected);
        } else {
          setSelectedId("");
          clearForm();
        }
        return nextRows;
      });
      setStatusMessage(`Deleted customer #${contactId}.`);
    } catch {
      setStatusMessage("Could not reach customer detail endpoint.");
    }
  }

  return (
    <section className={styles.section}>
      <header className={styles.intro}>
        <h2>Customers</h2>
        <p>Search, review, and update canonical customer records outside core money workflows.</p>
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

      <div className={styles.layout}>
        <ContactsList
          rows={rows}
          filteredRows={filteredRows}
          selectedId={selectedId}
          query={query}
          onSelect={handleSelect}
        />
        <ContactEditorForm
          selectedId={selectedId}
          selectedContactName={selectedContact?.full_name ?? ""}
          fullName={fullName}
          onFullNameChange={setFullName}
          phone={phone}
          onPhoneChange={setPhone}
          email={email}
          onEmailChange={setEmail}
          projectAddress={projectAddress}
          onProjectAddressChange={setProjectAddress}
          source={source}
          onSourceChange={setSource}
          isArchived={isArchived}
          onIsArchivedChange={setIsArchived}
          hasProject={selectedContact?.has_project ?? Boolean(selectedContact?.converted_project)}
          notes={notes}
          onNotesChange={setNotes}
          onSubmit={handleSave}
          onDelete={handleDelete}
        />
      </div>
    </section>
  );
}
