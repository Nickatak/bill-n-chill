/**
 * Customer editor modal lifecycle hook.
 *
 * Owns the edit-customer modal state: open/close, form fields, PATCH
 * mutation, and optimistic list update. Uses backdrop-dismiss for
 * click-outside-to-close behavior.
 *
 * Consumer: CustomersConsole (composed alongside useCustomerListFetch).
 *
 * ## State (useState)
 *
 * - editingId       — ID string of the customer being edited
 * - isOpen          — modal visibility flag
 * - displayName     — editable display name
 * - phone           — editable phone
 * - billingAddress  — editable billing address
 * - email           — editable email
 * - isArchived      — editable archive toggle
 *
 * ## Functions
 *
 * - hydrate(customer)
 *     Populates form fields from a CustomerRow.
 *
 * - open(id)
 *     Finds the customer by ID, hydrates the form, and opens the modal.
 *
 * - close()
 *     Hides the modal.
 *
 * - handleSave(event)
 *     PATCHes the customer, updates the list optimistically, and closes
 *     the modal on success.
 *
 * - hydrateFromScoped(customer)
 *     Sets editingId and hydrates — used for URL deep-link initialization.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import { useBackdropDismiss } from "@/shared/hooks/use-backdrop-dismiss";
import { FormEvent, useState } from "react";

import type { ApiResponse, CustomerRow } from "../types";

type UseCustomerEditorOptions = {
  authToken: string;
  canMutate: boolean;
  customerRows: CustomerRow[];
  setCustomerRows: React.Dispatch<React.SetStateAction<CustomerRow[]>>;
  setStatusMessage: (message: string) => void;
};

/**
 * Manage the customer edit modal lifecycle: open, populate, PATCH, close.
 *
 * @param options - Auth token, RBAC flag, and list state handles from the console.
 * @returns Modal state, form fields + setters, and lifecycle helpers.
 */
export function useCustomerEditor({
  authToken,
  canMutate,
  customerRows,
  setCustomerRows,
  setStatusMessage,
}: UseCustomerEditorOptions) {

  // --- State ---

  const [editingId, setEditingId] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [email, setEmail] = useState("");
  const [isArchived, setIsArchived] = useState(false);
  const backdropDismiss = useBackdropDismiss(close);

  const editingCustomer = customerRows.find((entry) => String(entry.id) === editingId) ?? null;

  // --- Functions ---

  /** Populate editor form fields from a customer record. */
  function hydrate(customer: CustomerRow) {
    setDisplayName(customer.display_name ?? "");
    setPhone(customer.phone ?? "");
    setBillingAddress(customer.billing_address ?? "");
    setEmail(customer.email ?? "");
    setIsArchived(Boolean(customer.is_archived));
  }

  /** Open the edit modal for a customer. */
  function open(id: string) {
    const row = customerRows.find((entry) => String(entry.id) === id);
    if (!row) {
      return;
    }
    setEditingId(id);
    hydrate(row);
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
  }

  /** PATCH the customer record, update the local list, and close the editor on success. */
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) {
      setStatusMessage("Your role is read-only for customer mutations.");
      return;
    }
    const customerId = Number(editingId);
    if (!customerId) {
      setStatusMessage("Select a customer first.");
      return;
    }
    if (!displayName.trim()) {
      setStatusMessage("Display name is required.");
      return;
    }

    setStatusMessage("");

    try {
      const response = await fetch(`${apiBaseUrl}/customers/${customerId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({
          display_name: displayName,
          phone,
          billing_address: billingAddress,
          email,
          is_archived: isArchived,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Save failed.");
        return;
      }

      const updated = payload.data as CustomerRow;

      setCustomerRows((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      hydrate(updated);
      setIsOpen(false);
      setStatusMessage(`Saved ${updated.display_name || "customer"}.`);
    } catch {
      setStatusMessage("Could not reach customer detail endpoint.");
    }
  }

  /** Hydrate the editor from a scoped customer (URL param). */
  function hydrateFromScoped(customer: CustomerRow) {
    setEditingId(String(customer.id));
    hydrate(customer);
  }

  // --- Return bag ---

  return {
    // State
    isOpen,
    editingId,
    editingCustomer,
    displayName,
    phone,
    billingAddress,
    email,
    isArchived,
    backdropDismiss,

    // Setters
    setDisplayName,
    setPhone,
    setBillingAddress,
    setEmail,
    setIsArchived,

    // Helpers
    open,
    close,
    handleSave,
    hydrateFromScoped,
  };
}
