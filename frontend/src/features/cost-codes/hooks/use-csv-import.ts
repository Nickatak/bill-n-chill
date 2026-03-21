/**
 * CSV import state and handler for cost codes.
 *
 * Manages the import textarea content, dry-run/apply submission,
 * and result display. Calls the cost-code CSV import endpoint and
 * triggers a list refresh on successful apply.
 *
 * Consumer: CostCodesConsole (composed alongside useCostCodeForm
 * and useCostCodeFilters).
 *
 * ## State (useState)
 *
 * - csvText      — textarea content; defaults to "code,name\n" header
 * - importResult — parsed server response from last preview/apply, or null
 * - isExpanded   — whether the collapsible import panel is open
 *
 * ## Functions
 *
 * - runImport(dryRun)
 *     POSTs csvText to /cost-codes/import-csv/ with dry_run flag.
 *     On successful apply, calls refreshCostCodes to reload the list.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import { useState } from "react";

import type { ApiResponse, CsvImportResult } from "../types";

type StatusSetters = {
  setNeutral: (message: string) => void;
  setSuccess: (message: string) => void;
  setError: (message: string) => void;
};

type UseCsvImportOptions = {
  authToken: string;
  canMutate: boolean;
  status: StatusSetters;
  refreshCostCodes: () => Promise<unknown>;
};

/**
 * Manage CSV import state and submission for cost codes.
 *
 * @param options - Auth token, RBAC flag, status setters, and list refresh.
 * @returns Import state, setters, and the runImport handler.
 */
export function useCsvImport({
  authToken,
  canMutate,
  status,
  refreshCostCodes,
}: UseCsvImportOptions) {

  // --- State ---

  const [csvText, setCsvText] = useState("code,name\n");
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // --- Functions ---

  /** POST CSV text to the import endpoint. Reloads the list on successful apply. */
  async function runImport(dryRun: boolean) {
    if (!canMutate) {
      status.setError("Your role is read-only for cost code mutations.");
      return;
    }
    status.setNeutral(dryRun ? "Previewing CSV import..." : "Applying CSV import...");
    try {
      const response = await fetch(`${apiBaseUrl}/cost-codes/import-csv/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({ csv_text: csvText, dry_run: dryRun }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        status.setError(payload.error?.message ?? "CSV import failed.");
        return;
      }

      const result = payload.data as CsvImportResult;
      setImportResult(result);
      if (!dryRun) {
        await refreshCostCodes();
      }
      status.setSuccess(
        `${dryRun ? "Previewed" : "Applied"} ${result.total_rows} row(s): create ${result.created_count}, update ${result.updated_count}, errors ${result.error_count}.`,
      );
    } catch {
      status.setError("Could not reach cost code CSV import endpoint.");
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
