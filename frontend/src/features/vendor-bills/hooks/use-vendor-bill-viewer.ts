/**
 * Vendor bill viewer panel state — status actions, accordion sections, and snapshots.
 *
 * Manages the read-only viewer that appears when a bill is selected:
 * status transition picker, note input, collapsible accordion sections,
 * and the snapshot (status history) list. Also owns the viewer error message.
 *
 * Consumer: VendorBillsConsole (composed alongside useVendorBillForm).
 *
 * ## State (useState)
 *
 * - viewerNextStatus        — selected next status in the status picker
 * - viewerNote              — note textarea content
 * - viewerErrorMessage      — error text shown inside the viewer panel
 * - isStatusSectionOpen     — accordion: Status & Actions (default open)
 * - isLineItemsSectionOpen  — accordion: Line Items (default closed)
 * - isDetailsSectionOpen    — accordion: Bill Details (default closed)
 * - isHistorySectionOpen    — accordion: Status History (default closed)
 * - snapshots               — VendorBillSnapshotRecord[] for the selected bill
 *
 * ## Functions
 *
 * - loadSnapshots(vendorBillId) — fetches snapshot records from the API
 * - resetOnSelect() — resets accordion/note state for a new selection
 * - clearViewer() — full reset when deselecting
 */

import { useState } from "react";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import type { VendorBillSnapshotRecord } from "../types";

type UseVendorBillViewerOptions = {
  /** Auth token for snapshot fetches. */
  authToken: string;
};

/**
 * Manage viewer panel state for the selected vendor bill.
 *
 * @param options - Auth token for API calls.
 * @returns Viewer state, accordion toggles, snapshot data, and reset helpers.
 */
export function useVendorBillViewer({
  authToken,
}: UseVendorBillViewerOptions) {

  // --- State ---

  const [viewerNextStatus, setViewerNextStatus] = useState<string>("");
  const [viewerNote, setViewerNote] = useState<string>("");
  const [viewerErrorMessage, setViewerErrorMessage] = useState("");
  const [snapshots, setSnapshots] = useState<VendorBillSnapshotRecord[]>([]);

  // Accordion section toggles
  const [isStatusSectionOpen, setIsStatusSectionOpen] = useState(true);
  const [isLineItemsSectionOpen, setIsLineItemsSectionOpen] = useState(false);
  const [isDetailsSectionOpen, setIsDetailsSectionOpen] = useState(false);
  const [isHistorySectionOpen, setIsHistorySectionOpen] = useState(false);

  // --- Functions ---

  /** Fetches the snapshot (status history) records for a vendor bill. */
  async function loadSnapshots(vendorBillId: number) {
    try {
      const response = await fetch(`${apiBaseUrl}/vendor-bills/${vendorBillId}/snapshots/`, {
        headers: buildAuthHeaders(authToken),
      });
      if (response.ok) {
        const json = await response.json();
        setSnapshots(json.data ?? []);
      } else {
        setSnapshots([]);
      }
    } catch {
      setSnapshots([]);
    }
  }

  /** Resets viewer state when selecting a different bill. */
  function resetOnSelect() {
    setViewerErrorMessage("");
    setViewerNote("");
    setIsStatusSectionOpen(true);
    setIsLineItemsSectionOpen(false);
    setIsDetailsSectionOpen(false);
    setIsHistorySectionOpen(false);
  }

  /** Full viewer reset when deselecting (switching to create mode). */
  function clearViewer() {
    setViewerErrorMessage("");
    setViewerNextStatus("");
    setViewerNote("");
    setSnapshots([]);
  }

  // --- Return bag ---

  return {
    // State
    viewerNextStatus,
    viewerNote,
    viewerErrorMessage,
    snapshots,
    isStatusSectionOpen,
    isLineItemsSectionOpen,
    isDetailsSectionOpen,
    isHistorySectionOpen,

    // Setters
    setViewerNextStatus,
    setViewerNote,
    setViewerErrorMessage,
    setSnapshots,
    setIsStatusSectionOpen,
    setIsLineItemsSectionOpen,
    setIsDetailsSectionOpen,
    setIsHistorySectionOpen,

    // Helpers
    loadSnapshots,
    resetOnSelect,
    clearViewer,
  };
}
