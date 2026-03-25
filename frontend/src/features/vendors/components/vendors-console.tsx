"use client";

/**
 * Vendor management console — root component for the /vendors page.
 *
 * Simple name input for quick-add at top. Full edit form appears only
 * when a vendor is selected from the list. Search + paginated table.
 *
 * Parent: app/vendors/page.tsx
 */

import { canDo } from "@/shared/session/rbac";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { useApiList } from "@/shared/hooks/use-api-list";
import { usePagination } from "@/shared/hooks/use-pagination";
import { useEffect, useState } from "react";

import { useVendorForm } from "../hooks/use-vendor-form";
import { useVendorFilters } from "../hooks/use-vendor-filters";
import { useVendorCsvImport } from "../hooks/use-vendor-csv-import";
import type { VendorRecord } from "../types";
import styles from "./vendors-console.module.css";

/** Full CRUD console for vendor records with search, pagination, and CSV import. */
export function VendorsConsole() {
  const { token: authToken, authMessage, capabilities } = useSharedSessionAuth();
  const canMutateVendors = canDo(capabilities, "vendors", "create");

  const [quickAddName, setQuickAddName] = useState("");

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

  useEffect(() => {
    resetPage();
  }, [filters.searchTerm, resetPage]);

  return (
    <section className={styles.console}>
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
            {/* Quick add */}
            <form
              className={styles.quickAddRow}
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = quickAddName.trim();
                if (!trimmed) return;
                void form.createVendor(trimmed).then(() => setQuickAddName(""));
              }}
            >
              <input
                className={styles.searchInput}
                value={quickAddName}
                onChange={(e) => setQuickAddName(e.target.value)}
                placeholder="New vendor name"
                aria-label="New vendor name"
              />
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canMutateVendors || !quickAddName.trim()}
              >
                Add
              </button>
            </form>

            {/* Search + count */}
            <div className={styles.filterRow}>
              <input
                className={styles.searchInput}
                value={filters.searchTerm}
                onChange={(event) => filters.setSearchTerm(event.target.value)}
                placeholder="Search by name, email, phone, or tax ID"
                aria-label="Search vendors"
              />
              <span className={styles.countBadge}>
                {filters.filteredRows.length}/{vendors.length}
              </span>
            </div>

            {/* Table */}
            {filters.filteredRows.length > 0 ? (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Vendor</th>
                        <th>Contact</th>
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
                              <span className={styles.rowPrimary}>{row.name}</span>
                              {row.tax_id_last4 ? (
                                <span className={styles.rowSecondary}>Tax ID: ••••{row.tax_id_last4}</span>
                              ) : null}
                            </td>
                            <td>
                              <span className={styles.rowPrimary}>{row.email || "—"}</span>
                              {row.phone ? <span className={styles.rowSecondary}>{row.phone}</span> : null}
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
              <p className={styles.emptyState}>No vendors yet. Add one above, or import via CSV.</p>
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

          {/* Edit form — only shown when a vendor is selected */}
          <div className={styles.layoutRight}>
            {form.selectedVendor ? (
              <form
                className={styles.panel}
                onSubmit={form.handleSubmit}
              >
                <div className={styles.panelHeader}>
                  <h3 className={styles.panelTitle}>Edit: {form.selectedVendor.name}</h3>
                  <button type="button" className={styles.ghostButton} onClick={form.startCreateMode}>
                    Deselect
                  </button>
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
                    rows={3}
                  />
                </label>
                <div className={styles.formActions}>
                  <button type="submit" className={styles.primaryButton} disabled={!canMutateVendors}>
                    Save
                  </button>
                  <button type="button" className={styles.ghostButton} onClick={() => form.hydrate(form.selectedVendor!)}>
                    Reset
                  </button>
                </div>
              </form>
            ) : null}

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
