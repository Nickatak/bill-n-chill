"use client";

/**
 * Vendor directory console. Supports paginated browsing, search/filter, CRUD for
 * individual vendor records, duplicate-detection with override, and bulk CSV import.
 * Vendors are canonical records reused across bills, AP workflows, and payment allocation.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { canDo } from "@/shared/session/rbac";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { usePagination } from "@/shared/hooks/use-pagination";
import { useApiList } from "@/shared/hooks/use-api-list";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { ApiResponse, VendorCsvImportResult, VendorPayload, VendorRecord } from "../types";
import segmented from "../../../shared/styles/segmented.module.css";
import styles from "./vendors-console.module.css";
type ActivityFilter = "active" | "all";

/** Full CRUD console for vendor records with search, pagination, and CSV import. */
export function VendorsConsole() {
  const { token, authMessage, capabilities } = useSharedSessionAuth();
  const canMutateVendors = canDo(capabilities, "vendors", "create");

  const [searchTerm, setSearchTerm] = useState("");
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
  const [importExpanded, setImportExpanded] = useState(false);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  const {
    items: rows,
    setItems: setRows,
    selectedId,
    setSelectedId,
    refresh: refreshVendors,
    status: { message: statusMessage, tone: statusTone, setNeutral: setNeutralStatus, setSuccess: setSuccessStatus, setError: setErrorStatus },
  } = useApiList<VendorRecord>({
    endpoint: "/vendors/",
    token,
    autoSelect: false,
    onSuccess() {
      resetPage();
      setDuplicateCandidates([]);
      setPendingCreatePayload(null);
      setImportResult(null);
    },
  });

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
    const needle = searchTerm.trim().toLowerCase();
    return orderedRows.filter((row) => {
      if (!includeCanonical && row.is_canonical) {
        return false;
      }
      if (activityFilter === "active" && !row.is_active) {
        return false;
      }
      if (!needle) {
        return true;
      }
      const haystack = `${row.id} ${row.name} ${row.email} ${row.phone} ${row.tax_id_last4}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [activityFilter, includeCanonical, orderedRows, searchTerm]);
  const {
    pageItems: pagedRows,
    currentPage: currentPageSafe,
    totalPages,
    prevPage,
    nextPage,
    resetPage,
    setCurrentPage,
  } = usePagination(filteredRows, 6);

  const selectedVendor = useMemo(
    () => rows.find((row) => String(row.id) === selectedId) ?? null,
    [rows, selectedId],
  );
  const selectedVendorIsCanonical = Boolean(selectedVendor?.is_canonical);
  const activeCount = useMemo(() => rows.filter((row) => row.is_active).length, [rows]);
  const inactiveCount = rows.length - activeCount;
  const canonicalCount = useMemo(() => rows.filter((row) => row.is_canonical).length, [rows]);

  /** Reset all vendor form fields to their empty defaults. */
  function clearFormFields() {
    setName("");
    setVendorType("trade");
    setVendorEmail("");
    setPhone("");
    setTaxIdLast4("");
    setNotes("");
    setIsActive(true);
  }

  /** Switch the detail panel to "create new vendor" mode. */
  function startCreateMode() {
    setSelectedId("");
    clearFormFields();
    setDuplicateOverrideOnSave(false);
    setDuplicateCandidates([]);
    setPendingCreatePayload(null);
  }

  /** Populate the form fields from a vendor record. */
  function hydrate(item: VendorRecord) {
    setName(item.name);
    setVendorType(item.vendor_type);
    setVendorEmail(item.email);
    setPhone(item.phone);
    setTaxIdLast4(item.tax_id_last4);
    setNotes(item.notes);
    setIsActive(item.is_active);
  }


  /** Select a vendor row and populate the edit form. */
  function handleSelect(id: string) {
    setSelectedId(id);
    const item = rows.find((row) => String(row.id) === id);
    if (!item) {
      return;
    }
    hydrate(item);
    setDuplicateOverrideOnSave(false);
  }

  /** POST a new vendor. Handles 409 duplicate-detection by surfacing candidates to the user. */
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
      setCurrentPage(Math.ceil(nextRows.length / 6));
      return nextRows;
    });
    setSelectedId(String(created.id));
    hydrate(created);
    setDuplicateOverrideOnSave(false);
    setDuplicateCandidates([]);
    setPendingCreatePayload(null);
    setSuccessStatus(`Created vendor #${created.id}.`);
  }

  /** Retry the pending create with duplicate_override after user confirmation. */
  async function handleCreateAnyway() {
    if (!pendingCreatePayload) {
      setErrorStatus("No duplicate candidate payload to resolve.");
      return;
    }

    setNeutralStatus("Creating duplicate vendor by override...");
    await createVendor(pendingCreatePayload, { duplicate_override: true });
  }

  /** Unified form submit handler: creates a new vendor or PATCHes the selected one. */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutateVendors) {
      setErrorStatus("Your role is read-only for vendor mutations.");
      return;
    }
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

  /** Run a CSV import (preview or apply) and reload vendors on successful apply. */
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
        await refreshVendors();
      }
    } catch {
      setErrorStatus("Could not reach vendor CSV import endpoint.");
    }
  }

  // Reset to page 1 when filters change so the user always sees the first matching results
  useEffect(() => {
    resetPage();
  }, [activityFilter, includeCanonical, searchTerm, resetPage]);

  return (
    <section className={styles.console}>
      <header className={styles.headerRow}>
        <div className={styles.headerCopy}>
          <h2 className={styles.headerTitle}>Vendor Directory</h2>
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
            <div className={styles.filterRow}>
              <input
                className={styles.searchInput}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by name, email, phone, or tax ID"
                aria-label="Search vendors"
              />
              <div className={segmented.group} role="group" aria-label="Vendor activity filter">
                <button
                  type="button"
                  className={`${segmented.option} ${activityFilter === "active" ? segmented.optionActive : ""}`}
                  onClick={() => setActivityFilter("active")}
                >
                  Active
                </button>
                <button
                  type="button"
                  className={`${segmented.option} ${activityFilter === "all" ? segmented.optionActive : ""}`}
                  onClick={() => setActivityFilter("all")}
                >
                  All
                </button>
              </div>
              <button
                type="button"
                className={`${styles.filterPill} ${includeCanonical ? styles.filterPillActive : ""}`}
                onClick={() => setIncludeCanonical(!includeCanonical)}
                aria-pressed={includeCanonical}
              >
                Canonical
                <span className={styles.filterPillCount}>{canonicalCount}</span>
              </button>
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
                    onClick={prevPage}
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
                    onClick={nextPage}
                    disabled={currentPageSafe >= totalPages}
                  >
                    Next
                  </button>
                </div>
              </>
            ) : rows.length > 0 ? (
              <p className={styles.emptyState}>No vendors match the current filter.</p>
            ) : (
              <p className={styles.emptyState}>No vendors yet. Create one using the form, or import via CSV.</p>
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
                <h3 className={styles.panelTitle}>
                  {selectedVendor ? `Edit: ${selectedVendor.name}` : "New Vendor"}
                </h3>
                {selectedVendor ? (
                  <button type="button" className={styles.newButton} onClick={startCreateMode}>
                    + New
                  </button>
                ) : null}
              </div>
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
                <button type="submit" className={styles.primaryButton} disabled={selectedVendorIsCanonical || !canMutateVendors}>
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
              <button
                type="button"
                className={styles.importToggle}
                onClick={() => setImportExpanded((current) => !current)}
                aria-expanded={importExpanded}
              >
                <h3 className={styles.panelTitle}>CSV Import</h3>
                <span className={styles.importToggleArrow}>{importExpanded ? "\u25B2" : "\u25BC"}</span>
              </button>
              {importExpanded ? (
                <>
                  <label className={styles.field}>
                    <span>CSV text</span>
                    <textarea
                      value={importCsvText}
                      onChange={(event) => setImportCsvText(event.target.value)}
                      rows={7}
                    />
                  </label>
                  <div className={styles.formActions}>
                    <button type="button" className={styles.secondaryButton} onClick={() => void runCsvImport(true)} disabled={!canMutateVendors}>
                      Preview
                    </button>
                    <button type="button" className={styles.primaryButton} onClick={() => void runCsvImport(false)} disabled={!canMutateVendors}>
                      Apply
                    </button>
                  </div>
                  {importResult ? (
                    <div className={styles.importResult}>
                      <p className={styles.importHint}>
                        Rows: {importResult.total_rows} | Create: {importResult.created_count} | Update:{" "}
                        {importResult.updated_count} | Errors: {importResult.error_count}
                      </p>
                      <ul className={styles.resultRows}>
                        {importResult.rows.map((row) => (
                          <li
                            key={`${row.row_number}-${row.name ?? "none"}-${row.status}`}
                            className={`${styles.resultRow} ${
                              row.status === "error" ? styles.resultRowError : ""
                            }`}
                          >
                            row {row.row_number} | {row.status} | {row.name || "(no name)"}: {row.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
