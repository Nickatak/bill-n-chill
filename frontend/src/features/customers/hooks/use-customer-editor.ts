import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { FormEvent, MouseEvent, useRef, useState } from "react";

import type { ApiResponse, CustomerRow } from "../types";

type UseCustomerEditorOptions = {
  token: string;
  normalizedBaseUrl: string;
  canMutate: boolean;
  rows: CustomerRow[];
  setRows: React.Dispatch<React.SetStateAction<CustomerRow[]>>;
  setStatusMessage: (message: string) => void;
};

export function useCustomerEditor({
  token,
  normalizedBaseUrl,
  canMutate,
  rows,
  setRows,
  setStatusMessage,
}: UseCustomerEditorOptions) {
  const [editingId, setEditingId] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [email, setEmail] = useState("");
  const [isArchived, setIsArchived] = useState(false);
  const backdropPointerStartRef = useRef(false);

  const editingCustomer = rows.find((entry) => String(entry.id) === editingId) ?? null;

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
    const row = rows.find((entry) => String(entry.id) === id);
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

  /** Track where a click started so we only close the modal on full backdrop clicks. */
  function handleOverlayMouseDown(event: MouseEvent<HTMLDivElement>) {
    backdropPointerStartRef.current = event.target === event.currentTarget;
  }

  /** Complete the backdrop-click check and close the editor if both events hit the overlay. */
  function handleOverlayMouseUp(event: MouseEvent<HTMLDivElement>) {
    const endedOnBackdrop = event.target === event.currentTarget;
    if (backdropPointerStartRef.current && endedOnBackdrop) {
      close();
    }
    backdropPointerStartRef.current = false;
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
      const response = await fetch(`${normalizedBaseUrl}/customers/${customerId}/`, {
        method: "PATCH",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
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

      setRows((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
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

  return {
    isOpen,
    editingId,
    editingCustomer,
    displayName,
    setDisplayName,
    phone,
    setPhone,
    billingAddress,
    setBillingAddress,
    email,
    setEmail,
    isArchived,
    setIsArchived,
    open,
    close,
    handleOverlayMouseDown,
    handleOverlayMouseUp,
    handleSave,
    hydrateFromScoped,
  };
}
