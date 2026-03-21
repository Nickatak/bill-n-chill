/**
 * Client-side payment list filtering and search.
 *
 * Applies status pill filters and text search on top of the full
 * payment list. Pure derived state -- no API calls, no effects.
 * Feeds into useClientPagination for paged display.
 *
 * Consumer: PaymentsConsole (composed alongside usePaymentData and
 * usePaymentForm).
 *
 * ## State (useState)
 *
 * - paymentStatusFilters — array of active status strings; defaults to ["pending", "settled"]
 * - paymentSearch        — free-text search input value
 *
 * ## Memos
 *
 * - inboundPayments
 *     Deps: [allPayments]
 *     Filters to direction === "inbound" only.
 *
 * - paymentStatusTotals
 *     Deps: [inboundPayments]
 *     Map<status, count> for badge counts on filter pills.
 *
 * - statusFilteredPayments
 *     Deps: [inboundPayments, paymentStatusFilters]
 *     Subset matching active status pills.
 *
 * - searchedPayments
 *     Deps: [statusFilteredPayments, paymentNeedle]
 *     Full-text search across id, method, status, amount, date,
 *     reference, notes, customer, and project fields.
 */

import { useMemo, useState } from "react";

import type { PaymentRecord } from "../types";

const DIRECTION = "inbound" as const;

/**
 * Filter and search the payment list for display.
 *
 * @param allPayments - The full payment list from the server (all directions).
 * @returns Filter state, setters, and derived filtered/searched payment arrays.
 */
export function usePaymentFilters(allPayments: PaymentRecord[]) {

  // --- State ---

  const [paymentStatusFilters, setPaymentStatusFilters] = useState<string[]>(["pending", "settled"]);
  const [paymentSearch, setPaymentSearch] = useState("");

  // --- Memos ---

  const inboundPayments = useMemo(
    () => allPayments.filter((p) => p.direction === DIRECTION),
    [allPayments],
  );

  const paymentStatusTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of inboundPayments) {
      totals.set(p.status, (totals.get(p.status) ?? 0) + 1);
    }
    return totals;
  }, [inboundPayments]);

  const statusFilteredPayments = useMemo(() => {
    if (!paymentStatusFilters.length) return [];
    return inboundPayments.filter((p) => paymentStatusFilters.includes(p.status));
  }, [inboundPayments, paymentStatusFilters]);

  // --- Derived ---

  const paymentNeedle = paymentSearch.trim().toLowerCase();

  const searchedPayments = useMemo(() => {
    if (!paymentNeedle) return statusFilteredPayments;
    return statusFilteredPayments.filter((p) => {
      const haystack = [
        String(p.id),
        p.method,
        p.status,
        p.amount,
        p.payment_date,
        p.reference_number,
        p.notes,
        p.customer_name,
        p.project_name,
      ].join(" ").toLowerCase();
      return haystack.includes(paymentNeedle);
    });
  }, [statusFilteredPayments, paymentNeedle]);

  // --- Exposed helpers ---

  /** Toggle a status value in/out of the active filter set. */
  function togglePaymentStatusFilter(status: string) {
    setPaymentStatusFilters((current) =>
      current.includes(status)
        ? current.filter((s) => s !== status)
        : [...current, status],
    );
  }

  // --- Return bag ---

  return {
    // State
    paymentStatusFilters,
    paymentSearch,
    inboundPayments,
    paymentStatusTotals,
    searchedPayments,
    paymentNeedle,

    // Setters
    setPaymentStatusFilters,
    setPaymentSearch,

    // Helpers
    togglePaymentStatusFilter,
  };
}
