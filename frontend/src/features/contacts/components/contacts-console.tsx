"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { ApiResponse, ContactRecord } from "../types";

export function ContactsConsole() {
  const { token, authMessage } = useSharedSessionAuth();

  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ContactRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "inactive">("all");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState("field_manual");
  const [leadStatus, setLeadStatus] = useState("new_contact");

  const normalizedBaseUrl = useMemo(() => normalizeApiBaseUrl(defaultApiBaseUrl), []);
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const isInactive = row.status === "archived";
      if (activityFilter === "active") {
        return !isInactive;
      }
      if (activityFilter === "inactive") {
        return isInactive;
      }
      return true;
    });
  }, [activityFilter, rows]);

  function hydrate(contact: ContactRecord) {
    setFullName(contact.full_name ?? "");
    setPhone(contact.phone ?? "");
    setProjectAddress(contact.project_address ?? "");
    setEmail(contact.email ?? "");
    setNotes(contact.notes ?? "");
    setSource(contact.source ?? "field_manual");
    setLeadStatus(contact.status ?? "new_contact");
  }

  function clearForm() {
    setFullName("");
    setPhone("");
    setProjectAddress("");
    setEmail("");
    setNotes("");
    setSource("field_manual");
    setLeadStatus("new_contact");
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
      const selected = activeId ? items.find((entry) => entry.id === activeId) : null;
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
  }, [token, query, normalizedBaseUrl]);

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
          status: leadStatus,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Save failed.");
        return;
      }

      const updated = payload.data as ContactRecord;
      setRows((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
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
    <section>
      <h2>Customers Management</h2>
      <p>Search, review, and edit canonical customer records outside the core money workflow.</p>
      <p>{authMessage}</p>

      <label>
        Search
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, phone, email, or address"
        />
      </label>
      <label>
        Activity
        <select
          value={activityFilter}
          onChange={(event) =>
            setActivityFilter(event.target.value as "all" | "active" | "inactive")
          }
        >
          <option value="all">all</option>
          <option value="active">active</option>
          <option value="inactive">inactive</option>
        </select>
      </label>

      {filteredRows.length > 0 ? (
        <>
          <p>Customers</p>
          <ul style={{ display: "grid", gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
            {filteredRows.map((row) => {
              const isActive = selectedId === String(row.id);
              const isInactive = row.status === "archived";
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(String(row.id))}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      border: isActive ? "1px solid var(--text-primary)" : "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "8px 10px",
                      background: "var(--foreground)",
                      color: "var(--text-primary)",
                      boxShadow: isActive
                        ? "inset 0 0 0 1px var(--text-primary)"
                        : "none",
                      cursor: "pointer",
                    }}
                  >
                    #{row.id} - {row.full_name} ({row.phone || row.email || "no contact"}){" "}
                    [{isInactive ? "inactive" : "active"}]
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : rows.length > 0 ? (
        <p>No customers match the selected activity filter.</p>
      ) : query ? (
        <p>No customers matched your search.</p>
      ) : (
        <p>No customers yet.</p>
      )}

      <form onSubmit={handleSave}>
        <h3>Edit Customer</h3>
        <label>
          Full name
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
        </label>
        <label>
          Phone
          <input value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Project address
          <input
            value={projectAddress}
            onChange={(event) => setProjectAddress(event.target.value)}
            required
          />
        </label>
        <label>
          Source
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="field_manual">field_manual</option>
            <option value="office_manual">office_manual</option>
            <option value="import">import</option>
            <option value="web_form">web_form</option>
            <option value="referral">referral</option>
            <option value="other">other</option>
          </select>
        </label>
        <label>
          Lead status
          <select value={leadStatus} onChange={(event) => setLeadStatus(event.target.value)}>
            <option value="new_contact">new_contact</option>
            <option value="qualified">qualified</option>
            <option value="project_created">project_created</option>
            <option value="archived">archived</option>
          </select>
        </label>
        <label>
          Notes
          <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={!selectedId}>Save Customer</button>
          <button type="button" disabled={!selectedId} onClick={handleDelete}>
            Delete Customer
          </button>
        </div>
      </form>

      <p>{statusMessage}</p>
    </section>
  );
}
