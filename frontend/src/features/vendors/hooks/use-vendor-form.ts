/**
 * Vendor create/edit form state, CRUD handlers, and duplicate detection.
 *
 * Owns the form fields (name, email, phone, taxIdLast4, notes, isActive),
 * the duplicate-override checkbox, and the duplicate-candidate state surfaced
 * by 409 responses. Reads from the shared vendor list to find the selected
 * record, and writes back via setVendors for optimistic updates.
 *
 * Consumer: VendorsConsole (composed alongside useVendorFilters
 * and useVendorCsvImport).
 *
 * ## State (useState)
 *
 * - name                  — vendor name (required)
 * - vendorEmail           — vendor email
 * - phone                 — vendor phone
 * - taxIdLast4            — last 4 digits of tax ID
 * - notes                 — freeform notes
 * - isActive              — active/inactive toggle (edit mode only)
 * - duplicateOverrideOnSave — checkbox: bypass duplicate detection
 * - duplicateCandidates   — array of VendorRecords returned by a 409
 * - pendingCreatePayload  — held payload when a 409 interrupts creation
 *
 * ## Functions
 *
 * - hydrate(vendor)
 *     Populates form fields from a VendorRecord.
 *
 * - startCreateMode()
 *     Clears fields, deselects the list, resets duplicate state.
 *
 * - handleSelect(id)
 *     Selects a vendor, hydrates the form, clears duplicate override.
 *
 * - handleSubmit(event)
 *     Unified form handler: POSTs (with 409 duplicate handling) for new
 *     vendors, PATCHes for existing. On 409, surfaces candidates and
 *     holds the payload for handleCreateAnyway.
 *
 * - handleCreateAnyway()
 *     Retries the held create payload with duplicate_override: true.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import { FormEvent, useState } from "react";

import type { ApiResponse, VendorPayload, VendorRecord } from "../types";

type StatusSetters = {
  setNeutral: (message: string) => void;
  setSuccess: (message: string) => void;
  setError: (message: string) => void;
};

type UseVendorFormOptions = {
  authToken: string;
  canMutate: boolean;
  vendors: VendorRecord[];
  setVendors: React.Dispatch<React.SetStateAction<VendorRecord[]>>;
  selectedId: string;
  setSelectedId: (id: string) => void;
  setCurrentPage: (page: number) => void;
  status: StatusSetters;
};

/**
 * Manage vendor form state, CRUD operations, and duplicate detection.
 *
 * @param options - Auth token, RBAC flag, list data + setters, pagination, and status setters.
 * @returns Form fields, setters, duplicate state, and CRUD handlers.
 */
export function useVendorForm({
  authToken,
  canMutate,
  vendors,
  setVendors,
  selectedId,
  setSelectedId,
  setCurrentPage,
  status,
}: UseVendorFormOptions) {

  // --- State ---

  const [name, setName] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [taxIdLast4, setTaxIdLast4] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [duplicateOverrideOnSave, setDuplicateOverrideOnSave] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<VendorRecord[]>([]);
  const [pendingCreatePayload, setPendingCreatePayload] = useState<VendorPayload | null>(null);

  // --- Derived ---

  const selectedVendor = vendors.find((row) => String(row.id) === selectedId) ?? null;

  // --- Functions ---

  /** Populate form fields from a VendorRecord. */
  function hydrate(vendor: VendorRecord) {
    setName(vendor.name);
    setVendorEmail(vendor.email);
    setPhone(vendor.phone);
    setTaxIdLast4(vendor.tax_id_last4);
    setNotes(vendor.notes);
    setIsActive(vendor.is_active);
  }

  /** Clear fields, deselect the list, and reset duplicate state. */
  function startCreateMode() {
    setSelectedId("");
    setName("");
    setVendorEmail("");
    setPhone("");
    setTaxIdLast4("");
    setNotes("");
    setIsActive(true);
    setDuplicateOverrideOnSave(false);
    setDuplicateCandidates([]);
    setPendingCreatePayload(null);
  }

  /** Select a vendor row, hydrate the form, and clear duplicate override. */
  function handleSelect(id: string) {
    setSelectedId(id);
    const match = vendors.find((row) => String(row.id) === id);
    if (!match) return;
    hydrate(match);
    setDuplicateOverrideOnSave(false);
  }

  /** POST a new vendor. Handles 409 duplicate-detection by surfacing candidates. */
  async function createVendor(
    payloadBody: VendorPayload,
    options?: { duplicate_override?: boolean },
  ) {
    const response = await fetch(`${apiBaseUrl}/vendors/`, {
      method: "POST",
      headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
      body: JSON.stringify({ ...payloadBody, ...options }),
    });
    const payload: ApiResponse = await response.json();

    if (response.status === 409 && payload.error?.code === "duplicate_detected") {
      const duplicateData = payload.data as { duplicate_candidates?: VendorRecord[] };
      setDuplicateCandidates(duplicateData.duplicate_candidates ?? []);
      setPendingCreatePayload(payloadBody);
      status.setError("Potential duplicate vendor found. Review candidates below.");
      return;
    }

    if (!response.ok) {
      status.setError(payload.error?.message ?? "Create vendor failed.");
      return;
    }

    const created = payload.data as VendorRecord;
    setVendors((current) => {
      const nextRows = [...current, created];
      setCurrentPage(Math.ceil(nextRows.length / 6));
      return nextRows;
    });
    setSelectedId(String(created.id));
    hydrate(created);
    setDuplicateOverrideOnSave(false);
    setDuplicateCandidates([]);
    setPendingCreatePayload(null);
    status.setSuccess(`Created vendor #${created.id}.`);
  }

  /** Retry the pending create with duplicate_override after user confirmation. */
  async function handleCreateAnyway() {
    if (!pendingCreatePayload) {
      status.setError("No duplicate candidate payload to resolve.");
      return;
    }
    status.setNeutral("Creating duplicate vendor by override...");
    await createVendor(pendingCreatePayload, { duplicate_override: true });
  }

  /** Unified form submit: POSTs new vendors (with 409 handling) or PATCHes existing. */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) {
      status.setError("Your role is read-only for vendor mutations.");
      return;
    }
    const payloadBody: VendorPayload = {
      name: name.trim(),
      email: vendorEmail.trim(),
      phone: phone.trim(),
      tax_id_last4: taxIdLast4.trim(),
      notes: notes.trim(),
      is_active: selectedVendor ? isActive : true,
    };

    if (!selectedVendor) {
      status.setNeutral("Creating vendor...");
      await createVendor(
        payloadBody,
        duplicateOverrideOnSave ? { duplicate_override: true } : undefined,
      );
      return;
    }

    status.setNeutral("Saving vendor...");
    try {
      const response = await fetch(`${apiBaseUrl}/vendors/${selectedVendor.id}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({
          ...payloadBody,
          duplicate_override: duplicateOverrideOnSave,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (response.status === 409 && payload.error?.code === "duplicate_detected") {
        const duplicateData = payload.data as { duplicate_candidates?: VendorRecord[] };
        setDuplicateCandidates(duplicateData.duplicate_candidates ?? []);
        status.setError("Potential duplicate found. Enable override and save again if intentional.");
        return;
      }
      if (!response.ok) {
        status.setError(payload.error?.message ?? "Save failed.");
        return;
      }
      const updated = payload.data as VendorRecord;
      setVendors((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setDuplicateCandidates([]);
      setPendingCreatePayload(null);
      setDuplicateOverrideOnSave(false);
      status.setSuccess(`Saved vendor #${updated.id}.`);
    } catch {
      status.setError("Could not reach vendor detail endpoint.");
    }
  }

  // --- Return bag ---

  return {
    // State
    name,
    vendorEmail,
    phone,
    taxIdLast4,
    notes,
    isActive,
    duplicateOverrideOnSave,
    duplicateCandidates,
    pendingCreatePayload,
    selectedVendor,

    // Setters
    setName,
    setVendorEmail,
    setPhone,
    setTaxIdLast4,
    setNotes,
    setIsActive,
    setDuplicateOverrideOnSave,

    // Helpers
    hydrate,
    startCreateMode,
    handleSelect,
    handleSubmit,
    handleCreateAnyway,
  };
}
