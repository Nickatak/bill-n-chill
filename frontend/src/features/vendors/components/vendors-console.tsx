"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "../../session/use-shared-session";
import { ApiResponse, VendorCsvImportResult, VendorPayload, VendorRecord } from "../types";
import styles from "./vendors-console.module.css";

type StatusTone = "neutral" | "success" | "error";
type ActivityFilter = "all" | "active" | "inactive";

export function VendorsConsole() {
  const { token, authMessage } = useSharedSessionAuth();
  const pageSize = 6;

  const [rows, setRows] = useState<VendorRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const [currentPage, setCurrentPage] = useState(1);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("active");
  const [includeCanonical, setIncludeCanonical] = useState(false);

  const [name, setName] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [taxIdLast4, setTaxIdLast4] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [duplicateOverrideOnSave, setDuplicateOverrideOnSave] = useState(false);
  const [vendorType, setVendorType] = useState<"trade" | "retail">("trade");

  const [duplicateCandidates, setDuplicateCandidates] = useState<VendorRecord[]>([]);
  const [pendingCreatePayload, setPendingCreatePayload] = useState<VendorPayload | null>(null);
  const [importCsvText, setImportCsvText] = useState(
    "name,vendor_type,email,phone,tax_id_last4,notes\n",
  );
  const [importResult, setImportResult] = useState<VendorCsvImportResult | null>(null);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  const orderedRows = useMemo(
    () =>
      [...rows].sort((left, right) => {
        if (left.name !== right.name) {
          return left.name.localeCompare(right.name);
        }
        return left.id - right.id;
      }),
    [rows],
  );
  const filteredRows = useMemo(() => {
    return orderedRows.filter((row) => {
      if (!includeCanonical && row.is_canonical) {
        return false;
      }
      if (activityFilter === "active") {
        return row.is_active;
      }
      if (activityFilter === "inactive") {
        return !row.is_active;
      }
      return true;
    });
  }, [activityFilter, includeCanonical, orderedRows]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const pageStartIndex = (currentPageSafe - 1) * pageSize;
  const pagedRows = filteredRows.slice(pageStartIndex, pageStartIndex + pageSize);

  const selectedVendor = useMemo(
    () => rows.find((row) => String(row.id) === selectedId) ?? null,
    [rows, selectedId],
  );
  const selectedVendorIsCanonical = Boolean(selectedVendor?.is_canonical);
  const activeCount = useMemo(() => rows.filter((row) => row.is_active).length, [rows]);
  const inactiveCount = rows.length - activeCount;
  const canonicalCount = useMemo(() => rows.filter((row) => row.is_canonical).length, [rows]);

  function setNeutralStatus(message: string) {
    setStatusTone("neutral");
    setStatusMessage(message);
  }

  function setSuccessStatus(message: string) {
    setStatusTone("success");
    setStatusMessage(message);
  }

  function setErrorStatus(message: string) {
    setStatusTone("error");
    setStatusMessage(message);
  }

  function clearFormFields() {
    setName("");
    setVendorType("trade");
    setVendorEmail("");
    setPhone("");
    setTaxIdLast4("");
    setNotes("");
    setIsActive(true);
  }

  function startCreateMode() {
    setSelectedId("");
    clearFormFields();
    setDuplicateOverrideOnSave(false);
    setDuplicateCandidates([]);
    setPendingCreatePayload(null);
  }

  function hydrate(item: VendorRecord) {
    setName(item.name);
    setVendorType(item.vendor_type);
    setVendorEmail(item.email);
    setPhone(item.phone);
    setTaxIdLast4(item.tax_id_last4);
    setNotes(item.notes);
    setIsActive(item.is_active);
  }

  async function loadVendors(queryOverride?: string) {
    if (!token) {
      setErrorStatus("No shared session found. Go to / and login first.");
      return;
    }
    setNeutralStatus("Loading vendors...");

    try {
      const effectiveQuery = (typeof queryOverride === "string" ? queryOverride : searchQuery).trim();
      const query = effectiveQuery ? `?q=${encodeURIComponent(effectiveQuery)}` : "";
      const response = await fetch(`${normalizedBaseUrl}/vendors/${query}`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatus(payload.error?.message ?? "Could not load vendors.");
        return;
      }
      const items = (payload.data as VendorRecord[]) ?? [];
      setRows(items);
      setCurrentPage(1);
      setDuplicateCandidates([]);
      setPendingCreatePayload(null);
      setImportResult(null);
      const persistedSelection = items.find((row) => String(row.id) === selectedId) ?? null;
      if (persistedSelection) {
        setSelectedId(String(persistedSelection.id));
        hydrate(persistedSelection);
      } else if (selectedId) {
        setSelectedId("");
        clearFormFields();
      }
      setSuccessStatus(`Loaded ${items.length} vendor(s).`);
    } catch {
      setErrorStatus("Could not reach vendor endpoint.");
    }
  }

  function handleSelect(id: string) {
    setSelectedId(id);
    const item = rows.find((row) => String(row.id) === id);
    if (!item) {
      return;
    }
    hydrate(item);
    setDuplicateOverrideOnSave(false);
  }

  async function createVendor(
    payloadBody: VendorPayload,
    options?: { duplicate_override?: boolean },
  ) {
    const response = await fetch(`${normalizedBaseUrl}/vendors/`, {
      method: "POST",
      headers: buildAuthHeaders(token, { contentType: "application/json" }),
      body: JSON.stringify({ ...payloadBody, ...options }),
    });
    const payload: ApiResponse = await response.json();

    if (response.status === 409 && payload.error?.code === "duplicate_detected") {
      const duplicateData = payload.data as { duplicate_candidates?: VendorRecord[] };
      const candidates = duplicateData.duplicate_candidates ?? [];
      setDuplicateCandidates(candidates);
      setPendingCreatePayload(payloadBody);
      setErrorStatus("Potential duplicate vendor found. Review candidates below.");
      return;
    }

    if (!response.ok) {
      setErrorStatus(payload.error?.message ?? "Create vendor failed.");
      return;
    }

    const created = payload.data as VendorRecord;
    setRows((current) => {
      const nextRows = [...current, created];
      setCurrentPage(Math.ceil(nextRows.length / pageSize));
      return nextRows;
    });
    setSelectedId(String(created.id));
    hydrate(created);
    setDuplicateOverrideOnSave(false);
    setDuplicateCandidates([]);
    setPendingCreatePayload(null);
    setSuccessStatus(`Created vendor #${created.id}.`);
  }

  async function handleCreateAnyway() {
    if (!pendingCreatePayload) {
      setErrorStatus("No duplicate candidate payload to resolve.");
      return;
    }

    setNeutralStatus("Creating duplicate vendor by override...");
    await createVendor(pendingCreatePayload, { duplicate_override: true });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payloadBody: VendorPayload = {
      name: name.trim(),
      vendor_type: vendorType,
      email: vendorEmail.trim(),
      phone: phone.trim(),
      tax_id_last4: taxIdLast4.trim(),
      notes: notes.trim(),
      is_active: selectedVendor ? isActive : true,
    };

    if (!selectedVendor) {
      setNeutralStatus("Creating vendor...");
      await createVendor(
        payloadBody,
        duplicateOverrideOnSave ? { duplicate_override: true } : undefined,
      );
      return;
    }

    setNeutralStatus("Saving vendor...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/vendors/${selectedVendor.id}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({
          ...payloadBody,
          duplicate_override: duplicateOverrideOnSave,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (response.status === 409 && payload.error?.code === "duplicate_detected") {
        const duplicateData = payload.data as { duplicate_candidates?: VendorRecord[] };
        setDuplicateCandidates(duplicateData.duplicate_candidates ?? []);
        setErrorStatus("Potential duplicate found. Enable override and save again if intentional.");
        return;
      }
      if (!response.ok) {
        setErrorStatus(payload.error?.message ?? "Save failed.");
        return;
      }
      const updated = payload.data as VendorRecord;
      setRows((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setDuplicateCandidates([]);
      setPendingCreatePayload(null);
      setDuplicateOverrideOnSave(false);
      setSuccessStatus(`Saved vendor #${updated.id}.`);
    } catch {
      setErrorStatus("Could not reach vendor detail endpoint.");
    }
  }

  async function runCsvImport(dryRun: boolean) {
    setNeutralStatus(dryRun ? "Previewing vendor CSV import..." : "Applying vendor CSV import...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/vendors/import-csv/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
        body: JSON.stringify({ csv_text: importCsvText, dry_run: dryRun }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setErrorStatus(payload.error?.message ?? "Vendor CSV import failed.");
        return;
      }
      const result = payload.data as VendorCsvImportResult;
      setImportResult(result);
      setSuccessStatus(
        `${dryRun ? "Previewed" : "Applied"} ${result.total_rows} row(s): create ${result.created_count}, update ${result.updated_count}, errors ${result.error_count}.`,
      );
      if (!dryRun) {
        await loadVendors();
      }
    } catch {
      setErrorStatus("Could not reach vendor CSV import endpoint.");
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
  }, [activityFilter, includeCanonical]);

  return (
    <section className={styles.console}>
      <header className={styles.headerRow}>
        <div className={styles.headerCopy}>
          <h2 className={styles.headerTitle}>Vendor Directory</h2>
          <p className={styles.headerSubtitle}>
            Manage canonical vendor records reused across bills, AP workflows, and payment allocation.
          </p>
        </div>
        <div className={styles.headerStats}>
          <span className={styles.headerStatPill}>Total {rows.length}</span>
          <span className={styles.headerStatPill}>Active {activeCount}</span>
          <span className={styles.headerStatPill}>Inactive {inactiveCount}</span>
          <span className={styles.headerStatPill}>Canonical {canonicalCount}</span>
        </div>
      </header>

      {!token ? <p className={styles.authNotice}>{authMessage}</p> : null}

      {statusMessage ? (
        <p
          className={`${styles.statusBanner} ${
            statusTone === "success"
              ? styles.statusSuccess
              : statusTone === "error"
                ? styles.statusError
                : ""
          }`}
        >
          {statusMessage}
        </p>
      ) : null}

      {token ? (
        <div className={styles.layout}>
          <section className={`${styles.panel} ${styles.existingPanel}`}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>Existing Vendors</h3>
              <span className={styles.countBadge}>
                {filteredRows.length}/{rows.length}
              </span>
            </div>
            <p className={styles.panelIntro}>
              Search vendors by name/email/phone/tax id, then select one for editing.
            </p>

            <div className={styles.filters}>
              <label className={styles.field}>
                <span>Search query</span>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="name, email, phone, or tax id"
                />
              </label>
              <label className={styles.field}>
                <span>Activity</span>
                <select
                  value={activityFilter}
                  onChange={(event) => setActivityFilter(event.target.value as ActivityFilter)}
                >
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Canonical</span>
                <select
                  value={includeCanonical ? "include" : "exclude"}
                  onChange={(event) => setIncludeCanonical(event.target.value === "include")}
                >
                  <option value="exclude">Hide canonical</option>
                  <option value="include">Include canonical</option>
                </select>
              </label>
              <div className={styles.filterActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => void loadVendors()}>
                  Run Search
                </button>
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => {
                    setSearchQuery("");
                    setActivityFilter("active");
                    setIncludeCanonical(false);
                    void loadVendors("");
                  }}
                >
                  Reset
                </button>
              </div>
            </div>

            {filteredRows.length > 0 ? (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Vendor</th>
                        <th>Contact</th>
                        <th>Type</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedRows.map((row) => {
                        const isSelectedRow = selectedId === String(row.id);
                        return (
                          <tr
                            key={row.id}
                            className={isSelectedRow ? styles.rowSelected : ""}
                            onClick={() => handleSelect(String(row.id))}
                          >
                            <td>
                              <span className={styles.rowPrimary}>
                                #{row.id} {row.name}
                              </span>
                              <span className={styles.rowSecondary}>
                                Tax ID: {row.tax_id_last4 ? `••••${row.tax_id_last4}` : "n/a"}
                              </span>
                            </td>
                            <td>
                              <span className={styles.rowPrimary}>{row.email || "no-email"}</span>
                              <span className={styles.rowSecondary}>{row.phone || "no-phone"}</span>
                            </td>
                            <td>
                              <span className={styles.inlinePill}>
                                {row.vendor_type === "trade" ? "Trade" : "Retail"}
                              </span>
                              {row.is_canonical ? (
                                <span className={`${styles.inlinePill} ${styles.inlinePillCanonical}`}>
                                  Canonical
                                </span>
                              ) : null}
                            </td>
                            <td>
                              <span
                                className={`${styles.inlinePill} ${
                                  row.is_active ? styles.inlinePillActive : styles.inlinePillInactive
                                }`}
                              >
                                {row.is_active ? "Active" : "Inactive"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={styles.pagination}>
                  <button
                    type="button"
                    className={styles.ghostButton}
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
                    className={styles.ghostButton}
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPageSafe >= totalPages}
                  >
                    Next
                  </button>
                </div>
              </>
            ) : rows.length > 0 ? (
              <p className={styles.emptyState}>No vendors match the current filter.</p>
            ) : (
              <p className={styles.emptyState}>No vendors loaded yet.</p>
            )}

            {duplicateCandidates.length > 0 ? (
              <section className={styles.duplicateCard}>
                <p className={styles.duplicateTitle}>Duplicate candidates</p>
                <ul className={styles.duplicateList}>
                  {duplicateCandidates.map((candidate) => (
                    <li key={candidate.id}>
                      <strong>#{candidate.id}</strong> {candidate.name} ({candidate.email || "no-email"})
                    </li>
                  ))}
                </ul>
                {pendingCreatePayload ? (
                  <button type="button" className={styles.primaryButton} onClick={handleCreateAnyway}>
                    Create Anyway
                  </button>
                ) : null}
              </section>
            ) : null}
          </section>

          <div className={styles.layoutRight}>
            <form
              className={`${styles.panel} ${selectedVendorIsCanonical ? styles.panelLocked : ""}`}
              onSubmit={handleSubmit}
            >
              <div className={styles.panelHeader}>
                <h3 className={styles.panelTitle}>Vendor Details</h3>
                <div className={styles.panelActions}>
                  <span className={styles.countBadge}>
                    {selectedVendor ? `Editing #${selectedVendor.id}` : "Create mode"}
                  </span>
                  <button type="button" className={styles.ghostButton} onClick={startCreateMode}>
                    Add New Vendor
                  </button>
                </div>
              </div>
              <p className={styles.panelIntro}>
                {selectedVendor
                  ? "Update the selected vendor record and save changes."
                  : "Create a new vendor, or select a row from the table to edit existing data."}
              </p>
              {selectedVendorIsCanonical ? (
                <p className={styles.panelIntro}>Canonical vendors are read-only and cannot be edited.</p>
              ) : null}
              <label className={styles.field}>
                <span>Name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  disabled={selectedVendorIsCanonical}
                />
              </label>
              <label className={styles.field}>
                <span>Vendor type</span>
                <select
                  value={vendorType}
                  onChange={(event) => setVendorType(event.target.value as "trade" | "retail")}
                  disabled={selectedVendorIsCanonical}
                >
                  <option value="trade">Trade</option>
                  <option value="retail">Retail</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Email</span>
                <input
                  value={vendorEmail}
                  onChange={(event) => setVendorEmail(event.target.value)}
                  disabled={selectedVendorIsCanonical}
                />
              </label>
              <label className={styles.field}>
                <span>Phone</span>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  disabled={selectedVendorIsCanonical}
                />
              </label>
              <label className={styles.field}>
                <span>Tax ID (last 4)</span>
                <input
                  value={taxIdLast4}
                  onChange={(event) => setTaxIdLast4(event.target.value)}
                  inputMode="numeric"
                  maxLength={4}
                  disabled={selectedVendorIsCanonical}
                />
              </label>
              <label className={styles.field}>
                <span>Notes</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={4}
                  disabled={selectedVendorIsCanonical}
                />
              </label>
              {selectedVendor ? (
                <label className={styles.field}>
                  <span>Active status</span>
                  <select
                    value={isActive ? "true" : "false"}
                    onChange={(event) => setIsActive(event.target.value === "true")}
                    disabled={selectedVendorIsCanonical}
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </label>
              ) : null}
              <label className={styles.overrideRow}>
                <input
                  type="checkbox"
                  checked={duplicateOverrideOnSave}
                  onChange={(event) => setDuplicateOverrideOnSave(event.target.checked)}
                  disabled={selectedVendorIsCanonical}
                />
                <span className={styles.overrideBody}>
                  <strong className={styles.overrideTitle}>Allow duplicate vendor identity</strong>
                  <span className={styles.overrideHint}>
                    Bypass duplicate name/email warning for intentional save/create.
                  </span>
                </span>
              </label>
              <div className={styles.formActions}>
                <button type="submit" className={styles.primaryButton} disabled={selectedVendorIsCanonical}>
                  {selectedVendor ? "Save Vendor" : "Create Vendor"}
                </button>
                {selectedVendor ? (
                  <button type="button" className={styles.ghostButton} onClick={() => hydrate(selectedVendor)}>
                    Reset Fields
                  </button>
                ) : null}
              </div>
            </form>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h3 className={styles.panelTitle}>CSV Import</h3>
              </div>
              <p className={styles.panelIntro}>
                Headers: <code>name,vendor_type,email,phone,tax_id_last4,notes</code>
              </p>
              <label className={styles.field}>
                <span>CSV text</span>
                <textarea
                  value={importCsvText}
                  onChange={(event) => setImportCsvText(event.target.value)}
                  rows={7}
                />
              </label>
              <div className={styles.formActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => void runCsvImport(true)}>
                  Preview Import
                </button>
                <button type="button" className={styles.primaryButton} onClick={() => void runCsvImport(false)}>
                  Apply Import
                </button>
              </div>
              {importResult ? (
                <label className={styles.field}>
                  <span>Import result</span>
                  <textarea
                    readOnly
                    rows={Math.min(10, importResult.rows.length + 2)}
                    value={importResult.rows
                      .map((row) => `row ${row.row_number} | ${row.status} | ${row.name || ""} | ${row.message}`)
                      .join("\n")}
                  />
                </label>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
