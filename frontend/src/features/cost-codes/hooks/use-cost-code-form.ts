/**
 * Cost code create/edit form state and CRUD handlers.
 *
 * Owns the form fields (code, name, isActive), the create/edit mode toggle,
 * and the POST/PATCH handlers. Reads from the shared cost-code list to find
 * the selected record, and writes back via setCostCodes for optimistic updates.
 *
 * Consumer: CostCodesConsole (composed alongside useCostCodeFilters).
 *
 * ## State (useState)
 *
 * - formMode   — "create" | "edit"; determines which handler the form submits to
 * - code       — the cost code identifier (locked in edit mode)
 * - name       — the human-readable label
 * - isActive   — active/archived toggle (edit mode only)
 *
 * ## Functions
 *
 * - hydrate(costCode)
 *     Populates form fields from a CostCode record and switches to edit mode.
 *     Called by the console's onSuccess callback and handleSelect.
 *
 * - switchToCreate()
 *     Clears all fields, deselects the list, and switches to create mode.
 *
 * - handleSelect(id)
 *     Selects a cost code by ID, finds it in the list, and hydrates the form.
 *
 * - handleCreate(event)
 *     POSTs a new cost code, appends it to the list, selects it, and hydrates.
 *
 * - handleSave(event)
 *     PATCHes the selected cost code and updates the list optimistically.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import { FormEvent, useState } from "react";

import type { ApiResponse, CostCode } from "../types";

type FormMode = "create" | "edit";

type StatusSetters = {
  setNeutral: (message: string) => void;
  setSuccess: (message: string) => void;
  setError: (message: string) => void;
};

type UseCostCodeFormOptions = {
  authToken: string;
  canMutate: boolean;
  costCodes: CostCode[];
  setCostCodes: React.Dispatch<React.SetStateAction<CostCode[]>>;
  selectedId: string;
  setSelectedId: (id: string) => void;
  status: StatusSetters;
};

/**
 * Manage cost code form state and CRUD operations.
 *
 * @param options - Auth token, RBAC flag, list data + setters, and status setters.
 * @returns Form fields, setters, mode, and CRUD handlers.
 */
export function useCostCodeForm({
  authToken,
  canMutate,
  costCodes,
  setCostCodes,
  selectedId,
  setSelectedId,
  status,
}: UseCostCodeFormOptions) {

  // --- State ---

  const [formMode, setFormMode] = useState<FormMode>("create");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);

  // --- Functions ---

  /** Populate form fields from a CostCode record and switch to edit mode. */
  function hydrate(costCode: CostCode) {
    setCode(costCode.code);
    setName(costCode.name);
    setIsActive(costCode.is_active);
    setFormMode("edit");
  }

  /** Clear the form and switch to create mode. */
  function switchToCreate() {
    setSelectedId("");
    setCode("");
    setName("");
    setIsActive(true);
    setFormMode("create");
  }

  /** Select a cost code row and populate the edit form. */
  function handleSelect(id: string) {
    setSelectedId(id);
    const match = costCodes.find((row) => String(row.id) === id);
    if (match) {
      hydrate(match);
    }
  }

  /** POST a new cost code, append to list, select it, and hydrate. */
  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) {
      status.setError("Your role is read-only for cost code mutations.");
      return;
    }
    status.setNeutral("Creating cost code...");

    try {
      const response = await fetch(`${apiBaseUrl}/cost-codes/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          is_active: true,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        status.setError(payload.error?.message ?? "Create failed. Check values and uniqueness.");
        return;
      }
      const created = payload.data as CostCode;
      setCostCodes((current) => [...current, created]);
      setSelectedId(String(created.id));
      hydrate(created);
      status.setSuccess(`Created cost code #${created.id} (${created.code} - ${created.name}).`);
    } catch {
      status.setError("Could not reach cost code create endpoint.");
    }
  }

  /** PATCH the selected cost code and update the list optimistically. */
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) {
      status.setError("Your role is read-only for cost code mutations.");
      return;
    }
    const costCodeId = Number(selectedId);
    if (!costCodeId) {
      status.setError("Select a cost code first.");
      return;
    }

    status.setNeutral("Saving cost code...");
    try {
      const response = await fetch(`${apiBaseUrl}/cost-codes/${costCodeId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({ code: code.trim(), name: name.trim(), is_active: isActive }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        status.setError(payload.error?.message ?? "Save failed. Check values and uniqueness.");
        return;
      }
      const updated = payload.data as CostCode;
      setCostCodes((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      hydrate(updated);
      status.setSuccess(`Saved cost code #${updated.id} (${updated.code} - ${updated.name}).`);
    } catch {
      status.setError("Could not reach cost code detail endpoint.");
    }
  }

  // --- Return bag ---

  return {
    // State
    formMode,
    code,
    name,
    isActive,

    // Setters
    setCode,
    setName,
    setIsActive,

    // Helpers
    hydrate,
    switchToCreate,
    handleSelect,
    handleCreate,
    handleSave,
  };
}
