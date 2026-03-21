"use client";

/**
 * Vendor directory console — root component for the /vendors page.
 *
 * Pure orchestrator — composes hooks for list fetching, form CRUD
 * (with duplicate detection), filtering, and CSV import.
 *
 * Parent: app/vendors/page.tsx
 *
 * ## Page layout
 *
 * ┌─────────────────────────────────────────────────────┐
 * │ Header (title + stat pills)                         │
 * ├─────────────────────────────────────────────────────┤
 * │ Status banner (conditional)                         │
 * ├──────────────────────┬──────────────────────────────┤
 * │ Existing Vendors     │ Create/Edit Form             │
 * │   ├── Search input   │   ├── Name, Email, Phone     │
 * │   ├── Activity pills │   ├── Tax ID, Notes          │
 * │   ├── Vendor table   │   ├── Active status (edit)   │
 * │   ├── Pagination     │   ├── Duplicate override     │
 * │   └── Duplicate      │   └── Submit / Reset         │
 * │       candidates     ├──────────────────────────────┤
 * │       (conditional)  │ CSV Import (collapsible)     │
 * └──────────────────────┴──────────────────────────────┘
 *
 * ## Hook dependency graph
 *
 * useApiList (shared — owns list data, selection, status messaging)
 *   ├── useVendorFilters   (reads vendors)
 *   ├── useVendorForm      (reads + writes vendors, reads selectedId)
 *   └── useVendorCsvImport (calls refreshVendors after apply)
 * usePagination            (reads filteredRows)
 *
 * ## Effect: filter reset
 *
 * Deps: [activityFilter, searchTerm, resetPage]
 *
 * Resets pagination to page 1 when filters change so the user
 * always sees the first matching results.
 *
 * ## Orchestration (in JSX)
 *
 * - useApiList's onSuccess resets page, clears duplicate state and
 *   import results.
 * - Form submit dispatches to form.handleSubmit which internally
 *   routes to create (with 409 handling) or PATCH based on selection.
 * - Duplicate candidates panel with "Create Anyway" button appears
 *   below the list when a 409 is received.
 */

import { canDo } from "@/shared/session/rbac";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { useApiList } from "@/shared/hooks/use-api-list";
import { usePagination } from "@/shared/hooks/use-pagination";
import { useEffect } from "react";

import { useVendorForm } from "../hooks/use-vendor-form";
import { useVendorFilters } from "../hooks/use-vendor-filters";
import { useVendorCsvImport } from "../hooks/use-vendor-csv-import";
import type { VendorRecord } from "../types";
import segmented from "../../../shared/styles/segmented.module.css";
import styles from "./vendors-console.module.css";

/** Full CRUD console for vendor records with search, pagination, and CSV import. */
export function VendorsConsole() {
  const { token: authToken, authMessage, capabilities } = useSharedSessionAuth();
  const canMutateVendors = canDo(capabilities, "vendors", "create");

  const {
    items: vendors,
    setItems: setVendors,
    selectedId,
    setSelectedId,
    refresh: refreshVendors,
    status: {
      message: statusMessage,
      tone: statusTone,
      setNeutral: setNeutralStatus,
      setSuccess: setSuccessStatus,
      setError: setErrorStatus,
    },
  } = useApiList<VendorRecord>({
    endpoint: "/vendors/",
    token: authToken,
    autoSelect: false,
    onSuccess() {
      resetPage();
    },
  });

  const filters = useVendorFilters(vendors);

  const {
    pageItems: pagedRows,
    currentPage: currentPageSafe,
    totalPages,
    prevPage,
    nextPage,
    resetPage,
    setCurrentPage,
  } = usePagination(filters.filteredRows, 6);

  const form = useVendorForm({
    authToken,
    canMutate: canMutateVendors,
    vendors,
    setVendors,
    selectedId,
    setSelectedId,
    setCurrentPage,
    status: { setNeutral: setNeutralStatus, setSuccess: setSuccessStatus, setError: setErrorStatus },
  });

  const csvImport = useVendorCsvImport({
    authToken,
    canMutate: canMutateVendors,
    status: { setNeutral: setNeutralStatus, setSuccess: setSuccessStatus, setError: setErrorStatus },
    refreshVendors,
  });

  /** Effect: filter reset — resets pagination when filters change. */
  useEffect(() => {
    resetPage();
  }, [filters.activityFilter, filters.searchTerm, resetPage]);

  return (
    <section className={styles.console}>
      <header className={styles.headerRow}>
        <div className={styles.headerCopy}>
          <h2 className={styles.headerTitle}>Vendor Directory</h2>
        </div>
        <div className={styles.headerStats}>
          <span className={styles.headerStatPill}>Total {vendors.length}</span>
          <span className={styles.headerStatPill}>Active {filters.activeCount}</span>
          <span className={styles.headerStatPill}>Inactive {filters.inactiveCount}</span>
        </div>
      </header>

      {!authToken ? <p className={styles.authNotice}>{authMessage}</p> : null}

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

      {authToken ? (
        <div className={styles.layout}>
          <section className={`${styles.panel} ${styles.existingPanel}`}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>Existing Vendors</h3>
              <span className={styles.countBadge}>
                {filters.filteredRows.length}/{vendors.length}
              </span>
            </div>
            <div className={styles.filterRow}>
              <input
                className={styles.searchInput}
                value={filters.searchTerm}
                onChange={(event) => filters.setSearchTerm(event.target.value)}
                placeholder="Search by name, email, phone, or tax ID"
                aria-label="Search vendors"
              />
              <div className={segmented.group} role="group" aria-label="Vendor activity filter">
                <button
                  type="button"
                  className={`${segmented.option} ${filters.activityFilter === "active" ? segmented.optionActive : ""}`}
                  onClick={() => filters.setActivityFilter("active")}
                >
                  Active
                </button>
                <button
                  type="button"
                  className={`${segmented.option} ${filters.activityFilter === "all" ? segmented.optionActive : ""}`}
                  onClick={() => filters.setActivityFilter("all")}
                >
                  All
                </button>
              </div>
            </div>

            {filters.filteredRows.length > 0 ? (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Vendor</th>
                        <th>Contact</th>
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
                            onClick={() => form.handleSelect(String(row.id))}
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
            ) : vendors.length > 0 ? (
              <p className={styles.emptyState}>No vendors match the current filter.</p>
            ) : (
              <p className={styles.emptyState}>No vendors yet. Create one using the form, or import via CSV.</p>
            )}

            {form.duplicateCandidates.length > 0 ? (
              <section className={styles.duplicateCard}>
                <p className={styles.duplicateTitle}>Existing vendor with this name</p>
                <ul className={styles.duplicateList}>
                  {form.duplicateCandidates.map((candidate) => (
                    <li key={candidate.id}>
                      <strong>#{candidate.id}</strong> {candidate.name} ({candidate.email || "no-email"})
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </section>

          <div className={styles.layoutRight}>
            <form
              className={styles.panel}
              onSubmit={form.handleSubmit}
            >
              <div className={styles.panelHeader}>
                <h3 className={styles.panelTitle}>
                  {form.selectedVendor ? `Edit: ${form.selectedVendor.name}` : "New Vendor"}
                </h3>
                {form.selectedVendor ? (
                  <button type="button" className={styles.newButton} onClick={form.startCreateMode}>
                    + New
                  </button>
                ) : null}
              </div>
              <label className={styles.field}>
                <span>Name</span>
                <input
                  value={form.name}
                  onChange={(event) => form.setName(event.target.value)}
                  required
                />
              </label>
              <label className={styles.field}>
                <span>Email</span>
                <input
                  value={form.vendorEmail}
                  onChange={(event) => form.setVendorEmail(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>Phone</span>
                <input
                  value={form.phone}
                  onChange={(event) => form.setPhone(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>Tax ID (last 4)</span>
                <input
                  value={form.taxIdLast4}
                  onChange={(event) => form.setTaxIdLast4(event.target.value)}
                  inputMode="numeric"
                  maxLength={4}
                />
              </label>
              <label className={styles.field}>
                <span>Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => form.setNotes(event.target.value)}
                  rows={4}
                />
              </label>
              {form.selectedVendor ? (
                <label className={styles.field}>
                  <span>Active status</span>
                  <select
                    value={form.isActive ? "true" : "false"}
                    onChange={(event) => form.setIsActive(event.target.value === "true")}
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </label>
              ) : null}
              <div className={styles.formActions}>
                <button type="submit" className={styles.primaryButton} disabled={!canMutateVendors}>
                  {form.selectedVendor ? "Save Vendor" : "Create Vendor"}
                </button>
                {form.selectedVendor ? (
                  <button type="button" className={styles.ghostButton} onClick={() => form.hydrate(form.selectedVendor!)}>
                    Reset Fields
                  </button>
                ) : null}
              </div>
            </form>

            <section className={styles.panel}>
              <button
                type="button"
                className={styles.importToggle}
                onClick={() => csvImport.setIsExpanded((current) => !current)}
                aria-expanded={csvImport.isExpanded}
              >
                <h3 className={styles.panelTitle}>CSV Import</h3>
                <span className={styles.importToggleArrow}>{csvImport.isExpanded ? "\u25B2" : "\u25BC"}</span>
              </button>
              {csvImport.isExpanded ? (
                <>
                  <label className={styles.field}>
                    <span>CSV text</span>
                    <textarea
                      value={csvImport.csvText}
                      onChange={(event) => csvImport.setCsvText(event.target.value)}
                      rows={7}
                    />
                  </label>
                  <div className={styles.formActions}>
                    <button type="button" className={styles.secondaryButton} onClick={() => void csvImport.runImport(true)} disabled={!canMutateVendors}>
                      Preview
                    </button>
                    <button type="button" className={styles.primaryButton} onClick={() => void csvImport.runImport(false)} disabled={!canMutateVendors}>
                      Apply
                    </button>
                  </div>
                  {csvImport.importResult ? (
                    <div className={styles.importResult}>
                      <p className={styles.importHint}>
                        Rows: {csvImport.importResult.total_rows} | Create: {csvImport.importResult.created_count} | Update:{" "}
                        {csvImport.importResult.updated_count} | Errors: {csvImport.importResult.error_count}
                      </p>
                      <ul className={styles.resultRows}>
                        {csvImport.importResult.rows.map((row) => (
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
