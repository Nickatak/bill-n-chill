/**
 * Vendor create/edit form state, CRUD handlers, and duplicate detection.
 *
 * Owns the form fields (name, email, phone, taxIdLast4, notes) and the
 * duplicate-candidate state surfaced by 409 responses. Duplicate vendor
 * names are blocked outright — there is no override path.
 *
 * Consumer: VendorsConsole (composed alongside useVendorFilters
 * and useVendorCsvImport).
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

  const [duplicateCandidates, setDuplicateCandidates] = useState<VendorRecord[]>([]);

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
  }

  /** Clear fields, deselect the list, and reset duplicate state. */
  function startCreateMode() {
    setSelectedId("");
    setName("");
    setVendorEmail("");
    setPhone("");
    setTaxIdLast4("");
    setNotes("");
    setDuplicateCandidates([]);
  }

  /** Select a vendor row, hydrate the form, and clear duplicate state. */
  function handleSelect(id: string) {
    setSelectedId(id);
    const match = vendors.find((row) => String(row.id) === id);
    if (!match) return;
    hydrate(match);
    setDuplicateCandidates([]);
  }

  /** POST a new vendor (name only). Surfaces 409 duplicate candidates. */
  async function createVendor(vendorName: string) {
    const response = await fetch(`${apiBaseUrl}/vendors/`, {
      method: "POST",
      headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
      body: JSON.stringify({ name: vendorName }),
    });
    const payload: ApiResponse = await response.json();

    if (response.status === 409 && payload.error?.code === "duplicate_detected") {
      const duplicateData = payload.data as { duplicate_candidates?: VendorRecord[] };
      setDuplicateCandidates(duplicateData.duplicate_candidates ?? []);
      status.setError(payload.error.message ?? "A vendor with this name already exists.");
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
    setDuplicateCandidates([]);
    status.setSuccess(`Created vendor "${created.name}".`);
  }

  /** Save edits to an existing vendor via PATCH. */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) {
      status.setError("Your role is read-only for vendor mutations.");
      return;
    }
    if (!selectedVendor) return;

    const payloadBody: VendorPayload = {
      name: name.trim(),
      email: vendorEmail.trim(),
      phone: phone.trim(),
      tax_id_last4: taxIdLast4.trim(),
      notes: notes.trim(),
    };

    status.setNeutral("Saving vendor...");
    try {
      const response = await fetch(`${apiBaseUrl}/vendors/${selectedVendor.id}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify(payloadBody),
      });
      const payload: ApiResponse = await response.json();
      if (response.status === 409 && payload.error?.code === "duplicate_detected") {
        const duplicateData = payload.data as { duplicate_candidates?: VendorRecord[] };
        setDuplicateCandidates(duplicateData.duplicate_candidates ?? []);
        status.setError(payload.error.message ?? "A vendor with this name already exists.");
        return;
      }
      if (!response.ok) {
        status.setError(payload.error?.message ?? "Save failed.");
        return;
      }
      const updated = payload.data as VendorRecord;
      setVendors((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setDuplicateCandidates([]);
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
    duplicateCandidates,
    selectedVendor,

    // Setters
    setName,
    setVendorEmail,
    setPhone,
    setTaxIdLast4,
    setNotes,

    // Helpers
    hydrate,
    startCreateMode,
    handleSelect,
    handleSubmit,
    createVendor,
  };
}
