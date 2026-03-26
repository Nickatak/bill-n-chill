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
import { useEffect } from "react";

import { useVendorForm } from "../hooks/use-vendor-form";
import { useVendorFilters } from "../hooks/use-vendor-filters";
import type { VendorRecord } from "../types";
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
            {/* Search + quick-add combobox */}
            <form
              className={styles.comboRow}
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = filters.searchTerm.trim();
                if (!trimmed) return;
                void form.createVendor(trimmed).then(() => filters.setSearchTerm(""));
              }}
            >
              <input
                className={styles.searchInput}
                value={filters.searchTerm}
                onChange={(e) => filters.setSearchTerm(e.target.value)}
                placeholder="Search or add a vendor"
                aria-label="Search or add a vendor"
              />
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={!canMutateVendors || !filters.searchTerm.trim()}
              >
                Add
              </button>
            </form>

            {form.duplicateCandidates.length > 0 ? (
              <p className={styles.duplicateWarning}>
                A vendor with this name already exists. To distinguish them, add a location or
                qualifier (e.g. &quot;ABC Plumbing — Westside&quot;).
              </p>
            ) : null}

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
          </div>
        </div>
      ) : null}
    </section>
  );
}
