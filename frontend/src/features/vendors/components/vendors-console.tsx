"use client";

import { FormEvent, useEffect, useState } from "react";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { ApiResponse, VendorPayload, VendorRecord } from "../types";
import styles from "./vendors-console.module.css";

export function VendorsConsole() {
  const { token } = useSharedSessionAuth();
  const pageSize = 5;

  const [rows, setRows] = useState<VendorRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "inactive">("all");

  const [name, setName] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [taxIdLast4, setTaxIdLast4] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [duplicateOverrideOnSave, setDuplicateOverrideOnSave] = useState(false);

  const [newName, setNewName] = useState("");
  const [newVendorType, setNewVendorType] = useState<"trade" | "retail">("trade");
  const [newVendorEmail, setNewVendorEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newTaxIdLast4, setNewTaxIdLast4] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [vendorType, setVendorType] = useState<"trade" | "retail">("trade");

  const [duplicateCandidates, setDuplicateCandidates] = useState<VendorRecord[]>([]);
  const [pendingCreatePayload, setPendingCreatePayload] = useState<VendorPayload | null>(null);
  const filteredRows = rows.filter((row) => {
    if (activityFilter === "active") {
      return row.is_active;
    }
    if (activityFilter === "inactive") {
      return !row.is_active;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const pageStartIndex = (currentPageSafe - 1) * pageSize;
  const pagedRows = filteredRows.slice(pageStartIndex, pageStartIndex + pageSize);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  function hydrate(item: VendorRecord) {
    setName(item.name);
    setVendorType(item.vendor_type);
    setVendorEmail(item.email);
    setPhone(item.phone);
    setTaxIdLast4(item.tax_id_last4);
    setNotes(item.notes);
    setIsActive(item.is_active);
  }

  async function loadVendors() {
    if (!token) {
      setStatusMessage("No shared session found. Go to / and login first.");
      return;
    }
    setStatusMessage("Loading vendors...");

    try {
      const query = searchQuery.trim()
        ? `?q=${encodeURIComponent(searchQuery.trim())}`
        : "";
      const response = await fetch(`${normalizedBaseUrl}/vendors/${query}`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load vendors.");
        return;
      }
      const items = (payload.data as VendorRecord[]) ?? [];
      setRows(items);
      setCurrentPage(1);
      if (items[0]) {
        setSelectedId(String(items[0].id));
        hydrate(items[0]);
      } else {
        setSelectedId("");
      }
      setStatusMessage(`Loaded ${items.length} vendor(s).`);
    } catch {
      setStatusMessage("Could not reach vendor endpoint.");
    }
  }

  function handleSelect(id: string) {
    setSelectedId(id);
    const item = rows.find((row) => String(row.id) === id);
    if (item) {
      hydrate(item);
      setDuplicateOverrideOnSave(false);
    }
  }

  async function createVendor(
    payloadBody: VendorPayload,
    options?: { duplicate_override?: boolean },
  ) {
    const response = await fetch(`${normalizedBaseUrl}/vendors/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify({ ...payloadBody, ...options }),
    });
    const payload: ApiResponse = await response.json();

    if (response.status === 409 && payload.error?.code === "duplicate_detected") {
      const duplicateData = payload.data as { duplicate_candidates?: VendorRecord[] };
      const candidates = duplicateData.duplicate_candidates ?? [];
      setDuplicateCandidates(candidates);
      setPendingCreatePayload(payloadBody);
      setStatusMessage("Possible duplicate vendor found by name/email.");
      return;
    }

    if (!response.ok) {
      setStatusMessage(payload.error?.message ?? "Create vendor failed.");
      return;
    }

    const created = payload.data as VendorRecord;
    setRows((current) => {
      const next = [...current, created];
      setCurrentPage(Math.ceil(next.length / pageSize));
      return next;
    });
    setSelectedId(String(created.id));
    hydrate(created);
    setNewName("");
    setNewVendorEmail("");
    setNewPhone("");
    setNewTaxIdLast4("");
    setNewNotes("");
    setDuplicateCandidates([]);
    setPendingCreatePayload(null);
    setStatusMessage(`Created vendor #${created.id}.`);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage("Creating vendor...");

    await createVendor({
      name: newName,
      vendor_type: newVendorType,
      email: newVendorEmail,
      phone: newPhone,
      tax_id_last4: newTaxIdLast4,
      notes: newNotes,
      is_active: true,
    });
  }

  async function handleCreateAnyway() {
    if (!pendingCreatePayload) {
      setStatusMessage("No duplicate candidate payload to resolve.");
      return;
    }

    setStatusMessage("Creating duplicate vendor by override...");
    await createVendor(pendingCreatePayload, { duplicate_override: true });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = Number(selectedId);
    if (!id) {
      setStatusMessage("Select a vendor first.");
      return;
    }

    setStatusMessage("Saving vendor...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/vendors/${id}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          name,
          vendor_type: vendorType,
          email: vendorEmail,
          phone,
          tax_id_last4: taxIdLast4,
          notes,
          is_active: isActive,
          duplicate_override: duplicateOverrideOnSave,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (response.status === 409 && payload.error?.code === "duplicate_detected") {
        const duplicateData = payload.data as { duplicate_candidates?: VendorRecord[] };
        setDuplicateCandidates(duplicateData.duplicate_candidates ?? []);
        setStatusMessage("Possible duplicate vendor found. Enable override and save again if intentional.");
        return;
      }
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Save failed.");
        return;
      }
      const updated = payload.data as VendorRecord;
      setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setDuplicateCandidates([]);
      setStatusMessage(`Saved vendor #${updated.id}.`);
    } catch {
      setStatusMessage("Could not reach vendor detail endpoint.");
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadVendors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activityFilter]);

  return (
    <section>
      <h2>Vendor Directory</h2>
      <p>Create, search, and update reusable vendors for AP and commitments.</p>

      <label>
        Search query
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="name, email, phone, or tax id"
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
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Type</th>
                <th>Canonical</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row) => {
                const isSelected = selectedId === String(row.id);
                return (
                  <tr
                    key={row.id}
                    className={isSelected ? styles.rowSelected : undefined}
                    onClick={() => handleSelect(String(row.id))}
                  >
                    <td>#{row.id} - {row.name}</td>
                    <td>{row.vendor_type}</td>
                    <td>{row.is_canonical ? "yes" : "no"}</td>
                    <td>{row.email || "no-email"}</td>
                    <td>{row.phone || "—"}</td>
                    <td>{row.is_active ? "active" : "inactive"}</td>
                    <td>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSelect(String(row.id));
                        }}
                        disabled={isSelected}
                      >
                        {isSelected ? "Selected" : "Select"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={styles.pagination}>
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPageSafe <= 1}
            >
              Prev
            </button>
            <span>
              Page {currentPageSafe} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPageSafe >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
      ) : rows.length > 0 ? (
        <p>No vendors match the selected activity filter.</p>
      ) : (
        <p>No vendors loaded yet.</p>
      )}

      {duplicateCandidates.length > 0 ? (
        <>
          <p>Duplicate candidates:</p>
          <ul>
            {duplicateCandidates.map((candidate) => (
              <li key={candidate.id}>
                #{candidate.id} {candidate.name} ({candidate.email || "no-email"})
              </li>
            ))}
          </ul>
          {pendingCreatePayload ? (
            <button type="button" onClick={handleCreateAnyway}>
              Create Anyway
            </button>
          ) : null}
        </>
      ) : null}

      <form onSubmit={handleCreate}>
        <h3>Create Vendor</h3>
        <label>
          Name
          <input value={newName} onChange={(event) => setNewName(event.target.value)} required />
        </label>
        <label>
          Vendor type
          <select
            value={newVendorType}
            onChange={(event) => setNewVendorType(event.target.value as "trade" | "retail")}
          >
            <option value="trade">trade</option>
            <option value="retail">retail</option>
          </select>
        </label>
        <label>
          Email
          <input value={newVendorEmail} onChange={(event) => setNewVendorEmail(event.target.value)} />
        </label>
        <label>
          Phone
          <input value={newPhone} onChange={(event) => setNewPhone(event.target.value)} />
        </label>
        <label>
          Tax ID (last 4)
          <input
            value={newTaxIdLast4}
            onChange={(event) => setNewTaxIdLast4(event.target.value)}
            inputMode="numeric"
            maxLength={4}
          />
        </label>
        <label>
          Notes
          <textarea value={newNotes} onChange={(event) => setNewNotes(event.target.value)} />
        </label>
        <button type="submit">Create Vendor</button>
      </form>

      <form onSubmit={handleSave}>
        <h3>Edit Vendor</h3>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Vendor type
          <select
            value={vendorType}
            onChange={(event) => setVendorType(event.target.value as "trade" | "retail")}
          >
            <option value="trade">trade</option>
            <option value="retail">retail</option>
          </select>
        </label>
        <label>
          Email
          <input value={vendorEmail} onChange={(event) => setVendorEmail(event.target.value)} />
        </label>
        <label>
          Phone
          <input value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
        <label>
          Tax ID (last 4)
          <input
            value={taxIdLast4}
            onChange={(event) => setTaxIdLast4(event.target.value)}
            inputMode="numeric"
            maxLength={4}
          />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <label>
          Active
          <select
            value={isActive ? "true" : "false"}
            onChange={(event) => setIsActive(event.target.value === "true")}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
        <label>
          Allow duplicate name/email on save
          <input
            type="checkbox"
            checked={duplicateOverrideOnSave}
            onChange={(event) => setDuplicateOverrideOnSave(event.target.checked)}
          />
        </label>
        <button type="submit" disabled={!selectedId}>
          Save Vendor
        </button>
      </form>

      <p>{statusMessage}</p>
    </section>
  );
}
