/**
 * CSV import state and handler for vendors.
 *
 * Manages the import textarea content, dry-run/apply submission,
 * and result display. Calls the vendor CSV import endpoint and
 * triggers a list refresh on successful apply.
 *
 * Consumer: VendorsConsole (composed alongside useVendorForm
 * and useVendorFilters).
 *
 * ## State (useState)
 *
 * - csvText      — textarea content; defaults to header row
 * - importResult — parsed server response from last preview/apply, or null
 * - isExpanded   — whether the collapsible import panel is open
 *
 * ## Functions
 *
 * - runImport(dryRun)
 *     POSTs csvText to /vendors/import-csv/ with dry_run flag.
 *     On successful apply, calls refreshVendors to reload the list.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import { useState } from "react";

import type { ApiResponse, VendorCsvImportResult } from "../types";

type StatusSetters = {
  setNeutral: (message: string) => void;
  setSuccess: (message: string) => void;
  setError: (message: string) => void;
};

type UseVendorCsvImportOptions = {
  authToken: string;
  canMutate: boolean;
  status: StatusSetters;
  refreshVendors: () => Promise<unknown>;
};

/**
 * Manage CSV import state and submission for vendors.
 *
 * @param options - Auth token, RBAC flag, status setters, and list refresh.
 * @returns Import state, setters, and the runImport handler.
 */
export function useVendorCsvImport({
  authToken,
  canMutate,
  status,
  refreshVendors,
}: UseVendorCsvImportOptions) {

  // --- State ---

  const [csvText, setCsvText] = useState("name,email,phone,tax_id_last4,notes\n");
  const [importResult, setImportResult] = useState<VendorCsvImportResult | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // --- Functions ---

  /** POST CSV text to the vendor import endpoint. Reloads the list on successful apply. */
  async function runImport(dryRun: boolean) {
    if (!canMutate) {
      status.setError("Your role is read-only for vendor mutations.");
      return;
    }
    status.setNeutral(dryRun ? "Previewing vendor CSV import..." : "Applying vendor CSV import...");
    try {
      const response = await fetch(`${apiBaseUrl}/vendors/import-csv/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({ csv_text: csvText, dry_run: dryRun }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        status.setError(payload.error?.message ?? "Vendor CSV import failed.");
        return;
      }
      const result = payload.data as VendorCsvImportResult;
      setImportResult(result);
      status.setSuccess(
        `${dryRun ? "Previewed" : "Applied"} ${result.total_rows} row(s): create ${result.created_count}, update ${result.updated_count}, errors ${result.error_count}.`,
      );
      if (!dryRun) {
        await refreshVendors();
      }
    } catch {
      status.setError("Could not reach vendor CSV import endpoint.");
    }
  }

  // --- Return bag ---

  return {
    // State
    csvText,
    importResult,
    isExpanded,

    // Setters
    setCsvText,
    setIsExpanded,

    // Helpers
    runImport,
  };
}
